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
    // Sliced from `const qText =` to the FIRST `if (qText &&` after it, rather
    // than within a character budget. The budget version broke the moment a
    // comment was added between the two — the same "window too small" bug this
    // repo has hit before, and a guard that silently finds nothing reports a
    // passing empty string instead of a failure.
    // Located and contents kept separate, same reasoning as the count twin.
    const from = SRC.indexOf("const qText =");
    expect(from, "row-query guard not found — `const qText =` has moved").toBeGreaterThan(-1);
    const m = /if \(qText &&([^)]*)\)/.exec(SRC.slice(from));
    expect(m, "row-query guard not found — no `if (qText &&` follows it").not.toBeNull();
    const guard = m![1];
    expect(
      guard.includes('body.sort !== "newest"'),
      'The row guard must NOT exclude sort="newest" — that routes a query to ' +
        'the substring ILIKE where "rn" matches "internship" and "registered ' +
        'nurse" is unreachable.',
    ).toBe(false);
    // The salary sort legitimately still bypasses the engine.
    //
    // I removed this guard, routed salary through search_jobs, and REVERTED the
    // whole thing the same day. Routing fixed matching — "nurse" stopped
    // returning "Nursery Practitioner" — but the ordering it produced was worse
    // than what it replaced: only 16 of the 180 relevance rows carry a stated
    // salary, so 44 of 60 cards on a "highest paid" page had no pay at all,
    // page 1 topped out at $214,800 where the browse path starts at $650,000,
    // and page 2 led higher than page 1. The browse path can order globally on
    // the salary_rank_usd index; an in-memory sort of a relevance window
    // cannot, and no amount of care in the edge function changes that.
    //
    // RESOLVED 2026-08-21 by a third option this note did not consider.
    //
    // The guard below STAYS — search_jobs is still bypassed for sort=salary,
    // and everything above about why remains true. What changed is that the
    // query no longer falls to substring ILIKE: a salary-sorted text search is
    // now served by buildQuery matching on the simple-config index and ordering
    // on salary_rank_usd, which is INDEXED. The database orders the whole match
    // set rather than an in-memory window, so the objection that killed the
    // last attempt — 44 of 60 cards with no stated pay, page 2 leading higher
    // than page 1 — does not apply.
    //
    // MEASURED at concurrency 4: nurse 0.34-0.46s, engineer 0.25-0.42s, all
    // 200. The page for q="nurse" becomes $300,000 Nurse Practitioner,
    // $290,000 CRNA, $270,000 CRNA, against "Unqualified Nursery Practitioner"
    // before it.
    expect(guard.includes('body.sort !== "salary"')).toBe(true);
    // And the replacement must exist, or this guard is just protecting a hole.
    expect(
      /const salaryTextSort = !countOnly && !!qText && body\.sort === "salary"/.test(SRC),
      "bypassing search_jobs is only acceptable because a correct salary path exists",
    ).toBe(true);
  });

  it("does not exclude sort=newest from the COUNT query", () => {
// Boundary-sliced, like its row-query twin above: a character budget breaks
    // silently the next time a comment lands between the two anchors.
    // LOCATED and CONTENTS are separate questions. The condition is now bare
    // `if (qTextC)`, so its captured clause list is legitimately EMPTY — and a
    // check that treats empty as "not found" fails on the very state it is
    // meant to approve. Locate first, then read.
    const fromC = SRC.indexOf("const qTextC =");
    expect(fromC, "count guard not found — `const qTextC =` has moved").toBeGreaterThan(-1);
    const m = /if \(qTextC([^)]*)\)/.exec(SRC.slice(fromC));
    expect(m, "count guard not found — no `if (qTextC` follows it").not.toBeNull();
    const guard = m![1];
    // The count guard must MIRROR the row guard exactly — whatever the row
    // query excludes, the count must exclude too. Mutation-testing found that
    // an asymmetry here passes silently while producing a page of ranked
    // results under a total computed by substring matching: the
    // 60-rows-under-a-total-of-36 shape, and the most dangerous edit in this
    // area.
    expect(guard.includes('body.sort !== "newest"'), "newest must reach the engine").toBe(false);
    expect(guard.includes('body.sort !== "salary"'), "salary must bypass it in BOTH places or neither").toBe(true);
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
