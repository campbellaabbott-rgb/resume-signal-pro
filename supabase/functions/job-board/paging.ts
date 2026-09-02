export const RANKED_WINDOW = 200;
export const RING_WINDOW = 400;
export type RankedPagePlan = {
  deepPage: boolean;
  pLimit: number;
  pOffset: number;
  rerank: boolean;
  sliceStart: number;
  sliceEnd: number | undefined;
};
export function planRankedPage(opts: {
  offset: number;
  fetchLimit: number;
  scoreRanked: boolean;
  newestFirst: boolean;
  deepPageable: boolean;
  ringMerged?: boolean;
  rankedWindow?: number;
}): RankedPagePlan {
  const w = opts.rankedWindow ?? RANKED_WINDOW;
  const seam = opts.ringMerged ? RING_WINDOW : w;
  const windowed = opts.newestFirst || opts.scoreRanked;
  const deepPage = opts.deepPageable && opts.offset >= seam;
  return {
    deepPage,
    pLimit: windowed && !deepPage ? w : opts.fetchLimit,
    pOffset: windowed && !deepPage ? 0 : deepPage && opts.ringMerged ? opts.offset - (RING_WINDOW - w) : opts.offset,
    rerank: opts.scoreRanked && !deepPage,
    sliceStart: deepPage ? 0 : windowed ? opts.offset : 0,
    sliceEnd: deepPage ? undefined : windowed && opts.deepPageable ? seam : undefined,
  };
}
