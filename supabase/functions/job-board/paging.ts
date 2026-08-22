/**
 * WHERE A RANKED PAGE COMES FROM — the arithmetic, on its own, so a test can
 * walk it.
 *
 * This logic used to live inline in serveList, which is exactly why nothing
 * tested it and why every keyword search dead-ended at raw offset 200. The
 * guards that covered it matched source text (`p_offset: (newestFirst ||
 * scoreRanked) ? 0 : offset,`), so they pinned a SPELLING and passed happily
 * while 89% of every advertised result set was unreachable. A regex cannot
 * catch an off-by-one at a seam. A walk can.
 *
 * TWO REGIMES, ONE SEAM AT `rankedWindow`.
 *
 *   below the seam   search_jobs is anchored at p_offset 0, the whole window is
 *                    read, re-ranked in memory by rerankWindow, and the
 *                    caller's offset is applied AFTER the sort — so `offset` is
 *                    a position inside one stable, re-scored ordering.
 *   at/above         search_jobs pages itself with a real p_offset in its own
 *                    ts_rank_cd order and nothing is re-ranked, so `offset` is
 *                    a position in SQL rank.
 *
 * The two orderings are DIFFERENT, so the seam only works if neither regime
 * ever serves a rank the other one owns. Below the seam the slice is clamped to
 * end at `rankedWindow`; at and above it the SQL offset starts there. Rank
 * `rankedWindow - 1` is the last row of the first regime and rank
 * `rankedWindow` is the first row of the second. No overlap, no hole.
 *
 * The clamp is the part that is easy to get wrong and it is not optional: a
 * page STARTING below the seam would otherwise run past it — offset 150 with
 * limit 100 served window positions 150-249 — and the next request, now in the
 * SQL regime, would begin at rank 250 and silently skip 200-249.
 */

/**
 * search_jobs caps its own output at 200 rows — measured, p_limit 400 and 600
 * both return exactly 200. A sorted mode reads the whole cap as one fixed
 * window so paging stays inside a single stable ordering.
 */
export const RANKED_WINDOW = 200;

export type RankedPagePlan = {
  /** Serving from SQL rank rather than from the re-ranked window. */
  deepPage: boolean;
  /** p_limit for the search_jobs call. */
  pLimit: number;
  /** p_offset for the search_jobs call. */
  pOffset: number;
  /** Whether rerankWindow runs over the fetched rows. */
  rerank: boolean;
  /** Start of the slice taken from the fetched rows. */
  sliceStart: number;
  /** End of that slice, or undefined for "to the end". */
  sliceEnd: number | undefined;
};

/**
 * `deepPageable` is decided by the caller, not here, because it depends on
 * which retriever won the route:
 *   - only the scored path has a seam at all (`scoreRanked`)
 *   - the EMPLOYER and SIMPLE routes retrieve a different set in a different
 *     order through their own 400-row window
 *   - SYMBOL is excluded even though RETRIEVER_FOR maps it to "ranked": a
 *     symbol query has no retriever of its own and is separated ONLY by the
 *     scorer's literal-substring rule, which is off past the seam. Without the
 *     exclusion `c++` and `c#` produce the same tsquery and, from offset 200,
 *     the same rows.
 */
export function planRankedPage(opts: {
  offset: number;
  fetchLimit: number;
  scoreRanked: boolean;
  newestFirst: boolean;
  deepPageable: boolean;
  rankedWindow?: number;
}): RankedPagePlan {
  const w = opts.rankedWindow ?? RANKED_WINDOW;
  // "Windowed" is the pre-existing condition for reading a fixed window at
  // rank 0: a re-sorted page cannot page by an offset into an ordering the
  // sort has already destroyed.
  const windowed = opts.newestFirst || opts.scoreRanked;
  const deepPage = opts.deepPageable && opts.offset >= w;
  return {
    deepPage,
    pLimit: windowed && !deepPage ? w : opts.fetchLimit,
    pOffset: windowed && !deepPage ? 0 : opts.offset,
    rerank: opts.scoreRanked && !deepPage,
    sliceStart: deepPage ? 0 : windowed ? opts.offset : 0,
    // Clamped ONLY where there is a seam to protect. Clamping a query with no
    // SQL regime to meet buys nothing and costs cards: fetchLimit is
    // min(limit*3, 200), so at limit >= 67 the collapse can consume a merged
    // pool larger than the window (measured 189 cards from a 293-row pool).
    sliceEnd: deepPage ? undefined : windowed && opts.deepPageable ? w : undefined,
  };
}
