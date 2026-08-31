#!/usr/bin/env node
// iCIMS round-3 STAGING (no merge): name, alias-kill, and corporate-screen the
// census-custom-domains candidates so the orchestrator merges a clean tranche.
//
// Why a stager exists at all: merge-all.mjs does not carry this vendor in its
// VENDORS list — icims tranches have always been merged by hand under the
// protocol in the sources.ts icims banner. This script does the machine part
// of that protocol and STOPS. It never touches sources.ts.
//
// Naming: an employer name comes from the employer (repo rule — the round-2
// banner records why: postholdings.icims.com posts as Michael Foods Inc, and
// the tenant slug would have named it wrong). Primary source is the feed's own
// hiring_organization on the /api/jobs list payload; measured 2026-08-30, some
// tenants (jobs.uhs.com) omit that field entirely, so the fallback walks to a
// posting detail page and reads schema.org JobPosting hiringOrganization —
// still the employer's own words, just on the page instead of in the feed.
// A host with no readable name stays UNNAMED and is excluded.
//
// Alias-kill: Foot Locker answered on careers. AND jobs. in round 2 — one
// board, two hosts, and keeping both ingests every posting twice. The
// fingerprint is resolved name (case-folded) plus totalCount within 3%,
// checked against BOTH the other candidates and the icims boards already in
// sources.ts. Prefer the carried host; among new dupes keep the bigger board.
// Carried-board counts are probed live, capped to the ~20 whose names are
// similar to a candidate — the other 120 cannot alias anything here.
//
// The corporate-only screens are COPIED VERBATIM from merge-all.mjs, not
// imported: that file exports nothing (top-level script), and the census
// scripts share nothing by import — the same trade its HIRING_VOCAB comment
// documents. If merge-all's screens change, re-copy.
//
// Politeness: max 5 in flight, ≥200ms between request starts, one retry.
//
// Usage: node scripts/stage-icims.mjs <icims-netnew.json> [out.json]

import fs from "node:fs";
import path from "node:path";

const inFile = process.argv[2];
if (!inFile) { console.error("usage: node scripts/stage-icims.mjs <icims-netnew.json> [out.json]"); process.exit(1); }
const outFile = process.argv[3] ?? path.join(path.dirname(inFile), "icims-staged.json");
const candidates = JSON.parse(fs.readFileSync(inFile, "utf8"));

const SOURCES = new URL("../supabase/functions/job-board/sources.ts", import.meta.url).pathname;
const src = fs.readFileSync(SOURCES, "utf8");

// ── screens copied verbatim from merge-all.mjs (see header) ────────────────
const NAME_BLOCK = /\b(staffing|recruit(ing|ment|er)?s?|talents?|headhunt|personnel|manpower|workforce|employment\s+(agency|services)|placements?\b|temp\s|outsourc|bpo\b|int[eé]rim|travail\s+temporaire|trabajo\s+temporal|demo|test|sample|sandbox|placeholder)\b|\b(uitzend|zeitarbeit|personaldienst|jobandtalent)/i;
const GOV_BLOCK = /\b(city of|county of|state of|commonwealth of|government of|unified school|school district|public schools|public library|court of appeals|county commissioners|conservation district|health district|sheriff|police department|fire department|township of|municipality)\b/i;
const TOKEN_BLOCK = /(demo|test|sample|sandbox|staging)/i;
const MILL_BLOCK = new Set([
  "workable:solution-sft",
  "workable:gotham-enterprises",
  "workable:ubteam",
  "workable:the-symicor-group-1",
  "teamtailor:bluestorm",
  "teamtailor:groupelrtechnologies",
  "teamtailor:jobtalentfrance",
  "teamtailor:wearediverse2",
  "rippling:barrys-careers",
  "smartrecruiters:collabera2",
  "smartrecruiters:procomservices",
  "workable:next-job-abroad",
  "workable:unitedplacementgroup",
  "workable:schwertfels",
  "smartrecruiters:fosadconsulting",
  "smartrecruiters:iotagroup",
  "recruitee:techbizglobal",
  "paylocity:668dc5ae-50dc-451f-bc59-bdc869ac7bbe",
  "greenhouse:n2alljobs",
]);
const decodeEntities = (s) => s
  .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
// ── end verbatim copies ────────────────────────────────────────────────────

// Carried icims boards, from sources.ts. Both this vendor's entries are the
// object-literal format; the legacy s() helper predates the vendor.
const carried = [...src.matchAll(/\{\s*name:\s*"((?:[^"\\]|\\.)*)",\s*source:\s*"icims",\s*token:\s*"([^"]+)"/g)]
  .map((m) => ({ name: m[1], token: m[2] }));
const carriedTokens = new Set(carried.map((c) => c.token.toLowerCase()));
console.log(`carried icims boards parsed from sources.ts: ${carried.length}`);

const fold = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
// Second key for "similar": letters+digits only, so punctuation and Inc/Corp
// commas don't hide a same-board pair when the two hosts style the name
// slightly differently.
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, "");

// ── polite fetch: global 200ms start spacing, pool of 5, one retry ─────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let gate = Promise.resolve();
const paced = () => { const wait = gate.then(() => sleep(200)); gate = wait; return wait; };
const UA = { "User-Agent": "resumebooster.work job board (contact: support@resumebooster.work)" };
async function get(url, asText = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await paced();
    try {
      const res = await fetch(url, {
        headers: { ...UA, Accept: asText ? "text/html" : "application/json" },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      if (!res.ok) { if (attempt === 0 && res.status >= 500) { await sleep(1000); continue; } return { err: `HTTP ${res.status}` }; }
      return { body: asText ? await res.text() : await res.json() };
    } catch (e) {
      if (attempt === 0) { await sleep(1000); continue; }
      return { err: String(e?.cause?.code ?? e?.name ?? e).slice(0, 80) };
    }
  }
}
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) { const n = i++; if (n >= items.length) return; out[n] = await fn(items[n], n); }
  }));
  return out;
}

// schema.org JobPosting → hiringOrganization.name, every ld+json node checked
// (the descriptions.ts helper documents why first-node-only finds nothing).
function ldHiringOrg(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of String(html ?? "").matchAll(re)) {
    let parsed; try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [];
    for (const n of Array.isArray(parsed) ? parsed : [parsed]) {
      if (n && Array.isArray(n["@graph"])) nodes.push(...n["@graph"]); else nodes.push(n);
    }
    for (const n of nodes) {
      if (!n || n["@type"] !== "JobPosting") continue;
      const org = n.hiringOrganization;
      const name = typeof org === "string" ? org : org?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

// The list-payload fields an employer name has actually been seen in, tried in
// order across all sampled items. hiring_organization is the documented one;
// the others are speculative fallbacks and the run reports which fired where.
const LIST_NAME_FIELDS = ["hiring_organization", "company", "company_name", "brand"];

async function probeCandidate(c) {
  const r = await get(`https://${c.host}/api/jobs?page=1&limit=5`);
  if (r.err) return { ...c, probeErr: r.err };
  const body = r.body ?? {};
  const items = Array.isArray(body.jobs) ? body.jobs : [];
  const totalCount = Number(body.totalCount) || items.length;
  // MAJORITY vote across the sampled items, not first-non-empty. Measured
  // 2026-08-30: Rollins and Exelon front one shared instance with five-plus
  // brand domains, and every item names the BRAND that posted it — the first
  // item on careers.comed.com happened to say a sibling utility's name. The
  // vote is deterministic (count, then alphabetical), and two hosts serving
  // the same instance sample the same items, so aliases still resolve to the
  // SAME name and the alias-kill below still catches them.
  let name = null, nameField = null, brandTally = null;
  for (const f of LIST_NAME_FIELDS) {
    const tally = new Map();
    for (const it of items) {
      const v = it?.data?.[f];
      if (typeof v === "string" && v.trim()) tally.set(v.trim(), (tally.get(v.trim()) ?? 0) + 1);
    }
    if (tally.size > 0) {
      name = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      nameField = f;
      if (tally.size > 1) brandTally = Object.fromEntries(tally);
      break;
    }
  }
  if (!name && items.length > 0) {
    const d = items[0]?.data ?? {};
    const ext = String(d.slug ?? d.req_id ?? "").trim();
    if (ext) {
      const page = await get(`https://${c.host}/jobs/${encodeURIComponent(ext)}/job`, true);
      if (page.body) { name = ldHiringOrg(page.body); if (name) nameField = "ld+json hiringOrganization"; }
    }
  }
  if (name) name = decodeEntities(name).trim();
  return { ...c, totalCount, listItems: items.length, name, nameField, brandTally };
}

// Among same-name same-count hosts of one shared instance, prefer the host
// whose own domain echoes the resolved name — careers.exeloncorp.com is a
// better face for "Exelon" than a sibling utility's domain. Generic labels
// and short fragments carry no signal and score zero.
const GENERIC_LABELS = new Set(["careers", "jobs", "www", "com", "net", "org", "edu", "ca", "us", "uk", "co", "ie", "de", "fr", "be"]);
function hostAffinity(host, name) {
  const n = norm(name);
  if (!n) return 0;
  // acronym: careers.uti.edu IS Universal Technical Institute's own domain,
  // but a three-letter label can't clear the substring bar below
  const acronym = fold(name).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join("");
  for (const label of host.toLowerCase().split(".")) {
    if (GENERIC_LABELS.has(label)) continue;
    if (label.length >= 3 && label === acronym) return 1;
    if (label.length < 4) continue;
    if (n.includes(label) || label.includes(n)) return 1;
  }
  return 0;
}

console.log(`probing ${candidates.length} candidate hosts…`);
const probed = await pool(candidates, 5, probeCandidate);

const unnamed = probed.filter((p) => !p.name);
const named = probed.filter((p) => p.name);
console.log(`named ${named.length}, unnamed ${unnamed.length}`);

// ── alias-kill vs the carried catalog ──────────────────────────────────────
// Probe only carried boards whose name is similar to some candidate's; a
// carried board no candidate resembles cannot alias anything in this tranche.
const candNames = new Set(named.map((p) => fold(p.name)));
const candNorms = new Set(named.map((p) => norm(p.name)));
const similar = carried.filter((b) => candNames.has(fold(b.name)) || candNorms.has(norm(b.name)));
const CARRIED_PROBE_CAP = 20;
const toProbe = similar.slice(0, CARRIED_PROBE_CAP);
if (similar.length > CARRIED_PROBE_CAP) console.log(`carried similar=${similar.length}, probing first ${CARRIED_PROBE_CAP}`);
console.log(`probing ${toProbe.length} carried board(s) with names similar to a candidate: ${toProbe.map((b) => b.token).join(", ") || "(none)"}`);
const carriedCounts = new Map();
await pool(toProbe, 5, async (b) => {
  const r = await get(`https://${b.token}/api/jobs?page=1&limit=1`);
  const n = Number(r.body?.totalCount);
  if (Number.isFinite(n)) carriedCounts.set(b.token, n);
  else console.log(`  carried probe failed ${b.token}: ${r.err ?? "no totalCount"}`);
});

const within3pct = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.03 * Math.max(a, b, 1);
const kills = [];
const warnings = [];
let survivors = [];
for (const p of named) {
  // exact-token overlap with the catalog is not an alias, it's a dupe the
  // "netnew" input promised not to contain — belt and braces
  if (carriedTokens.has(p.host.toLowerCase())) {
    kills.push({ host: p.host, name: p.name, count: p.totalCount, reason: "token already carried in sources.ts" });
    continue;
  }
  const twin = toProbe.find((b) => (fold(b.name) === fold(p.name) || norm(b.name) === norm(p.name)) && carriedCounts.has(b.token));
  if (twin && within3pct(p.totalCount, carriedCounts.get(twin.token))) {
    kills.push({ host: p.host, name: p.name, count: p.totalCount, reason: `alias of carried ${twin.token} ("${twin.name}", ${carriedCounts.get(twin.token)} postings, within 3%) — carried host preferred` });
    continue;
  }
  if (twin) warnings.push({ host: p.host, name: p.name, count: p.totalCount, note: `name matches carried ${twin.token} but counts differ (${p.totalCount} vs ${carriedCounts.get(twin.token)}) — kept; orchestrator judges the collision` });
  survivors.push(p);
}

// among the new boards themselves: same folded name + counts within 3% =
// one board on several hosts. Biggest count survives.
const byName = new Map();
for (const p of survivors) {
  const k = norm(p.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}
survivors = [];
for (const group of byName.values()) {
  group.sort((a, b) => b.totalCount - a.totalCount
    || hostAffinity(b.host, b.name) - hostAffinity(a.host, a.name)
    || (a.host < b.host ? -1 : 1));
  const kept = [group[0]];
  for (const p of group.slice(1)) {
    const twin = kept.find((k) => within3pct(k.totalCount, p.totalCount));
    if (twin) kills.push({ host: p.host, name: p.name, count: p.totalCount, reason: `alias of candidate ${twin.host} (same name, ${twin.totalCount} vs ${p.totalCount} postings, within 3%) — bigger board kept` });
    else kept.push(p); // same name, genuinely different size: distinct boards until proven otherwise
  }
  survivors.push(...kept);
}

// ── corporate-only screens, applied exactly as merge-all applies them ──────
const blockedList = [];
const keptList = [];
for (const p of survivors) {
  const rule = TOKEN_BLOCK.test(p.host) ? "TOKEN_BLOCK"
    : MILL_BLOCK.has(`icims:${p.host.toLowerCase()}`) ? "MILL_BLOCK"
    : NAME_BLOCK.test(p.name) ? "NAME_BLOCK"
    : GOV_BLOCK.test(p.name) ? "GOV_BLOCK"
    : null;
  if (rule) blockedList.push({ host: p.host, name: p.name, count: p.totalCount, rule });
  else keptList.push(p);
}

keptList.sort((a, b) => b.totalCount - a.totalCount);
const boards = keptList.map((p) => ({ token: p.host, name: p.name, count: p.totalCount }));
const ledger = {
  unnamed: unnamed.length,
  aliasKilled: kills.length,
  blocked: blockedList.length,
  kept: boards.length,
  keptPostings: boards.reduce((s, b) => s + b.count, 0),
};
const nameFieldTally = {};
for (const p of named) nameFieldTally[p.nameField] = (nameFieldTally[p.nameField] ?? 0) + 1;

fs.writeFileSync(outFile, JSON.stringify({
  boards,
  ledger,
  kills,
  warnings,
  blocked: blockedList,
  unnamed: unnamed.map((p) => ({ host: p.host, jobs: p.jobs, reason: p.probeErr ?? (p.listItems === 0 ? "empty board, no items to read" : "no name field in payload or detail page") })),
  // Kept boards whose sample named more than one brand: one shared instance
  // fronting a family of domains. The staged name is the sample majority; a
  // human may prefer the parent's name at merge time (Reyes Holdings
  // precedent in the sources.ts icims banner).
  multiBrand: keptList.filter((p) => p.brandTally).map((p) => ({ token: p.host, name: p.name, sampleTally: p.brandTally })),
  nameFieldTally,
  // every host whose name did NOT come from the primary list-payload field,
  // so the merge reviewer can see exactly which employers self-named where
  nameFieldExceptions: named.filter((p) => p.nameField !== "hiring_organization")
    .map((p) => ({ host: p.host, field: p.nameField, name: p.name })),
}, null, 1));

console.log(`\nledger: ${JSON.stringify(ledger)}`);
console.log(`name fields: ${JSON.stringify(nameFieldTally)}`);
for (const k of kills) console.log(`KILL  ${k.host} "${k.name}" — ${k.reason}`);
for (const b of blockedList) console.log(`BLOCK ${b.host} "${b.name}" — ${b.rule}`);
for (const w of warnings) console.log(`WARN  ${w.host} — ${w.note}`);
console.log(`\nwrote ${outFile} (${boards.length} staged boards). NO merge performed.`);
