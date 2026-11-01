// Rationale: docs/job-board-index-notes.md#n1489-export-const-ranked_window

/**
 * search_jobs caps its own output at 200 rows — measured, p_limit 400 and 600
 * both return exactly 200. A sorted mode reads the whole cap as one fixed
 * window so paging stays inside a single stable ordering.
 */
export const RANKED_WINDOW = 200;

// Rationale: docs/job-board-index-notes.md#n1490-export-const-ring_window
export const RING_WINDOW = 400;

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

// Rationale: docs/job-board-index-notes.md#n1491-export-function-planrankedpage-opts
export function planRankedPage(opts: {
  offset: number;
  fetchLimit: number;
  scoreRanked: boolean;
  newestFirst: boolean;
  deepPageable: boolean;
  /**
   * The head-term ring merges into this query's window, so the below-seam pool
   * is up to RING_WINDOW rows rather than exactly the SQL top-200. Moves the
   * seam to RING_WINDOW and offset-maps the deep regime back onto SQL rank —
   * see the RING_WINDOW note for the duplicate/hole pair this prevents.
   * Meaningful only alongside deepPageable; a query with no SQL regime to meet
   * has no seam either way.
   */
  ringMerged?: boolean;
  rankedWindow?: number;
}): RankedPagePlan {
  const w = opts.rankedWindow ?? RANKED_WINDOW;
  const seam = opts.ringMerged ? RING_WINDOW : w;
  // "Windowed" is the pre-existing condition for reading a fixed window at
  // rank 0: a re-sorted page cannot page by an offset into an ordering the
  // sort has already destroyed.
  const windowed = opts.newestFirst || opts.scoreRanked;
  const deepPage = opts.deepPageable && opts.offset >= seam;
  return {
    deepPage,
    pLimit: windowed && !deepPage ? w : opts.fetchLimit,
    // A ring-merged deep page maps its offset back into SQL rank: the pool
    // below the seam carried SQL ranks 0..w-1 (plus ring rows), so the first
    // rank the deep regime owns is w, reached at offset RING_WINDOW.
    pOffset: windowed && !deepPage ? 0 : deepPage && opts.ringMerged ? opts.offset - (RING_WINDOW - w) : opts.offset,
    rerank: opts.scoreRanked && !deepPage,
    sliceStart: deepPage ? 0 : windowed ? opts.offset : 0,
    // Clamped ONLY where there is a seam to protect. Clamping a query with no
    // SQL regime to meet buys nothing and costs cards: fetchLimit is
    // min(limit*3, 200), so at limit >= 67 the collapse can consume a merged
    // pool larger than the window (measured 189 cards from a 293-row pool).
    sliceEnd: deepPage ? undefined : windowed && opts.deepPageable ? seam : undefined,
  };
}

/**
 * How many distinct rows this walk has provably reached: the only floor to set
 * against the count (L8-16). Below the seam every pool position is a distinct
 * row, so it is the positions served, never past the pool's end. On a deep page
 * the offset is NOT rows: a pool that ran out jumps to the 400 seam, and q=nurse
 * GB published totalAtLeast 460 after 207 rows. There it is the SQL rank
 * reached, and only when SQL answered at that rank (an OFFSET returns rows only
 * when that many exist). Rationale: docs/job-board-index-notes.md#n431-a-floor-counts-rows-not-positions
 */
export function rowsReached(o: {
  deepPage: boolean;
  pOffset: number;
  offset: number;
  rawConsumed: number;
  poolLength: number;
  sqlRowsOnPage: number;
}): number {
  if (o.deepPage) return o.sqlRowsOnPage > 0 ? o.pOffset + o.rawConsumed : 0;
  return Math.min(o.poolLength, o.offset + o.rawConsumed);
}

/** Rows whose title carries every symbol token of the query ("c#", "c++"): a symbol query's only countable rows (L8-17). */
export function symbolLiteralRows(rows: ReadonlyArray<{ title?: unknown }>, q: string): number {
  const toks = q.toLowerCase().split(/\s+/).filter((t) => /[+#]/.test(t));
  if (toks.length === 0) return 0;
  return rows.filter((r) => {
    const t = String(r.title ?? "").toLowerCase();
    return toks.every((k) => t.includes(k));
  }).length;
}
