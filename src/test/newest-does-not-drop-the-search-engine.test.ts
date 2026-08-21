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
    // REVERSED 2026-08-21, and the original reasoning is worth keeping because
    // it was coherent: a salary sort wants a GLOBAL ordering by pay, and only
    // the browse path can get one from the salary_rank_usd index — the ranked
    // path can order no more than the relevance page it was handed.
    //
    // What that argument missed is what the substring path does to MATCHING.
    // Measured live: q="nurse" + sort=salary put "Unqualified Nursery
    // Practitioner" at position one, matched on "Nurser". q="swe" returned
    // 10,000 ranked Software Engineer roles under relevance and 1,101
    // substring artifacts under salary, led by "Roswell Full-Time General
    // CRNA" (Ro-SWE-ll) and "SWEPCO". q="bioinformatician" counted 55 ranked
    // against 11 from the identical body. A sort control was changing which
    // jobs MATCH by up to 5x, which no ordering benefit can pay for.
    //
    // So salary now takes the same deal newest already took: the RPC picks the
    // rows by relevance, and the page the reader is looking at is ordered by
    // pay. "Best paid among the most relevant" — a trade this file already
    // accepted once, for dates, three lines above.
    expect(
      guard.includes('body.sort !== "salary"'),
      'The row guard must NOT exclude sort="salary" either — it routed the query ' +
        'to the substring ILIKE, where "nurse" matched "Nursery".',
    ).toBe(false);
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
    // BOTH sort values, not just newest. Mutation-testing this file found the
    // gap: excluding only "salary" from the COUNT query passed cleanly while
    // the row query kept the engine — the exact divergence where a page of
    // ranked results renders under a total computed by substring matching.
    // That is the 60-rows-under-a-total-of-36 shape, and it is the single most
    // dangerous edit anyone can make here, so it is named explicitly.
    for (const sortValue of ["newest", "salary"]) {
      expect(
        guard.includes(`body.sort !== "${sortValue}"`),
        `The count guard must move WITH the row guard. Excluding sort="${sortValue}" here ` +
          `alone means the total is computed a different way from the rows it is shown above.`,
      ).toBe(false);
    }
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
