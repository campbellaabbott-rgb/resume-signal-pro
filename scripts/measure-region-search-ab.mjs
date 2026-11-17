#!/usr/bin/env node
// MEASURE THE REGION SEARCH (MCP upgrade 3, W1 lane L2: F1, M9). Read-only.
//
// Two things the connector's region reading needs, measured through the
// site's own public board search (job-board action list), at most 60 reads,
// every one sent as a probe:
//
//   1. THE ORDER a large region (the EU, the EEA, Europe) is cut to 5 by: each
//      of Europe's 32 members by the postings this connector serves, most
//      first. Served = the board's count for the country, less SmartRecruiters
//      and USAJOBS (shown on the site, never handed on by the connector). A
//      count the board caps is re-counted as three vendor groups that cover
//      every served vendor. Only as many members are refined as it takes to
//      settle the 5 at the head of each of the three regions; the tail is
//      ordered by the board's own count and says so. When the head cannot be
//      settled inside the budget, it prints UNRESOLVED and no order to store.
//
//   2. THE A/B behind regionNote: the same query with remote on, searched as
//      location "Europe" and as country <Europe's top 5>. Per arm it prints
//      the total, the rows whose titles hold every query word, the share of
//      rows that name no country, the rows the connector may hand on, and the
//      overlap between the arms. No copy claims a first try until this runs.
//
// The order it prints is what supabase/functions/agent-mcp/regions.ts stores
// in EUROPE_BY_POSTINGS, with the date it ran.
//
// Usage: node scripts/measure-region-search-ab.mjs
// Reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the
// environment or the repo's .env; prints neither. MEASURE_PAUSE_MS sets the
// pause between reads (400 by default; 0 only against a local mock).
// MEASURE_WITHHELD names more vendors the connector no longer hands on
// (comma-separated, for example "ukg,adp,breezy" once round A withholds
// them): they are counted as withheld, not served, so the order is re-cut
// on what is served then.

import { readFileSync } from "node:fs";
import { COUNTRIES_PER_SEARCH, REGIONS } from "../supabase/functions/agent-mcp/regions.ts";

const MAX_READS = 60;
/** Reads kept back for the A/B: one query, both arms, at the least. */
const AB_FLOOR = 2;
const AB_QUERIES = ["senior data engineer", "software engineer", "product manager"];
const EXTRA_WITHHELD = String(process.env.MEASURE_WITHHELD ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
const WITHHELD = [...new Set(["smartrecruiters", "usajobs", ...EXTRA_WITHHELD])];
/** Every served vendor, in groups of at most 8 (the board's vendor cap). */
const SERVED_GROUPS = [
  ["greenhouse", "lever", "ashby", "workable", "bamboohr", "recruitee", "teamtailor", "personio"],
  ["breezy", "rippling", "workday", "pinpoint", "oracle", "icims", "paylocity", "ukg"],
  ["adp", "jazzhr"],
].map((g) => g.filter((v) => !WITHHELD.includes(v))).filter((g) => g.length);
if (WITHHELD.length > 8) {
  console.error(`MEASURE_WITHHELD names ${WITHHELD.length} vendors; the board counts at most 8 in one read: nothing was read.`);
  process.exit(1);
}
const WITHHELD_NAMES = WITHHELD.map((v) => ({ smartrecruiters: "SmartRecruiters", usajobs: "USAJOBS" })[v] ?? v);
const WITHHELD_SAID = WITHHELD_NAMES.length > 1 ? `${WITHHELD_NAMES.slice(0, -1).join(", ")} and ${WITHHELD_NAMES.at(-1)}` : WITHHELD_NAMES.join("");

const env = (() => {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const at = line.indexOf("=");
      if (at < 1) continue;
      const k = line.slice(0, at).trim();
      if (!out[k]) out[k] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* the environment alone */ }
  return out;
})();
const BASE = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!BASE || !KEY) {
  console.error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not found (environment or .env): nothing was read.");
  process.exit(1);
}

let reads = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One board read. Throws once the budget is spent: the cap is the script's, not the caller's. */
async function board(body) {
  if (reads >= MAX_READS) throw new Error(`read budget of ${MAX_READS} spent`);
  reads++;
  let status = 0;
  let json = null;
  try {
    const res = await fetch(`${BASE}/functions/v1/job-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}`, "x-rb-budget": "probe" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch (e) {
    status = -1;
    json = { error: String(e?.name ?? e) };
  }
  await sleep(Number(process.env.MEASURE_PAUSE_MS ?? 400));
  return { status, body: json };
}

/** A count of the board's rows for these filters: { n, capped } or null when the board gave none. */
async function count(filters) {
  const r = await board({ action: "list", countOnly: true, ...filters });
  const b = r.body ?? {};
  if (r.status !== 200 || typeof b.total !== "number") {
    return { n: null, capped: false, why: `HTTP ${r.status}${b.countUnavailable ? " countUnavailable" : ""}${b.ignoredFilters ? ` ignored ${b.ignoredFilters}` : ""}` };
  }
  if (Array.isArray(b.ignoredFilters) && b.ignoredFilters.length) {
    return { n: null, capped: false, why: `ignored ${b.ignoredFilters.join(",")}` };
  }
  return { n: b.total, capped: b.countCapped === true };
}

const today = new Date().toISOString().slice(0, 10);
const EUROPE = [...REGIONS.europe.members];
const LARGE = ["europe", "eea", "eu"];
console.log(`measure-region-search-ab ${new Date().toISOString()}: ${EUROPE.length} members of Europe, at most ${MAX_READS} reads, each sent with x-rb-budget probe; withheld: ${WITHHELD_SAID}`);

// ---- 1. The board's count for each member. ----
const stat = new Map();
console.log("\n1. The board's count per country (countOnly, no query):");
for (const c of EUROPE) {
  const r = await count({ country: c });
  stat.set(c, {
    total: r.n, capped: r.capped, why: r.why,
    // Bounds on what the connector serves from this country.
    lo: 0, hi: r.n === null || r.capped ? Infinity : r.n, refined: false, how: r.n === null ? "no count" : r.capped ? "capped" : "board count",
  });
  console.log(`   ${c}: ${r.n === null ? `no count (${r.why})` : `${r.n}${r.capped ? " (capped)" : ""}`}`);
}

// ---- 2. Refine the head until each large region's top 5 is settled. ----
const membersOf = (key) => [...REGIONS[key].members];
const value = (s) => (s.refined ? s.lo : s.hi === Infinity ? Infinity : s.hi);
function headOf(key) {
  const ms = membersOf(key);
  const ranked = [...ms].sort((a, b) => stat.get(b).lo - stat.get(a).lo || value(stat.get(b)) - value(stat.get(a)) || a.localeCompare(b));
  const top = ranked.slice(0, COUNTRIES_PER_SEARCH);
  const rest = ranked.slice(COUNTRIES_PER_SEARCH);
  const floor = Math.min(...top.map((c) => stat.get(c).lo));
  const ceiling = Math.max(0, ...rest.map((c) => stat.get(c).hi));
  return { top, settled: floor >= ceiling && top.every((c) => stat.get(c).refined), floor, ceiling };
}

async function refine(c) {
  const s = stat.get(c);
  if (s.total !== null && !s.capped) {
    const w = await count({ country: c, vendor: WITHHELD.join(",") });
    // Left unrefined and out of the pool: a head that needs it stays unsettled.
    if (w.n === null || w.capped) { s.how = `withheld unread (${w.why ?? "capped"})`; s.stuck = true; return; }
    s.lo = s.hi = s.total - w.n;
    s.how = `exact: ${s.total} less ${w.n} withheld`;
  } else {
    const parts = [];
    let open = false;
    for (const g of SERVED_GROUPS) {
      const p = await count({ country: c, vendor: g.join(",") });
      if (p.n === null) { open = true; parts.push("?"); continue; }
      if (p.capped) open = true;
      parts.push(`${p.n}${p.capped ? "+" : ""}`);
      s.lo += p.n;
    }
    s.hi = open ? Infinity : s.lo;
    s.how = `${open ? "at least" : "exact"}: ${parts.join(" + ")} by vendor group`;
  }
  s.refined = true;
}

console.log(`\n2. Refining the head (served = board count less ${WITHHELD_SAID}):`);
let unresolved = null;
for (;;) {
  const open = LARGE.filter((k) => !headOf(k).settled);
  if (!open.length) break;
  const pool = [...new Set(open.flatMap(membersOf))].filter((c) => !stat.get(c).refined && !stat.get(c).stuck);
  if (!pool.length) { unresolved = `the head of ${open.join(", ")} stays unsettled with every candidate refined (a capped vendor group or a missing count)`; break; }
  pool.sort((a, b) => stat.get(b).hi - stat.get(a).hi || (stat.get(b).total ?? 0) - (stat.get(a).total ?? 0) || a.localeCompare(b));
  const next = pool[0];
  const cost = stat.get(next).total !== null && !stat.get(next).capped ? 1 : SERVED_GROUPS.length;
  if (reads + cost > MAX_READS - AB_FLOOR) { unresolved = `the read budget ran out with the head of ${open.join(", ")} unsettled`; break; }
  await refine(next);
  console.log(`   ${next}: ${stat.get(next).how}`);
}

// The stored order: the settled head by what the connector serves, then the
// tail by the board's own count (an upper bound on what is served).
const order = [...EUROPE].sort((a, b) => {
  const va = value(stat.get(a)), vb = value(stat.get(b));
  return vb - va || Number(stat.get(b).refined) - Number(stat.get(a).refined) || a.localeCompare(b);
});

console.log("\n3. Each large region's members, most served postings first:");
for (const key of LARGE) {
  const h = headOf(key);
  const o = order.filter((c) => REGIONS[key].members.includes(c));
  const shown = o.map((c) => {
    const s = stat.get(c);
    const v = s.refined ? (s.hi === Infinity ? `>=${s.lo}` : `${s.lo}`) : s.total === null ? "?" : `<=${s.total}`;
    return `${c} ${v}`;
  });
  console.log(`   ${REGIONS[key].name} (${o.length}): head ${h.settled ? "SETTLED" : "UNSETTLED"} (5th of the head ${h.floor} >= the rest's most ${h.ceiling === Infinity ? "unknown" : h.ceiling}: ${h.floor >= h.ceiling})`);
  console.log(`     top ${COUNTRIES_PER_SEARCH}: ${o.slice(0, COUNTRIES_PER_SEARCH).join(",")}`);
  console.log(`     order: ${shown.join(", ")}`);
}

// ---- 4. The A/B: location "Europe" against country <top 5>, remote on. ----
const top5 = order.slice(0, COUNTRIES_PER_SEARCH).join(",");
const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
console.log(`\n4. A/B, remote on, limit 50: location "Europe" against country ${top5}:`);
for (const q of AB_QUERIES) {
  if (reads + 2 > MAX_READS) { console.log(`   "${q}": not run (read budget)`); continue; }
  const arms = {};
  for (const [arm, extra] of [["location Europe", { location: "Europe" }], [`country ${top5}`, { country: top5 }]]) {
    const r = await board({ action: "list", q, remote: true, limit: 50, groupSimilar: false, includeFacets: false, ...extra });
    const jobs = Array.isArray(r.body?.jobs) ? r.body.jobs : [];
    const titled = jobs.filter((j) => words(q).every((w) => String(j.title ?? "").toLowerCase().includes(w)));
    const noCountry = jobs.filter((j) => !j.country);
    const served = jobs.filter((j) => !WITHHELD.includes(String(j.source ?? "")));
    arms[arm] = new Set(jobs.map((j) => j.id));
    const pct = (n) => (jobs.length ? `${Math.round((100 * n) / jobs.length)}%` : "n/a");
    console.log(
      `   "${q}" / ${arm}: HTTP ${r.status}, total ${r.body?.total ?? "?"}${r.body?.countCapped ? " (capped)" : ""}, ${jobs.length} rows; ` +
        `title holds every word ${titled.length}; no country ${noCountry.length} (${pct(noCountry.length)}); handed on ${served.length}` +
        `${Array.isArray(r.body?.ignoredFilters) && r.body.ignoredFilters.length ? `; ignored ${r.body.ignoredFilters.join(",")}` : ""}`,
    );
  }
  const [a, b] = Object.values(arms);
  console.log(`   "${q}": rows in both arms ${[...a].filter((id) => b.has(id)).length}`);
}

console.log(`\nreads: ${reads} of ${MAX_READS}`);
if (unresolved || !LARGE.every((k) => headOf(k).settled)) {
  console.log(`UNRESOLVED: ${unresolved ?? "a head is unsettled"}. No order to store: EUROPE_BY_POSTINGS stays null.`);
  process.exit(2);
}
const heads = LARGE.map((k) => { const h = headOf(k); return `${k}: { fifth: ${h.floor}, nextAtMost: ${h.ceiling} }`; }).join(", ");
console.log("\nPaste into supabase/functions/agent-mcp/regions.ts (EUROPE_BY_POSTINGS's value):");
console.log(
  `{\n` +
    `  measuredAt: "${today}",\n` +
    `  basis: "scripts/measure-region-search-ab.mjs: per country, the board's count less ${WITHHELD_SAID}, which settles the 5 at the head of the EU, the EEA and Europe; a member past every head whose withheld rows were not counted is ordered by the board's count",\n` +
    `  order: [${order.map((c) => `"${c}"`).join(", ")}],\n` +
    `  heads: { ${heads} },\n` +
    `}`,
);
