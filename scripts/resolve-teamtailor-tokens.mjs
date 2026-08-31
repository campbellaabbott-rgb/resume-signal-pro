// Map a Teamtailor custom domain back to its {token}.teamtailor.com tenant.
//
// WHY THIS DECIDES A BUILD. census-custom-domains.mjs finds boards on employers'
// own hostnames — careers.telenor.se, careers.inpost.co.uk. The ingester builds
// feed URLs from a token alone (`https://${s.token}.teamtailor.com/jobs.rss`),
// so the whole question was: does a token even exist for these, or does
// sources.ts need a per-entry host override?
//
// ANSWER: the token exists. careers.telenor.se is telenorsweden.teamtailor.com,
// serving the same 26 jobs. So these are ordinary board additions and NO host
// override is needed. That is the difference between a merge and a build, and
// it is why this was worth resolving before writing either.
//
// HOW A MATCH IS PROVEN. Not by "the guessed host returns 200" — that is the
// reachability trap this codebase keeps falling into, and Teamtailor serves a
// valid empty feed for tenants that exist but are not hiring. A match requires
// a SHARED NUMERIC JOB ID between the custom domain's feed and the candidate
// tenant's. Two hosts advertising the same job posting are the same tenant;
// nothing weaker establishes that.
//
// MEASURED 2026-08-01 across the 54 candidates from the UK + Nordic census:
// 39 resolved, 15 did not. The guess list is name- and domain-derived, so it
// catches the common patterns (firstcamp, inpost, victorianplumbing,
// telenorsweden, kicksnorge) and misses renames and holding-company names —
// Pennon Group serving careers.southwestwater.co.uk, KICKS Sverige where
// kicksnorge worked. Those 15 need a channel this script does not have; their
// pages carry no teamtailor.com reference at all.
//
// A DEAD END, recorded so it is not retried: scraping the custom domain's HTML
// for a *.teamtailor.com reference. It works on exactly one kind of page — one
// that links SIBLING tenants (careers.telenor.se mentions telenorlinx and
// telenorsharedservices) — and those references are never the page's own
// tenant. Three unresolved boards were checked directly: zero teamtailor
// subdomains in the markup.
//
//   node scripts/resolve-teamtailor-tokens.mjs candidates.json out.json

import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Politeness gate, added for the 765-host custom-domain sweep (2026-08-30).
// The original shape — 8 workers, no spacing — was tuned for the 54-row UK +
// Nordic census. It does not scale politely: every guess probe lands on
// teamtailor.com itself regardless of which custom host is being resolved, so
// worker count IS the per-origin concurrency. Cap: 5 in flight, ~200ms
// between request starts, enforced globally rather than per worker.
let nextSlot = 0;
const paced = () => {
  const wait = Math.max(nextSlot - Date.now(), 0);
  nextSlot = Math.max(nextSlot, Date.now()) + 200;
  return new Promise((r) => setTimeout(r, wait));
};
const sh = async (...a) => {
  await paced();
  try { return (await run(a[0], a.slice(1), { timeout: 25_000 })).stdout; }
  catch { return ""; }
};

/** Country words, because Teamtailor tenants are per-market far more often than
 *  per-group: kicksnorge, telenorsweden, kirppudk. */
const COUNTRY = { se: "sweden", no: "norway", dk: "denmark", fi: "finland", uk: "uk" };

/**
 * THE FEED DECLARES ITS OWN TEAMTAILOR ACCOUNT NAME, and this script used to
 * ignore it.
 *
 * Every custom-domain feed carries JSON-LD per item:
 *
 *     _jobposting.identifier      { name: "Telenor Sweden", value: 8174332 }
 *     _jobposting.hiringOrganization { name: "Telenor Sweden", ... }
 *
 * `identifier.name` is the employer's account name IN Teamtailor, which is what
 * the token is derived from — telenorsweden. The hostname is not: it is
 * whatever the employer chose to point at the board. Measured 14/14 feeds
 * declaring it.
 *
 * This is the channel for the failure the header records — renames and holding
 * companies. Verified cases the hostname could never have produced:
 *
 *     careers.desprint.nl    -> globalautomotivegroup   (holding company)
 *     careers.lutontown.co.uk-> lutontownfootballclub   (expanded name)
 *     careers.mdpi.com       -> mdpispain               (per-market tenant)
 *     careers.formelskin.de  -> "Voy"                   (a rebrand)
 *
 * Org-derived candidates go FIRST, because when they hit they are right for a
 * reason, whereas a hostname match is a coincidence that usually holds.
 */
function orgName(feedJson) {
  const it = (feedJson?.items ?? [])[0] ?? {};
  return it?._jobposting?.identifier?.name
      ?? it?._jobposting?.hiringOrganization?.name
      ?? null;
}

function guesses(name, host, org) {
  const parts = host.split(".");
  const base = parts[1] ?? "";                 // careers.telenor.se -> telenor
  const cc = parts[parts.length - 1] ?? "";
  const slug = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = slug(name);
  const c = COUNTRY[cc] ?? "";
  const o = slug(org);
  // Legal and boilerplate suffixes: "Lawsons (Whetstone) Ltd" is not the token.
  const oStripped = slug(String(org ?? "").replace(
    /\b(ltd|limited|group|plc|ab|as|oy|inc|gmbh|bv|nv|football club)\b/gi, " "));
  return [...new Set([o, oStripped, o + c, n, base, base + c, n + c, base + cc, n + cc]
    .filter(Boolean).filter((x) => x.length > 2))].slice(0, 9);
}

const jobIds = (s) => new Set([...s.matchAll(/\/jobs\/(\d+)/g)].map((m) => m[1]));

async function resolve(c) {
  const body = await sh("curl", "-s", "--max-time", "20", `https://${c.host}/jobs.json`);
  const own = jobIds(body);
  if (!own.size) return { ...c, token: null, why: "no job ids on the custom domain" };
  let org = null;
  try { org = orgName(JSON.parse(body)); } catch { /* not JSON Feed; host guesses still apply */ }
  for (const g of guesses(c.name, c.host, org)) {
    const rss = await sh("curl", "-s", "--max-time", "15", `https://${g}.teamtailor.com/jobs.rss`);
    if (!rss.includes("<item>")) continue;
    const shared = [...jobIds(rss)].filter((id) => own.has(id));
    // A shared posting is the proof. A 200 is not.
    if (shared.length) return { ...c, token: g, org, why: `${shared.length} shared job ids` };
  }
  // NOT "the guess list missed it". Calibrated 2026-08-05: a fabricated
  // subdomain and every unresolved candidate both return HTTP 404, while a real
  // tenant returns 200 with jobs — so for these the derived tokens genuinely do
  // not exist rather than being merely unguessed.
  return { ...c, token: null, org, why: "no candidate token exists" };
}

async function main() {
  const [inPath, outPath = "resolved.json"] = process.argv.slice(2);
  if (!inPath) { console.error("usage: node scripts/resolve-teamtailor-tokens.mjs <candidates.json> [out]"); process.exit(2); }
  const cands = JSON.parse(readFileSync(inPath, "utf8"));

  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < cands.length) out.push(await resolve(cands[i++]));
  }));

  const ok = out.filter((r) => r.token).sort((a, b) => b.jobs - a.jobs);
  console.log(`  resolved ${ok.length}/${out.length} to a teamtailor tenant\n`);
  for (const r of ok) console.log(`    ${String(r.jobs).padStart(4)}  ${(r.name || "").slice(0, 26).padEnd(26)} ${r.host.padEnd(34)} -> ${r.token}`);
  const bad = out.filter((r) => !r.token);
  if (bad.length) {
    console.log(`\n  unresolved (${bad.length}) — no DERIVED token exists (404s like a fabricated name);`);
    console.log("  the tenant is named something neither the hostname nor the feed's org name predicts:");
    for (const r of bad) console.log(`    ${String(r.jobs).padStart(4)}  ${(r.name || "").slice(0, 26).padEnd(26)} ${r.host}`);
  }
  writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`\n  -> ${outPath}`);
  console.log("  Resolved rows are ordinary sources.ts entries: {source:'teamtailor', token}.");
  console.log("  Still subject to token-first dedupe and the corporate-only rule.");
}

main();
