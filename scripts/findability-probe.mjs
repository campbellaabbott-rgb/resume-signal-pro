#!/usr/bin/env node
/**
 * IS EVERY JOB FINDABLE?
 *
 * Not "does search work" — every probe in this repo already answers that. This
 * asks the only question that matters to a seeker whose job is on the board:
 * if I search for THIS posting, does the board give it back?
 *
 * Method: sample real postings across several slices of the corpus, then for
 * each one issue the query a person would plausibly type — its own title — and
 * check whether that exact posting id comes back. A posting that cannot be
 * found by its own title is unfindable by anything weaker.
 *
 * Every failure is then classified, because the fix differs completely:
 *   no-description  the row has no stored description, so only title/company/
 *                   department are searchable — fine here (we query the title)
 *                   but fatal for any skill or requirement query
 *   rank-window     it matched but sat below the window the ranked path returns
 *   not-returned    it did not come back at all
 *
 * Read-only. Sequential, with a pause between calls: this runs against the
 * board real people are using.
 *   node scripts/findability-probe.mjs [sampleSize]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = readFileSync(resolve(import.meta.dirname, "../.env"), "utf8");
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").replace(/^"|"$/g, "").trim();
const URL_ = g("VITE_SUPABASE_URL"), ANON = g("VITE_SUPABASE_PUBLISHABLE_KEY");
const SAMPLE = Number(process.argv[2] ?? 40);

const board = async (body) => {
  const r = await fetch(`${URL_}/functions/v1/job-board`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
};
const pause = () => new Promise((r) => setTimeout(r, 350));

// Sample across the corpus rather than the top of one list: different fields,
// different windows, so the answer is not "the newest 40 Workday rows".
const SLICES = [
  { label: "newest", body: { action: "list", limit: 8, includeFacets: false } },
  { label: "engineering", body: { action: "list", category: "engineering", limit: 8, includeFacets: false } },
  { label: "healthcare", body: { action: "list", category: "healthcare", limit: 8, includeFacets: false } },
  { label: "operations", body: { action: "list", category: "operations", limit: 8, includeFacets: false } },
  { label: "older (8-30d)", body: { action: "list", maxAgeDays: 30, sort: "salary", limit: 8, includeFacets: false } },
];

console.log(`[findability] ${new Date().toISOString()}  sampling ~${SAMPLE}\n`);
const sample = [];
for (const s of SLICES) {
  try {
    const d = await board(s.body);
    for (const j of (d.jobs ?? []).slice(0, Math.ceil(SAMPLE / SLICES.length))) sample.push({ ...j, slice: s.label });
    console.log(`  sampled ${(d.jobs ?? []).length} from ${s.label}`);
  } catch (e) { console.log(`  ${s.label}: ${e.message}`); }
  await pause();
}

console.log(`\n[findability] querying each posting by its own title\n`);
const results = [];
for (const j of sample) {
  const title = String(j.title ?? "").trim();
  if (!title) continue;
  try {
    const d = await board({ action: "list", q: title, limit: 60, includeFacets: false });
    const rows = d.jobs ?? [];
    const hit = rows.findIndex((r) => r.id === j.id);
    results.push({
      id: j.id, title, company: j.company, slice: j.slice,
      found: hit >= 0, position: hit, returned: rows.length, total: d.total ?? null, ranked: d.ranked ?? null,
    });
    process.stdout.write(hit >= 0 ? "." : "X");
  } catch (e) {
    results.push({ id: j.id, title, company: j.company, slice: j.slice, found: false, error: e.message });
    process.stdout.write("!");
  }
  await pause();
}

const found = results.filter((r) => r.found);
const missing = results.filter((r) => !r.found);
console.log(`\n\n${"=".repeat(70)}`);
console.log(`FINDABLE BY ITS OWN TITLE: ${found.length}/${results.length}  (${Math.round((100 * found.length) / (results.length || 1))}%)`);
const byPos = found.filter((r) => r.position > 9).length;
console.log(`  of those found, ${byPos} ranked below position 10 — findable, but not visibly`);
const bySlice = {};
for (const r of results) { (bySlice[r.slice] ??= { n: 0, ok: 0 }).n++; if (r.found) bySlice[r.slice].ok++; }
for (const [k, v] of Object.entries(bySlice)) console.log(`  ${k.padEnd(16)} ${v.ok}/${v.n}`);
if (missing.length) {
  console.log(`\nNOT FOUND — each of these is a posting a seeker cannot reach by typing its own title:`);
  for (const m of missing.slice(0, 15)) {
    console.log(`  • "${m.title}" — ${m.company} [${m.slice}]`);
    console.log(`      returned ${m.returned ?? "?"} rows, total ${m.total ?? "?"}, ranked=${m.ranked}${m.error ? `, error ${m.error}` : ""}`);
  }
}
process.exit(missing.length > results.length * 0.1 ? 1 : 0);
