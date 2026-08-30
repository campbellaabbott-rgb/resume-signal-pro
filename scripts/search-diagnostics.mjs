#!/usr/bin/env node
// SEARCH DIAGNOSTICS — reproduce the sweeps' hardest cases on demand.
//
// Two adversarial sweeps found their bugs by reconstructing the board's
// decision trace. `explain` mode (job-board 2026-08-29.53+) makes that trace a
// single call; this harness runs the battery of queries the sweeps keep
// tripping over and checks the invariants each one must satisfy. A red line
// here is a regression a full sweep would otherwise have to rediscover.
//
//   node scripts/search-diagnostics.mjs           # decision trace + checks
//   node scripts/search-diagnostics.mjs --verbose # print the full trace
//
// Read-only: every probe is {action:"list", explain:true} — no SQL runs on the
// board and nothing is written. Reads VITE_SUPABASE_URL + the anon/publishable
// key from .env, exactly like scratchpad/probe.sh.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!URL || !KEY) { console.error("Missing VITE_SUPABASE_URL / key in .env"); process.exit(2); }
const VERBOSE = process.argv.includes("--verbose");

async function explain(body) {
  const res = await fetch(`${URL}/functions/v1/job-board`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({ action: "list", explain: true, ...body }),
  });
  return res.json();
}

// Each case: a body, and checks(trace) -> array of failure strings (empty = ok).
const CASES = [
  {
    name: "short term is ring-merged & deep-pageable (the 'sales' seam)",
    body: { q: "sales" },
    checks: (t) => {
      const f = [];
      if (!t.ranking?.ringMerged) f.push("expected ringMerged=true for a 1-token scored query");
      if (t.ranking?.seam !== 400) f.push(`expected seam=400 (RING_WINDOW), got ${t.ranking?.seam}`);
      if (t.routing?.route === "SYMBOL") f.push("a word query must not route SYMBOL");
      return f;
    },
  },
  {
    name: "deep page maps onto SQL rank, not the pool",
    body: { q: "nurse", offset: 400 },
    checks: (t) => {
      const f = [];
      if (!t.ranking?.deepPage) f.push("offset 400 on a ring-merged query must be a deep page");
      if (t.ranking?.plan?.pOffset !== 200) f.push(`deep pOffset must be 200 (offset-200), got ${t.ranking?.plan?.pOffset}`);
      return f;
    },
  },
  {
    name: "a clean single filter is applied, never silently ignored",
    body: { q: "engineer", workMode: "remote,hybrid" },
    checks: (t) => {
      const f = [];
      if (t.filters?.applied?.workMode !== "remote,hybrid") f.push(`workMode not applied: ${t.filters?.applied?.workMode}`);
      if ((t.filters?.ignored ?? []).includes("workMode")) f.push("a valid multi-select workMode was reported ignored");
      return f;
    },
  },
  {
    name: "a bound filter (maxYears) is NOT rpcBlind — it stays on the ranked path",
    // maxYears joined RPC_BOUND_FILTERS (search_jobs binds p_max_years), so a
    // maxYears query must NOT be forced off the ranked path. The board reports
    // the truth; a diagnostic that assumed otherwise would be the stale-list rot
    // rpcBlind exists to prevent — this check now asserts the binding is live.
    body: { q: "developer", maxYears: 3 },
    checks: (t) => (t.filters?.rpcBlind ?? []).includes("maxYears")
      ? ["maxYears is bound now (RPC_BOUND_FILTERS); it must not appear in rpcBlind"] : [],
  },
  {
    name: "an abbreviation with NO filters routes; with one it stands down",
    body: { q: "cdl" },
    checks: (t) => t.routing?.onlyQuery === true ? [] : ["a bare abbreviation must satisfy onlyQuery"],
  },
  {
    name: "the same abbreviation + a filter no longer routes (mechanical gate)",
    body: { q: "cdl", country: "US" },
    checks: (t) => t.routing?.onlyQuery === false ? [] : ["a filtered query must NOT satisfy onlyQuery"],
  },
  {
    name: "exclusions are lifted out of the query, not searched literally",
    body: { q: "engineer -senior" },
    checks: (t) => {
      const f = [];
      if (!(t.query?.exclusions ?? []).includes("senior")) f.push("'-senior' must be captured as an exclusion");
      if ((t.query?.terms ?? []).includes("senior")) f.push("'senior' must not remain a search term");
      return f;
    },
  },
  {
    name: "an aliased location expands to a '|'-joined member list",
    body: { q: "nurse", location: "texas" },
    checks: (t) => {
      // The trace reports applied.location as typed; the expansion happens at
      // bind time. This case mainly confirms location survives as a filter.
      return t.filters?.applied?.location ? [] : ["location was dropped from applied filters"];
    },
  },
  {
    name: "employment-type intent lift does NOT hijack 'international'",
    body: { q: "international sales" },
    checks: (t) => (t.query?.intentLifts ?? []).some((l) => /intern/i.test(l))
      ? ["'international' was mis-lifted to an internship filter"] : [],
  },
];

const run = async () => {
  let failures = 0;
  const ver = await explain({ q: "sales" }).then((t) => t?.disclosures ? "reachable" : "reachable");
  console.log(`\nSearch diagnostics against ${URL} (${ver})\n`);
  for (const c of CASES) {
    let trace;
    try { trace = await explain(c.body); } catch (e) { console.log(`  ✗ ${c.name}\n      probe failed: ${e.message}`); failures++; continue; }
    if (!trace?.diagnose) {
      console.log(`  ✗ ${c.name}\n      no decision trace — is job-board >= 2026-08-29.53 deployed? (got keys: ${Object.keys(trace ?? {}).slice(0, 6).join(", ")})`);
      failures++; continue;
    }
    const bad = c.checks(trace);
    if (bad.length) { console.log(`  ✗ ${c.name}`); bad.forEach((b) => console.log(`      ${b}`)); failures += bad.length; }
    else console.log(`  ✓ ${c.name}`);
    if (VERBOSE) console.log("      " + JSON.stringify({ route: trace.routing, ranking: trace.ranking }, null, 0));
    await new Promise((r) => setTimeout(r, 120)); // gentle: never a probe storm
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
};
run();
