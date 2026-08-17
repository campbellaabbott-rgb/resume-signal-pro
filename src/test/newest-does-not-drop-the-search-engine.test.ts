import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * CHOOSING "NEWEST" SILENTLY DROPPED THE ENTIRE SEARCH ENGINE.
 *
 * The routing guard read `qText && body.sort !== "salary" && body.sort !== "newest"`,
 * so a query sorted by Newest fell through to the recency path's substring
 * ILIKE:
 *
 *   title.ilike.%rn%   ->   matches inteRNship, PRN, oveRNight
 *
 * and because "registered nurse" contains no "rn" substring, the spelled-out
 * title was UNREACHABLE. Alias expansion ("RN" -> "registered nurse") never ran
 * on that path either.
 *
 * Measured live on the deployed build:
 *   q="RN", relevance  -> 10/10 nursing roles, `ranked` and `aliases` present
 *   q="RN", newest     -> substring artifacts, NO `ranked`, NO `aliases`
 *
 * It was also the SLOW path. `%term%` cannot use an index, so a rare term
 * seq-scans 594k rows: q="k8s" + newest returned HTTP 500 after 25.47s.
 * Routing through search_jobs moves the work onto the GIN index, which is why
 * this fix makes the query faster as well as correct.
 *
 * THE TWO GUARDS MUST MOVE TOGETHER. There are two — one for the rows and one
 * for countOnly. Changing only the row guard would have the count answering
 * from a substring ILIKE while the rows came from the FTS engine, which is the
 * shape of the recorded incident where 60 rows rendered under a total of 36.
 */
const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8",
);

describe("a query reaches the search engine whatever the sort", () => {
  it("does not exclude sort=newest from the ROW query", () => {
    const guard = /const qText = String\(body\.q[\s\S]{0,2400}?if \(qText &&([^)]*)\)/.exec(SRC)?.[1] ?? "";
    expect(guard, "row-query guard not found").not.toBe("");
    expect(
      guard.includes('body.sort !== "newest"'),
      'The row guard must NOT exclude sort="newest" — that routes a query to ' +
        'the substring ILIKE where "rn" matches "internship" and "registered ' +
        'nurse" is unreachable.',
    ).toBe(false);
    // Salary sort legitimately still bypasses it: that ordering is the answer.
    expect(guard.includes('body.sort !== "salary"')).toBe(true);
  });

  it("does not exclude sort=newest from the COUNT query", () => {
    const guard = /const qTextC = String\(body\.q[\s\S]{0,900}?if \(qTextC &&([^)]*)\)/.exec(SRC)?.[1] ?? "";
    expect(guard, "count guard not found").not.toBe("");
    expect(
      guard.includes('body.sort !== "newest"'),
      "The count guard must move with the row guard, or a newest-sorted " +
        "search reports a total computed a different way from its rows.",
    ).toBe(false);
  });

  it("still orders the page by date when newest was asked for", () => {
    // The engine picks WHICH rows match; "newest" then orders the page. Without
    // this the control would silently become a relevance sort.
    expect(SRC.includes("const newestFirst = body.sort === \"newest\";")).toBe(true);
    expect(/if \(newestFirst\)\s*\{[\s\S]{0,320}?rankedRows\.sort/.test(SRC)).toBe(true);
  });

  it("sorts undated rows LAST, not first", () => {
    // `Date.parse("") || 0` yields 0, and descending order puts 0 last. An
    // absent date is not evidence of newness — ~55,000 rows are undated, and
    // leading with rows whose age we do not know would be the same dishonesty
    // the date-provenance work exists to prevent.
    const block = /if \(newestFirst\)\s*\{[\s\S]{0,400}?\}\);/.exec(SRC)?.[0] ?? "";
    expect(block, "newestFirst sort block not found").not.toBe("");
    expect(block.includes("|| 0"), "unparseable dates must floor to 0").toBe(true);
    expect(block.includes("db - da"), "must be descending (newest first)").toBe(true);
  });
});
