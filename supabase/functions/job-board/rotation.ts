// Rationale: docs/job-board-index-notes.md#n1500-export-interface-refreshprogress

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

// NOTE FOR THE NEXT FIELD ADDED HERE: advanceProgress builds `next` as an
// EXPLICIT object literal, not a spread of `prev`. A field added to this
// interface and passed in by the caller is therefore dropped on every slice
// unless it is also listed in both return paths below — which is precisely
// how failedTotal shipped reading 0 forever in 2026-08-24.18, one build after
// it was introduced to fix a different silently-dropped number.

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
      next: { hot: prev.hot + hotSlice, cold: prev.cold, coldDone: prev.coldDone, failedAcc: prev.failedAcc, failedTotal: prev.failedTotal },
      wrapped: false,
    };
  }
  const cold = (prev.cold + baseSliceLen) % len;
  return {
    next: { hot: prev.hot, cold, coldDone: prev.coldDone + 1, failedAcc: prev.failedAcc, failedTotal: prev.failedTotal },
    // A hop that consumed nothing (empty tail slice) hasn't wrapped, even
    // though cold === prev.cold satisfies a naive "went backwards" test.
    wrapped: baseSliceLen > 0 && cold < prev.cold,
  };
}

/** A pass is complete once the hot list is exhausted AND its cold-hop budget is spent. */
export function isPassDone(p: RefreshProgress, hotListLen: number, coldSlicesPerPass: number): boolean {
  return p.hot >= hotListLen && p.coldDone >= coldSlicesPerPass;
}

/**
 * How many base boards the cold cursor passes after a slice that survived: up
 * to the first one neither started nor skipped as dormant. A count of starts
 * re-read the board after each dormant skip, and passed a board deferred ahead
 * of later starts (sweep S8-087; rationale n446 in docs/job-board-index-notes.md).
 */
export function baseConsumedPrefix(baseKeys: readonly string[], consumed: ReadonlySet<string>): number {
  const i = baseKeys.findIndex((k) => !consumed.has(k));
  return i === -1 ? baseKeys.length : i;
}
