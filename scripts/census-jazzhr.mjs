#!/usr/bin/env node
// JazzHR census — Common Crawl discovery, live verification, catalog lines.
//
// WHY. Scouting on 2026-08-31 rated JazzHR BUILD-S: roughly a thousand
// employer boards at {slug}.applytojob.com, every one a direct employer's own
// career page (JazzHR sells to the employer; there is no agency tier and no
// aggregator layer). The adapter landed 2026-09-04 in
// supabase/functions/job-board/vendors/jazzhr.ts; this script feeds it.
//
// WHAT THE FIRST RUN FOUND, 2026-09-04, so the next person starts from evidence:
//   * CC-MAIN-2026-34 answers `*.applytojob.com/apply/*` in ONE index page:
//     7,294 collapsed URLs over 566 hosts, 5 of them the vendor's own
//     14-digit_16-char customer-id aliases (the same board under its internal
//     id), which are skipped. Older indexes add hosts a crawl missed.
//   * The list page is HTML with no feed behind it (/apply/feed 410,
//     /apply/jobs/feed → notfound.html at HTTP 200, ?format=json → the same
//     HTML), so verification parses the same markup the adapter parses — the
//     row parser below MIRRORS parseJazzhrList and must move with it.
//   * A dead board redirects to app.applytojob.com/notfound.html and answers
//     200. That is a failure here and in the adapter, never an empty board.
//
// DISCOVERY ONLY PROPOSES; verification is where truth enters. A token passes
// when its /apply/ page answers 200 on its own host, names an employer, and
// lists >= --min postings (3, the census-merge protocol's floor). The quality
// screens are the ones merge-all.mjs / tag-agencies.mjs apply, same spelling:
//   - staffing-vocabulary names are SET ASIDE (agencies.json), not emitted —
//     the 2026-08-31 charter carries agencies with disclosure, and disclosure
//     is a merge-time decision, so this script never writes `agency: true`.
//   - junk/demo/sandbox names and tokens, and public-sector names, are refused.
//   - two slugs serving the SAME employer name keep the larger board only.
//
// POLITE BY CONSTRUCTION: one request per host, at most 2 in flight, >= 300ms
// between request starts, a descriptive User-Agent, and a host is never
// re-probed after a 4xx/5xx.
//
// Usage:
//   node scripts/census-jazzhr.mjs [--indexes=3] [--sample=N] [--min=3]
//                                  [--offline=hosts.json] [--out=jazzhr-census.json]
//                                  [--emit=jazzhr-entries.txt] [--seed=word]
//   --sample=N verifies a deterministic alphabet-spanning N of the candidates
//   (the first run merged a 25+-board sample; the full ~1k merge is a later run).

import fs from "node:fs";
import { createHash } from "node:crypto";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const INDEXES = Number(arg("indexes", 3));
const SAMPLE = Number(arg("sample", 0));
const MIN = Number(arg("min", 3));
const OFFLINE = arg("offline", "");
const OUT = arg("out", "jazzhr-census.json");
const EMIT = arg("emit", "jazzhr-entries.txt");
const SEED = arg("seed", "jazzhr");
const CDX = "https://index.commoncrawl.org";
const HOST_SUFFIX = ".applytojob.com";
const UA = "resumebooster.work census (contact: support@resumebooster.work)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vendor infrastructure labels (the pinpoint/rung-3 set) plus JazzHR's own.
const NOT_COMPANY = new Set([
  "www", "api", "app", "apps", "auth", "login", "signup", "blog", "help", "docs",
  "support", "status", "cdn", "assets", "static", "mail", "email", "marketing",
  "admin", "dashboard", "my", "go", "get", "try", "demo", "sandbox", "staging",
  "test", "dev", "careers", "jobs", "hire", "portal", "connect", "developers",
  "resumator", "jazz", "jazzhr", "hiring", "apply",
]);
// The vendor's internal customer-id alias for a board — same page, no identity.
const ALIAS_ID = /^\d{14}_[a-z0-9]{16}$/;
// Slugs that read as a job board rather than an employer.
const AGGREGATOR_SLUG = /(jobboard|jobsboard|jobaggregat|aggregat|joblist|jobsearch|jobportal)/i;
// merge-all.mjs / tag-agencies.mjs vocabulary, same spelling — keep in lockstep.
const AGENCY_NAME = /\b(staffing|recruit(ing|ment|er)?s?|headhunt|personnel|manpower|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
const GOV_BLOCK = /\b(city of|county of|town of|village of|borough of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
const JUNK_NAME = /\b(demo|test|sample|sandbox|placeholder)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging|-dev\d*\b)/i;

// Common Crawl's index is a free public service that answers 502/503 under
// load and, measured 2026-09-04, sometimes CUTS a long JSON-lines response
// short with a 200 — the first live pass read 27 tokens where the same query
// carries 566 hosts. So a 5xx backs off and retries, and a body whose last
// line is not valid JSON is treated as truncated and retried too.
async function fetchRetry(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status >= 500 || res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      return res;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}
async function fetchJsonLines(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetchRetry(url);
    if (!res || !res.ok) return { status: res?.status ?? 0, lines: null };
    const lines = (await res.text()).split("\n").filter((l) => l.trim());
    try { if (lines.length) JSON.parse(lines[lines.length - 1]); return { status: res.status, lines }; }
    catch { console.log(`    truncated body (${lines.length} lines) — retrying`); await sleep(3000 * (i + 1)); }
  }
  return { status: 200, lines: null };
}

// ── discovery ───────────────────────────────────────────────────────────────
async function latestIndexes(n) {
  const res = await fetchRetry(`${CDX}/collinfo.json`);
  if (!res || !res.ok) return [];
  return (await res.json()).slice(0, n).map((c) => c.id);
}

async function censusIndex(indexId, hosts) {
  const base = `${CDX}/${indexId}-index?url=${encodeURIComponent("*.applytojob.com/apply/*")}&output=json&fl=url&collapse=urlkey`;
  const npRes = await fetchRetry(`${base}&showNumPages=true`);
  if (!npRes || !npRes.ok) { console.log(`  ${indexId}: no page count — skipping`); return; }
  const pages = Number((await npRes.json()).pages) || 0;
  console.log(`  ${indexId}: ${pages} page(s)`);
  for (let p = 0; p < pages; p++) {
    await sleep(400);
    // A one-page result rejects an explicit page= parameter (400), so ask
    // for the page only when there is more than one.
    const { status, lines } = await fetchJsonLines(pages > 1 ? `${base}&page=${p}` : base);
    if (!lines) { console.log(`    page ${p}: unreadable (HTTP ${status || "none"}) — skipped; re-run to fill it`); continue; }
    console.log(`    page ${p}: ${lines.length} index lines`);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const host = new URL(JSON.parse(line).url).hostname.toLowerCase();
        if (!host.endsWith(HOST_SUFFIX)) continue;
        const label = host.slice(0, -HOST_SUFFIX.length);
        if (!label || label.includes(".") || NOT_COMPANY.has(label) || ALIAS_ID.test(label)) continue;
        if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(label)) continue;
        hosts.set(label, (hosts.get(label) || 0) + 1);
      } catch { /* malformed line */ }
    }
  }
}

// ── the same parse the adapter runs (vendors/jazzhr.ts parseJazzhrList) ────
const unesc = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const clean = (s) => unesc(s).replace(/\s+/g, " ").trim();
const ANCHOR = /<a\s[^>]*href=["']([^"']*\/apply\/([A-Za-z0-9]{6,})(?:\/[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/;
function parseList(html) {
  const starts = [...html.matchAll(/list-group-item-heading/g)].map((m) => m.index);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], starts[i + 1]);
    const a = ANCHOR.exec(block);
    if (!a || seen.has(a[2])) continue;
    seen.add(a[2]);
    rows.push({ id: a[2], title: clean(a[3]), location: clean(/fa-map-marker['"]?\s*><\/i>\s*([^<]*)/.exec(block)?.[1] ?? "") });
  }
  return rows;
}
function orgName(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      for (const n of Array.isArray(j) ? j : [j]) if (n?.["@type"] === "Organization" && typeof n.name === "string" && n.name.trim()) return clean(n.name);
    } catch { /* keep looking */ }
  }
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return t ? clean(t).replace(/\s*-\s*Career Page\s*$/i, "") : "";
}
const isCareerPage = (html) => /-\s*Career Page\s*<\/title>/i.test(html) || /list-group-item-heading/.test(html);

// ── verification: one request per host, <=2 in flight, >=300ms apart ───────
let lastStart = 0;
let inFlight = 0;
async function verify(token) {
  while (inFlight >= 2) await sleep(50);
  const wait = 300 - (Date.now() - lastStart);
  if (wait > 0) await sleep(wait);
  lastStart = Date.now();
  inFlight++;
  try {
    let res;
    try {
      res = await fetch(`https://${token}.applytojob.com/apply/`, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
    } catch (e) { return { token, ok: false, reason: `network: ${String(e.message || e).slice(0, 60)}` }; }
    if (res.status === 429) { await sleep(4000); return { token, ok: false, reason: "HTTP 429 (not retried this run)" }; }
    if (!res.ok) return { token, ok: false, reason: `HTTP ${res.status}` };
    const final = new URL(res.url);
    if (/^app\.applytojob\.com$/i.test(final.hostname) || /notfound\.html/i.test(res.url)) return { token, ok: false, reason: "redirected to notfound.html (200)" };
    const html = await res.text();
    if (!isCareerPage(html)) return { token, ok: false, reason: "not a career page" };
    const rows = parseList(html);
    const name = orgName(html);
    return { token, ok: true, name, count: rows.length, host: final.hostname.toLowerCase(), sampleTitles: rows.slice(0, 5).map((r) => r.title) };
  } finally { inFlight--; }
}

// ── main ────────────────────────────────────────────────────────────────────
const hosts = new Map();
if (OFFLINE) {
  for (const [h, n] of JSON.parse(fs.readFileSync(OFFLINE, "utf8"))) {
    const label = String(h).toLowerCase().replace(/\.applytojob\.com$/, "");
    if (!label.includes(".") && !NOT_COMPANY.has(label) && !ALIAS_ID.test(label) && /^[a-z0-9][a-z0-9-]{1,60}$/.test(label)) hosts.set(label, n);
  }
  console.log(`offline: ${hosts.size} candidate tokens from ${OFFLINE}`);
} else {
  const indexes = await latestIndexes(INDEXES);
  if (!indexes.length) { console.error("Could not read the Common Crawl index list — nothing written."); process.exit(1); }
  console.log("Common Crawl indexes:", indexes.join(", "));
  for (const idx of indexes) { await censusIndex(idx, hosts); console.log(`  running total: ${hosts.size} distinct tokens`); }
}

// Never re-verify what the catalog already serves (prefix-anchored, like
// verify-all.mjs — the catalog's optional suffixes must not unmatch a line).
const SOURCES = new URL("../supabase/functions/job-board/sources.ts", import.meta.url);
const existing = new Set();
try {
  for (const m of fs.readFileSync(SOURCES, "utf8").matchAll(/s\("(?:[^"\\]|\\.)*",\s*"jazzhr",\s*"([^"]+)"/g)) existing.add(m[1].toLowerCase());
} catch { /* no catalog in this checkout */ }

let candidates = [...hosts.keys()].filter((t) => !existing.has(t));
const rejected = [];
candidates = candidates.filter((t) => {
  if (TOKEN_BLOCK.test(t)) { rejected.push({ token: t, reason: "token blocklist" }); return false; }
  if (AGGREGATOR_SLUG.test(t)) { rejected.push({ token: t, reason: "aggregator-looking slug" }); return false; }
  return true;
});
// A deterministic shuffle so --sample spans the alphabet instead of the SURT
// head; the seed makes a re-run probe the same boards.
const h = (t) => createHash("sha1").update(`${SEED}:${t}`).digest("hex");
candidates.sort((a, b) => h(a).localeCompare(h(b)));
if (SAMPLE > 0) candidates = candidates.slice(0, SAMPLE);
console.log(`${hosts.size} discovered, ${existing.size} already carried, ${candidates.length} to verify`);

const results = await Promise.all(candidates.map(verify));
const live = [];
const agencies = [];
for (const r of results) {
  if (!r.ok) { rejected.push({ token: r.token, reason: r.reason }); continue; }
  if (r.count < MIN) { rejected.push({ token: r.token, reason: `${r.count} postings < ${MIN}` }); continue; }
  if (!r.name) { rejected.push({ token: r.token, reason: "no employer name on the page" }); continue; }
  if (JUNK_NAME.test(r.name)) { rejected.push({ token: r.token, reason: `junk name: ${r.name}` }); continue; }
  if (GOV_BLOCK.test(r.name)) { rejected.push({ token: r.token, reason: `public sector: ${r.name}` }); continue; }
  if (AGENCY_NAME.test(r.name)) { agencies.push(r); continue; }
  live.push(r);
}
// Collision guard: one employer, one board — the larger one.
const byName = new Map();
for (const r of live) {
  const k = r.name.toLowerCase();
  if (!byName.has(k) || byName.get(k).count < r.count) byName.set(k, r);
}
const kept = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
const collided = live.length - kept.length;

const lit = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lines = kept.map((r) => `  s("${lit(r.name)}", "jazzhr", "${r.token}"),`);
fs.writeFileSync(EMIT, lines.join("\n") + (lines.length ? "\n" : ""));
fs.writeFileSync(OUT, JSON.stringify({
  ranAt: new Date().toISOString(), min: MIN, discovered: hosts.size, alreadyCarried: existing.size,
  verified: kept, agencies, rejected, collided,
}, null, 1));

console.log(`\n  ${results.length} probed → ${kept.length} verified employers (>= ${MIN} postings), ${agencies.length} staffing names set aside, ${collided} same-name collisions folded, ${rejected.length} refused`);
console.log(`  catalog lines → ${EMIT}; evidence → ${OUT}`);
console.log(lines.join("\n"));
