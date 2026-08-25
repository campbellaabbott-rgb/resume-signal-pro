// Cursor arithmetic for the cold-tail rotation.
//
// These lock down the 2026-07-25 freshness-claim breach: the post-slice write
// advanced the cold cursor by the FETCHED slice length (base slice + prepended
// bootstrap + demand boards) instead of the boards actually consumed from
// COLD_LIST, so ~24% of the catalog was skipped every rotation. The median
// re-verification age stayed healthy, which is why it went unnoticed until the
// P95 crossed the published "within a few hours" claim.

import { describe, it, expect } from "vitest";
import { advanceProgress, isPassDone, type RefreshProgress } from "../../supabase/functions/job-board/rotation";

const base = (over: Partial<RefreshProgress> = {}): RefreshProgress => ({
  hot: 0, cold: 0, coldDone: 0, failedAcc: [], ...over,
});

describe("advanceProgress — cold cursor", () => {
  it("advances by the boards consumed from COLD_LIST", () => {
    const { next } = advanceProgress({
      prev: base({ cold: 100 }), inHotPhase: false, hotSlice: 10, baseSliceLen: 80, coldListLen: 28_055,
    });
    expect(next.cold).toBe(180);
    expect(next.coldDone).toBe(1);
  });

  it("REGRESSION: prepended bootstrap/demand boards must not advance the cursor", () => {
    // The breach: a hop fetched 80 cursor boards + 25 bootstrap + 5 demand and
    // advanced 105. advanceProgress is only ever given the 80.
    const consumed = 80;
    const { next } = advanceProgress({
      prev: base({ cold: 7_923 }), inHotPhase: false, hotSlice: 10, baseSliceLen: consumed, coldListLen: 28_055,
    });
    expect(next.cold - 7_923).toBe(consumed);
    expect(next.cold).not.toBe(7_923 + 105);
  });

  it("a hot hop leaves the cold cursor and cold budget untouched", () => {
    const { next, wrapped } = advanceProgress({
      prev: base({ hot: 40, cold: 500, coldDone: 3 }), inHotPhase: true, hotSlice: 10, baseSliceLen: 80, coldListLen: 1_000,
    });
    expect(next).toMatchObject({ hot: 50, cold: 500, coldDone: 3 });
    expect(wrapped).toBe(false);
  });

  it("wraps at the end of the list and reports the wrap", () => {
    const { next, wrapped } = advanceProgress({
      prev: base({ cold: 960 }), inHotPhase: false, hotSlice: 10, baseSliceLen: 80, coldListLen: 1_000,
    });
    expect(next.cold).toBe(40);
    expect(wrapped).toBe(true);
  });

  it("a short tail slice advances only by its real length", () => {
    // 1,000-board list, cursor at 950: the slice is 50 long, not COLD_SLICE.
    const { next, wrapped } = advanceProgress({
      prev: base({ cold: 950 }), inHotPhase: false, hotSlice: 10, baseSliceLen: 50, coldListLen: 1_000,
    });
    expect(next.cold).toBe(0);
    expect(wrapped).toBe(true);
  });

  it("an empty slice does not count as a wrap", () => {
    const { next, wrapped } = advanceProgress({
      prev: base({ cold: 400 }), inHotPhase: false, hotSlice: 10, baseSliceLen: 0, coldListLen: 1_000,
    });
    expect(next.cold).toBe(400);
    expect(wrapped).toBe(false);
  });

  it("guards a zero-length cold list against divide-by-zero", () => {
    const { next } = advanceProgress({
      prev: base(), inHotPhase: false, hotSlice: 10, baseSliceLen: 0, coldListLen: 0,
    });
    expect(Number.isFinite(next.cold)).toBe(true);
  });
});

describe("advanceProgress — row shape", () => {
  it("returns EVERY refresh_progress field, so neither write can drop one", () => {
    // The upsert replaces the whole v JSON. A field emitted by one call site
    // and not the other is zeroed every hop — that is how the quiet lane's
    // `rot` counter sat at 0 forever and the lane never ran.
    //
    // AND HOW failedTotal DID THE SAME THING ON 2026-08-24. It was added to
    // RefreshProgress and passed in by the caller, but advanceProgress builds
    // `next` as an explicit literal, so the counter published 0 while boards
    // were failing — one build after being introduced to fix a different
    // silently-dropped number. This assertion is the reason the next one gets
    // caught in CI instead of in production; keep it pinned to the exact key
    // set rather than loosening it.
    const { next } = advanceProgress({
      prev: base({ hot: 10, cold: 20, coldDone: 1, failedAcc: ["acme"] }),
      inHotPhase: false, hotSlice: 10, baseSliceLen: 80, coldListLen: 1_000,
    });
    expect(Object.keys(next).sort()).toEqual(["cold", "coldDone", "failedAcc", "failedTotal", "hot"]);
    expect(next.failedAcc).toEqual(["acme"]);
  });
});

describe("full-rotation coverage", () => {
  // The property that actually protects the published claim: walking the
  // cursor must re-verify every board exactly once per wrap, with no board
  // waiting more than one rotation.
  const walk = (coldListLen: number, sliceLen: number, advanceBy: (n: number) => number) => {
    const seen = new Map<number, number>();
    let cold = 0;
    let wraps = 0;
    for (let hop = 0; hop < 10_000 && wraps < 1; hop++) {
      const take = Math.min(sliceLen, coldListLen - cold);
      for (let i = 0; i < take; i++) seen.set(cold + i, (seen.get(cold + i) ?? 0) + 1);
      const before = cold;
      cold = (cold + advanceBy(take)) % coldListLen;
      if (cold < before) wraps++;
    }
    return seen;
  };

  it("every board is covered exactly once per wrap", () => {
    const LEN = 2_000, SLICE = 80;
    const seen = walk(LEN, SLICE, (take) => take);
    expect(seen.size).toBe(LEN);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  it("REGRESSION: over-advancing by the bootstrap lane leaves a quarter of the catalog unvisited", () => {
    // Demonstrates the shipped bug — this is what the fix has to prevent.
    const LEN = 2_000, SLICE = 80, BOOTSTRAP = 25;
    const seen = walk(LEN, SLICE, (take) => take + BOOTSTRAP);
    expect(seen.size).toBeLessThan(LEN * 0.8);
  });
});

describe("isPassDone", () => {
  it("needs both the hot list exhausted and the cold budget spent", () => {
    expect(isPassDone(base({ hot: 120, coldDone: 120 }), 120, 120)).toBe(true);
    expect(isPassDone(base({ hot: 120, coldDone: 119 }), 120, 120)).toBe(false);
    expect(isPassDone(base({ hot: 110, coldDone: 120 }), 120, 120)).toBe(false);
  });
});
