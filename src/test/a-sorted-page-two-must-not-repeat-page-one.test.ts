import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planRankedPage, RANKED_WINDOW } from "../../supabase/functions/job-board/paging";

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
 * THE FIX was to make the window fixed instead of moving: anchor it at rank 0 so
 * `offset` is a position INSIDE one stable ordering.
 *
 * ── AND THEN THE FIX BECAME THE NEXT BUG ──────────────────────────────────
 *
 * A fixed window is also a WALL. Measured 2026-08-22: every keyword search
 * dead-ended at raw offset 200 and answered hasMore:false. q="warehouse
 * associate" counted 1,410 matches — a genuine, uncapped count — and served 151
 * unique rows before stopping. 89.3% of the result set was advertised and
 * permanently unreachable. Across 13 occupation queries, 36-93% was unreachable.
 * The control was decisive: the identical query on sort=salary took the plain
 * offset path and walked to raw offset 758.
 *
 * So there are now TWO REGIMES with a seam at RANKED_WINDOW, and the property
 * that matters is the one this file was always about — no row served twice, no
 * row skipped — now across a seam between two DIFFERENT orderings.
 *
 * ── WHY THIS FILE NO LONGER GREPS THE SOURCE ──────────────────────────────
 *
 * It used to assert things like
 *     /p_offset: \(newestFirst \|\| scoreRanked\) \? 0 : offset,/
 * which pins a SPELLING, not a property. Those assertions passed for the entire
 * life of the offset-200 wall, because the wall was not a typo in that
 * expression — it was the consequence of it. The same session found a keyset
 * cursor that had been null on every response since the day it shipped, also
 * under a passing guard. A regex cannot walk a seam. This one does: the
 * arithmetic now lives in paging.ts as a pure function, and the tests below
 * page through a simulated corpus and check the rows that come out.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/**
 * Walk a ranked result set exactly as serveList does, and return every row
 * served, in order, with the page it came from.
 *
 * The simulation is faithful on the one point the seam depends on: BELOW the
 * seam the same 200 SQL rows are fetched on every request and re-ranked by the
 * same deterministic scorer, so the permutation is stable across pages; AT or
 * ABOVE it, SQL is asked for a real offset and nothing is re-ranked.
 */
function walk(opts: {
  corpus: number;
  limit: number;
  deepPageable: boolean;
  scoreRanked?: boolean;
  newestFirst?: boolean;
  maxPages?: number;
}) {
  const { corpus, limit, deepPageable } = opts;
  const scoreRanked = opts.scoreRanked ?? true;
  const newestFirst = opts.newestFirst ?? false;
  // A stable, order-destroying permutation — the scorer's job in miniature.
  const permute = (rows: number[]) => [...rows].reverse();

  const served: number[] = [];
  const pages: number[][] = [];
  let offset = 0;
  for (let p = 0; p < (opts.maxPages ?? 200); p++) {
    const plan = planRankedPage({ offset, fetchLimit: limit, scoreRanked, newestFirst, deepPageable });
    // What SQL returns for this plan: ts_rank_cd order, one stable sequence.
    const sql: number[] = [];
    for (let i = plan.pOffset; i < Math.min(plan.pOffset + plan.pLimit, corpus); i++) sql.push(i);
    const scored = plan.rerank ? permute(sql) : sql;
    const page = scored.slice(plan.sliceStart, plan.sliceEnd).slice(0, limit);
    if (page.length === 0) break;
    pages.push(page);
    served.push(...page);
    offset += page.length; // nextOffset = offset + rawConsumed
  }
  return { served, pages };
}

describe("a sorted page two must not repeat page one", () => {
  it("serves every rank exactly once across the seam — no repeats, no holes", () => {
    // 3 full pages below the seam, the seam mid-page-4, then the SQL regime.
    const { served } = walk({ corpus: 1000, limit: 60, deepPageable: true });
    expect(served.length, "the walk must not stall").toBeGreaterThan(600);
    expect(
      new Set(served).size,
      "a rank served twice is the 2026-08-17 duplicate bug returning at the seam",
    ).toBe(served.length);
    const sorted = [...served].sort((a, b) => a - b);
    expect(sorted[0]).toBe(0);
    // Contiguous: no rank between the first and last served is missing. A hole
    // here is the defect the clamp exists to prevent — a page that starts below
    // the seam running past it, and the next page resuming beyond the gap.
    const holes = sorted.filter((v, i) => i > 0 && v !== sorted[i - 1] + 1);
    expect(holes, `ranks skipped at the seam: ${holes.slice(0, 5).join(", ")}`).toEqual([]);
  });

  it("crosses the seam at exactly RANKED_WINDOW from both sides", () => {
    // The last row of the re-ranked regime and the first row of the SQL regime
    // must be adjacent ranks. Off by one either way is a repeat or a hole.
    const below = planRankedPage({ offset: RANKED_WINDOW - 1, fetchLimit: 60, scoreRanked: true, newestFirst: false, deepPageable: true });
    const at = planRankedPage({ offset: RANKED_WINDOW, fetchLimit: 60, scoreRanked: true, newestFirst: false, deepPageable: true });
    expect(below.deepPage).toBe(false);
    expect(below.sliceEnd, "the window must be clamped to the seam").toBe(RANKED_WINDOW);
    expect(at.deepPage).toBe(true);
    expect(at.pOffset, "the SQL regime must resume exactly at the seam").toBe(RANKED_WINDOW);
    expect(at.rerank, "past the seam the rows are served in the RPC's own order").toBe(false);
  });

  it("holds the no-repeat property at every page size, including ones that straddle the seam", () => {
    for (const limit of [1, 7, 20, 60, 100, 199, 200]) {
      const { served } = walk({ corpus: 900, limit, deepPageable: true, maxPages: 400 });
      expect(new Set(served).size, `limit=${limit} repeated a row`).toBe(served.length);
      const sorted = [...served].sort((a, b) => a - b);
      const holes = sorted.filter((v, i) => i > 0 && v !== sorted[i - 1] + 1);
      expect(holes, `limit=${limit} skipped ${holes.length} ranks`).toEqual([]);
    }
  });

  it("reaches far past the old 200-row wall", () => {
    // The regression this half of the file exists for. Before the seam, this
    // walk stopped dead at 200 no matter how many rows matched.
    const { served } = walk({ corpus: 5000, limit: 60, deepPageable: true, maxPages: 60 });
    expect(served.length, "a keyword search must page past the re-ranked window").toBeGreaterThan(2000);
  });

  it("anchors the window at rank 0 and applies the offset AFTER the sort, below the seam", () => {
    // The ORIGINAL invariant, unchanged: a re-sorted page cannot page by an
    // offset into an ordering the sort has already destroyed.
    for (const offset of [0, 20, 60, 199]) {
      const plan = planRankedPage({ offset, fetchLimit: 60, scoreRanked: true, newestFirst: false, deepPageable: true });
      expect(plan.pOffset, `offset ${offset} must read a FIXED window at rank 0`).toBe(0);
      expect(plan.pLimit).toBe(RANKED_WINDOW);
      expect(plan.rerank).toBe(true);
      expect(plan.sliceStart, "the caller's offset applies after the sort").toBe(offset);
    }
  });

  it("leaves a query with no seam exactly as it was — window at 0, no clamp", () => {
    // EMPLOYER, SIMPLE and SYMBOL routes are not deep-pageable. Clamping them
    // would buy nothing (they have no SQL regime to meet) and cost cards:
    // fetchLimit is min(limit*3, 200), so at limit >= 67 the collapse can
    // consume a merged pool larger than the window.
    for (const offset of [0, 60, 200, 500]) {
      const plan = planRankedPage({ offset, fetchLimit: 200, scoreRanked: true, newestFirst: false, deepPageable: false });
      expect(plan.deepPage, `offset ${offset} must never deep-page an unseamed query`).toBe(false);
      expect(plan.pOffset).toBe(0);
      expect(plan.sliceEnd, "an unseamed query must not be clamped").toBeUndefined();
      expect(plan.sliceStart).toBe(offset);
    }
  });

  it("leaves the UNSORTED path exactly as it was", () => {
    // Relevance order with no scoring needs no window: p_offset means what it
    // says there, and changing it would be a far larger blast radius.
    const plan = planRankedPage({ offset: 120, fetchLimit: 60, scoreRanked: false, newestFirst: false, deepPageable: false });
    expect(plan.pOffset).toBe(120);
    expect(plan.pLimit).toBe(60);
    expect(plan.rerank).toBe(false);
    expect(plan.sliceStart).toBe(0);
    expect(plan.sliceEnd).toBeUndefined();
    expect(/: \(rankedSequence\.length > rankedGrouped\.rawConsumed \|\| rankedSequence\.length >= fetchLimit\)/.test(FN)).toBe(true);
  });

  it("pins the window to the RPC's own measured cap", () => {
    // search_jobs returns at most 200 regardless of p_limit — asking for more
    // costs latency and returns nothing extra (600 took 0.61s for the same 200).
    expect(RANKED_WINDOW, "the window must match the RPC's internal cap").toBe(200);
  });

  it("keeps the arithmetic in one place, where it can be walked", () => {
    // The wall survived years of guards because the arithmetic was inline and
    // the guards matched source text. If it moves back inline, this file goes
    // blind again — so the wiring itself is asserted.
    expect(FN).toMatch(/import \{ planRankedPage \} from "\.\/paging\.ts";/);
    expect(FN).toMatch(/const pagePlan = planRankedPage\(\{ offset, fetchLimit, scoreRanked, newestFirst, deepPageable \}\);/);
    expect(FN).toMatch(/p_limit: pagePlan\.pLimit,/);
    expect(FN).toMatch(/p_offset: pagePlan\.pOffset,/);
    expect(FN).toMatch(/rankedScored\.slice\(pagePlan\.sliceStart, pagePlan\.sliceEnd\)/);
  });
});
