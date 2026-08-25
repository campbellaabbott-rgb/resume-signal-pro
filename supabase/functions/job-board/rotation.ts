// Refresh-cursor arithmetic for the two-tier rotation.
//
// Why this is its own module: index.ts writes the refresh_progress meta row
// TWICE per hop — once optimistically before the slice runs (so a hop that dies
// on the resource ceiling doesn't wedge the pipeline on the same boards), and
// once after with the final failure accumulator. Those two writes duplicated
// both the cursor arithmetic and the row shape by hand, and on 2026-07-25 they
// were found to have silently diverged in two separate ways:
//
//   1. The post-slice write advanced the cold cursor by `slice.length` — which
//      includes the prepended demand and bootstrap boards. Those come from
//      ELSEWHERE in the catalog and consume no cursor. With the bootstrap lane
//      draining 25 boards/hop the cursor jumped 105 positions per 80-board
//      slice, so 24% of the cold list was skipped on every rotation. The
//      skipped boards weren't lost (the offset drifts each wrap, so they were
//      picked up 2-5 rotations later) which is why the MEDIAN re-verification
//      age looked perfectly healthy while P95 ran 1.4x the wrap and max 5.5x —
//      far enough past the published "re-verified within a few hours" claim to
//      make it false.
//
//   2. The post-slice write omitted the `rot` field that the optimistic write
//      set. An upsert replaces the whole v JSON, so `rot` was zeroed every hop
//      and the quiet lane that keyed off its parity never once ran in
//      production. (That lane is gone now — see index.ts — but the failure mode
//      is general: any field in one write and not the other is silently lost.)
//
// Both bugs are the same bug: two hand-maintained copies of one rule. So the
// rule lives here, once, as a pure function that returns the WHOLE row. Both
// call sites write exactly what it returns, and the invariants are unit-tested.

/** The complete refresh_progress meta value. Every write must carry every field. */
export interface RefreshProgress {
  /** index into HOT_LIST; >= HOT_LIST.length means the hot phase is done */
  hot: number;
  /** rotation cursor into COLD_LIST — persists across passes, wraps at the end */
  cold: number;
  /** cold hops completed in THIS pass; pass ends at COLD_SLICES_PER_PASS */
  coldDone: number;
  /** recent failed board names, for the status endpoint (bounded by the caller) */
  failedAcc: string[];
  /**
   * How many boards actually failed this pass. failedAcc is CAPPED at the last
   * 120 entries, and every consumer read that ceiling as the count — so a pass
   * failing 120 boards looked identical to one failing 3,000, and any class
   * breakdown drawn from the array samples the pass's tail rather than its
   * population. The cap stays (the array lives in a meta row); the count
   * travels beside it.
   */
  failedTotal?: number;
}

/**
 * Advance the cursors for one hop.
 *
 * `baseSliceLen` MUST be the number of COLD_LIST boards this hop consumed —
 * i.e. the length of the slice taken at the cursor, before demand/bootstrap
 * boards are prepended. It is deliberately not derived from the fetched slice:
 * every board fetched outside the cursor window is extra work, never progress.
 * At the tail this is shorter than a full COLD_SLICE, which is also why the
 * caller must not substitute the constant.
 *
 * `wrapped` is true exactly when this hop carried the cursor past the end of
 * COLD_LIST — the moment the entire cold tail has been re-verified, which is
 * what the cold_rotation freshness stamp records.
 */
export function advanceProgress(params: {
  prev: RefreshProgress;
  inHotPhase: boolean;
  hotSlice: number;
  baseSliceLen: number;
  coldListLen: number;
}): { next: RefreshProgress; wrapped: boolean } {
  const { prev, inHotPhase, hotSlice, baseSliceLen, coldListLen } = params;
  const len = Math.max(1, coldListLen);
  if (inHotPhase) {
    return {
      next: { hot: prev.hot + hotSlice, cold: prev.cold, coldDone: prev.coldDone, failedAcc: prev.failedAcc },
      wrapped: false,
    };
  }
  const cold = (prev.cold + baseSliceLen) % len;
  return {
    next: { hot: prev.hot, cold, coldDone: prev.coldDone + 1, failedAcc: prev.failedAcc },
    // A hop that consumed nothing (empty tail slice) hasn't wrapped, even
    // though cold === prev.cold satisfies a naive "went backwards" test.
    wrapped: baseSliceLen > 0 && cold < prev.cold,
  };
}

/** A pass is complete once the hot list is exhausted AND its cold-hop budget is spent. */
export function isPassDone(p: RefreshProgress, hotListLen: number, coldSlicesPerPass: number): boolean {
  return p.hot >= hotListLen && p.coldDone >= coldSlicesPerPass;
}
