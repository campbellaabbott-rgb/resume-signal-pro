import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PAGE TWO OF A SORTED SEARCH REPEATED 85% OF PAGE ONE.
 *
 * MEASURED on production, not inferred:
 *   POST /job-board {"q":"nurse","sort":"newest","limit":20}
 *   -> 20 rows, nextOffset 25
 *   POST the same with offset 25
 *   -> 20 rows, SEVENTEEN OF WHICH WERE ALREADY ON PAGE ONE
 * and the rows displaced by those duplicates were unreachable by paging at all.
 *
 * THE MECHANISM. The ranked path asks search_jobs for rows at p_offset in
 * RELEVANCE order, then re-sorts them in memory by date. After that permutation
 * `rawConsumed` counts positions in the SORTED array while nextOffset feeds them
 * back as a relevance-ordered p_offset — two different coordinate systems, one
 * number. Every sorted page compounds the drift.
 *
 * THE FIX is to make the window fixed instead of moving: anchor it at rank 0 so
 * `offset` is a position INSIDE one stable ordering. The window is 200 because
 * that is where search_jobs caps its own output — measured, p_limit 400 and 600
 * both return exactly 200 — so a sorted search now pages honestly to the window
 * edge and stops, rather than continuing forever with duplicates.
 *
 * This bug was NOT introduced by the salary work; it was already live on
 * sort=newest and was found while reviewing a change that would have copied it.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("a sorted page two must not repeat page one", () => {
  it("anchors the window at rank 0 whenever the page is re-sorted in memory", () => {
    // Widened to cover SCORED pages as well as sorted ones: the scorer
    // permutes the rows exactly as a sort does, so it needs the same fixed
    // window or `offset` stops describing where the reader is.
    expect(
      /p_offset: \(newestFirst \|\| scoreRanked\) \? 0 : offset,/.test(FN),
      "a sorted mode must read a FIXED window — a moving p_offset describes a position " +
        "in relevance order that the sort has already destroyed",
    ).toBe(true);
    expect(/p_limit: \(newestFirst \|\| scoreRanked\) \? RANKED_WINDOW : fetchLimit,/.test(FN)).toBe(true);
  });

  it("applies the caller's offset AFTER the sort, inside that window", () => {
    // Applying it before the sort is the bug. Applying it after makes offset a
    // position in one stable ordering.
    expect(/const rankedWindow = \(newestFirst \|\| scoreRanked\) \? rankedScored\.slice\(offset\) : rankedScored;/.test(FN)).toBe(true);
    // And everything downstream must consume the sliced window, not the raw rows.
    expect(/collapseClusters\(rankedWindow, limit\)/.test(FN)).toBe(true);
    expect(/rankedWindow\.slice\(0, limit\)/.test(FN)).toBe(true);
    expect(/let rankedSequence = rankedWindow;/.test(FN)).toBe(true);
  });

  it("stops promising pages the fixed window cannot serve", () => {
    // The fetch-size heuristic (`length >= fetchLimit`) means "there is probably
    // more behind this". Inside a finite window that is a promise of a page
    // which does not exist, so the sorted branch asks only whether rows remain.
    expect(
      /hasMore: \(newestFirst \|\| scoreRanked\)\s*\n\s*\? rankedSequence\.length > rankedGrouped\.rawConsumed/.test(FN),
      "a sorted search must report hasMore from what is left in the window",
    ).toBe(true);
  });

  it("pins the window to the RPC's own measured cap", () => {
    const m = /const RANKED_WINDOW = (\d+);/.exec(FN);
    expect(m, "RANKED_WINDOW is missing").not.toBeNull();
    // search_jobs returns at most 200 regardless of p_limit — asking for more
    // costs latency and returns nothing extra (600 took 0.61s for the same 200).
    expect(Number(m![1]), "the window must match the RPC's internal cap").toBe(200);
  });

  it("leaves the UNSORTED path exactly as it was", () => {
    // Relevance order needs no window: p_offset means what it says there, and
    // changing it would be a far larger blast radius than the bug being fixed.
    expect(/p_offset: \(newestFirst \|\| scoreRanked\) \? 0 : offset,/.test(FN)).toBe(true);
    expect(/: \(rankedSequence\.length > rankedGrouped\.rawConsumed \|\| rankedSequence\.length >= fetchLimit\)/.test(FN)).toBe(true);
  });
});
