import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "HOW FRESH, AND FROM WHICH SYSTEMS" IS THE FIRST QUESTION A BUYER ASKS.
 *
 * job-board's status action has answered it for months — measured
 * re-verification age, per-source description and stated-date coverage, and the
 * quarantined vendor set — and every one of those numbers was on an internal
 * endpoint while /v1/stats, the surface people pay for, published four counts
 * and a lifecycle block. A customer evaluating the dataset could learn how MANY
 * postings exist and nothing about how well any hiring system was covered.
 *
 * SURFACING THEM IS THE EASY HALF. The hard half is that two of these numbers
 * are easy to misread in a way that flatters us, and this repo has already paid
 * for both mistakes:
 *
 *   * freshness measures OUR re-check cadence, not a posting's age. The Ghost
 *     Job Index once published "2.8d median age of an open posting" computed
 *     from first_seen — our discovery stamp — and a reader caught it before any
 *     check did. Every stat here names its basis for that reason.
 *
 *   * the per-source totals stand on `missing_since IS NULL` WITHOUT the 30-day
 *     window, because that is how the rollup computes them. They therefore sum
 *     above livePostings and below trackedPostings, and a customer dividing one
 *     by the other would be putting a numerator and a denominator from two
 *     different populations over each other — the exact defect that inflated
 *     every figure in the board's own coverage block by 1.5-3%.
 *
 * COMMENT-STRIPPED: the prose above and in public-api quotes the very phrases
 * being asserted, and a scanner reading comments would pass on the explanation
 * of a bug rather than on its fix.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const API = strip(read("supabase/functions/public-api/index.ts"));
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const DOCS = strip(read("src/pages/DataApi.tsx"));

/** The stats() body, bounded by its own closing rather than a char window. */
const STATS = (() => {
  const i = API.indexOf("async function stats(client: SupabaseClient");
  expect(i, "stats() not found").toBeGreaterThan(-1);
  return API.slice(i);
})();

/** Newest migration containing `needle`. */
const newestWith = (needle: string) => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes(needle)).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
};
const ROLLUP_SQL = newestWith("CREATE OR REPLACE FUNCTION public.refresh_job_board_stats");

describe("how fresh, and from which systems", () => {
  it("the numbers the board measures reach the endpoint that is sold", () => {
    // Each of these exists in job-board's status payload. A figure the product
    // measures and does not publish to its customers is a figure the customer
    // has to take on trust.
    for (const f of ["descCoverage", "dateCoverage", "quarantinedVendors"]) {
      expect(BOARD, `job-board no longer publishes ${f} — this test's premise moved`).toContain(f);
    }
    expect(STATS).toMatch(/feedFreshness:/);
    expect(STATS).toMatch(/descriptionCoverage:/);
    expect(STATS).toMatch(/statedDateCoverage:/);
    expect(STATS).toMatch(/quarantined: \{/);
  });

  it("it reads the rollup, and reads it in ONE query", () => {
    // The aggregates behind these were moved off the request path in
    // 20260806120000 because they had outgrown their own statement timeout and
    // were costing job-board's status an 8-second floor. /v1 must not
    // re-introduce that cost per request: three keys, one indexed read.
    expect(STATS).toMatch(
      /\.from\("job_board_stats_rollup"\)\.select\("k, v, computed_at"\)\.in\("k", \["freshness", "date_coverage", "desc_coverage"\]\)/,
    );
    // And the two meta rows come back together rather than as two round trips.
    expect(STATS).toMatch(/\.from\("job_board_meta"\)\.select\("k, v, updated_at"\)\.in\("k", \["refresh", "vendor_breaker"\]\)/);
    // Nothing may be recomputed here.
    expect(STATS, "/v1/stats must not run an aggregate of its own")
      .not.toMatch(/count: "exact"|\.rpc\("get_date_coverage"\)|\.rpc\("get_freshness_stats"\)/);
    // The board reads the same rollup table for the same figures.
    expect(BOARD).toMatch(/from\("job_board_stats_rollup"\)/);
  });

  it("every promise in the read is bound to a name", () => {
    // A Promise.all whose array is longer than its destructuring silently
    // re-labels every value after the gap — the defect that published the
    // board's work-mode coverage as its experience coverage.
    const i = STATS.indexOf("await Promise.all([");
    const names = STATS.slice(STATS.lastIndexOf("const [", i), i).replace(/const \[|\] = /g, "")
      .split(",").map((x) => x.trim()).filter(Boolean);
    const body = STATS.slice(i, STATS.indexOf("\n  ]);", i));
    let depth = 0, entries = 1;
    for (const ch of body.slice(body.indexOf("[") + 1)) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (ch === "," && depth === 0) entries++;
    }
    if (body.trim().endsWith(",")) entries--;
    expect(names.length, `${names.join(", ")} binds ${names.length} of ${entries} promises`).toBe(entries);
  });

  it("freshness is named as a RE-CHECK cadence, never as a posting age", () => {
    // The 2.8d incident in one sentence: a stat about us, published under a
    // noun about the employer. The field name and the basis both say which.
    expect(STATS).toMatch(/feedFreshness:/);
    expect(STATS).toMatch(/last re-verified against the employer's own system/);
    expect(STATS).toMatch(/NOT how long ago a role was posted/);
    // Minutes, in the unit the rollup stores, with no unit-free number.
    for (const f of ["p50Minutes", "p95Minutes", "maxMinutes"]) expect(STATS).toContain(f);
    expect(ROLLUP_SQL, "the rollup no longer stores p95_min — the mapping moved").toMatch(/'p95_min'/);
  });

  it("the per-source population is stated, because it is NOT livePostings", () => {
    // The rollup groups over missing_since IS NULL with no freshness window, so
    // these totals describe a wider set than the headline count. Saying so is
    // what stops a customer building a ratio out of two different populations.
    expect(ROLLUP_SQL).toMatch(/FROM public\.job_board_postings\s*\n\s*WHERE missing_since IS NULL\s*\n\s*GROUP BY source/);
    expect(ROLLUP_SQL, "the rollup started applying the serving window — this copy is now wrong")
      .not.toMatch(/GROUP BY source[\s\S]{0,200}effective_posted/);
    expect(STATS).toMatch(/population:/);
    expect(STATS).toMatch(/WITHOUT the 30-day serving window/);
    expect(STATS).toMatch(/more than livePostings and less than trackedPostings/);
  });

  it("described means what the migration made it mean, and says so", () => {
    // 20260904090000 moved this predicate from "longer than 150 chars" (the
    // scorer's bar, which no writer selects on, and which detoasted every live
    // description every fifteen minutes) to "IS NOT NULL" — the sweep lanes'
    // own selection complemented. The published wording has to move with it, or
    // the API sells a quality claim the number cannot make.
    expect(ROLLUP_SQL).toMatch(/count\(\*\) FILTER \(WHERE description IS NOT NULL\) AS described/);
    expect(ROLLUP_SQL, "the character-count predicate is back").not.toMatch(/length\(description\) > 150/);
    expect(STATS).toMatch(/described = the posting has a stored description at all/);
    expect(STATS).toMatch(/total - described is that source's sweep backlog/);
    expect(STATS, "the API must not promise scoreability from a null test")
      .not.toMatch(/scoreable|scoreablePct/i);
  });

  it("dated means the EMPLOYER's date, never our discovery stamp", () => {
    expect(ROLLUP_SQL).toMatch(/count\(posted_at\) AS dated/);
    expect(STATS).toMatch(/the EMPLOYER stated a posting date/);
    expect(STATS).toMatch(/a discovery stamp is not a posting age/);
  });

  it("both percentages round exactly the way the board rounds them", () => {
    // A customer comparing /v1/stats with the board must never find the two a
    // point apart because one of them rounded differently.
    expect(STATS).toMatch(/describedPct: Number\(r\.total\) \? Math\.round\(\(100 \* Number\(r\.described\)\) \/ Number\(r\.total\)\) : 0/);
    expect(BOARD).toMatch(/describedPct: Number\(r\.total\) \? Math\.round\(\(100 \* Number\(r\.described\)\) \/ Number\(r\.total\)\) : 0/);
    expect(STATS).toMatch(/datedPct: Math\.round\(\(100 \* Number\(r\.dated\)\) \/ Math\.max\(Number\(r\.total\), 1\)\)/);
    expect(BOARD).toMatch(/datedPct: Math\.round\(100 \* Number\(r\.dated\) \/ Math\.max\(Number\(r\.total\), 1\)\)/);
    // The raw numerator ships beside the percentage, so a buyer can recompute.
    expect(STATS).toMatch(/described: Number\(r\.described\),/);
    expect(STATS).toMatch(/dated: Number\(r\.dated\),/);
  });

  it("every block carries its own asOf and is null — never zero — when absent", () => {
    // A stale figure with an age beside it is usable; a stale figure that looks
    // live is not, and a 0 would read as "no source carries descriptions".
    expect(STATS).toMatch(/asOf: descRaw\.asOf,/);
    expect(STATS).toMatch(/asOf: dateRaw\.asOf,/);
    expect(STATS).toMatch(/asOf: freshRow\?\.computed_at \?\? null,/);
    expect(STATS).toMatch(/descriptionCoverage: descRaw\s*\n?\s*\?/);
    expect(STATS).toMatch(/: null,/);
    expect(STATS, "a failed read must be logged, not served as an empty board")
      .toMatch(/\/v1\/stats partial read:/);
    expect(ROLLUP_SQL, "each rollup block must still degrade on its own")
      .toMatch(/WHEN QUERY_CANCELED THEN/);
  });

  it("quarantine says what it MEANS for the rows, not just which vendors", () => {
    // A vendor in quarantine has its boards skipped rather than pruned: its
    // postings are neither re-verified nor withdrawn, they age out. A bare list
    // of names would let a customer read it as "these are excluded".
    expect(STATS).toMatch(/not being re-verified and are not being withdrawn/);
    expect(STATS).toMatch(/age out of the 30-day window/);
    expect(STATS).toMatch(/sources: quarantined\.filter\(\(x\): x is string => typeof x === "string"\)/);
    // Read from the breaker's own row, which is what job-board writes.
    expect(STATS).toMatch(/meta\("vendor_breaker"\)/);
    expect(BOARD).toMatch(/upsert\(\s*\n?\s*\{ k: "vendor_breaker", v: \{ vendors: merged, quarantined: nextQuarantined/);
  });

  it("the headline split survives — livePostings is still the fenced count", () => {
    // The figure this endpoint already got wrong once, by ~150,000 postings.
    expect(STATS).toMatch(/livePostings: open,/);
    expect(STATS).toMatch(/trackedPostings: tracked,/);
    expect(STATS, "livePostings falls back to the inflated total").not.toMatch(/livePostings:[^,]*v\.total/);
    // basis still answers the probe's "does this number say what it counts?"
    expect(STATS).toMatch(/basis: "livePostings is an exact count/);
  });

  it("the docs name the fields, not a paraphrase of them", () => {
    // A reader builds against the field names, so the reference page has to
    // carry the names — and the caveat, because a coverage figure whose
    // population is not stated is the thing this whole endpoint is careful about.
    expect(DOCS).toMatch(/feedFreshness/);
    expect(DOCS).toMatch(/bySource/);
    expect(DOCS).toMatch(/WITHOUT the 30-day window/);
    expect(DOCS).toMatch(/quarantined/);
  });
});
