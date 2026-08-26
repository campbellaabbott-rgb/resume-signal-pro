import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A CURSOR THAT ADVANCES ONCE EVERY 11.4 HOURS IS NOT A FILL.
 *
 * .16 gave every capped board a cursor and .18 made it observable. The
 * plumbing was right and the cadence was not. Measured live 2026-08-26 by
 * sampling the cold cursor twice, 521s apart:
 *
 *   rate 46 boards/min | 31,501 cold boards | full cycle 11.4 HOURS
 *
 * Workday serves 500 postings per visit, so CVS Health (19,253 advertised)
 * needs 39 visits = 18.5 DAYS to be read once — against a 30-day freshness
 * cap. It cannot be complete and fresh at the same time.
 *
 * The proof that no board had EVER reached a second window, straight off the
 * status bundle at .18:
 *
 *   boards: 66   maxOffset: 500   sumOffset: 33,000     (= 66 x 500 exactly)
 *
 * The fix is cadence, not logic: the deep_cursor map is already the set of
 * boards still filling — written when a board reports a non-zero next offset,
 * deleted when it wraps — so feeding that map back into the slice as a fourth
 * source is the whole change. These tests pin the four properties that keep it
 * from becoming a liability: it is capped, it is deduped, it is rotated so no
 * board starves, and it can never break the rotation it accelerates.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
// Comments stripped for the same reason the sibling file strips them: this
// change adds comments containing the very identifiers asserted below, and a
// guard that passes on its own documentation is worse than no guard. Whole-line
// comments only — the trailing-// strip eats any line carrying a URL.
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

describe("at-cap boards need a fast lane", () => {
  it("the lane is a fourth source in the slice, ahead of the base rotation", () => {
    expect(CODE, "deepBoards is not in the slice at all")
      .toMatch(/const slice = \[\.\.\.demandBoards, \.\.\.bootstrapBoards, \.\.\.deepBoards, \.\.\.baseSlice\]/);
  });

  it("the cursor map is read BEFORE the slice is sealed", () => {
    // The lane's work list is deepCursors. If that read drifts back below the
    // slice the lane silently has nothing to schedule, which is exactly the
    // failure that looks identical to "the lane is broken".
    const read = CODE.indexOf('eq("k", "deep_cursor")');
    const sealed = CODE.indexOf("const slice = [...demandBoards");
    expect(read, "deep_cursor is never read in the refresh path").toBeGreaterThan(-1);
    expect(sealed, "the slice is never assembled").toBeGreaterThan(-1);
    expect(read, "deep_cursor is read after the slice is already sealed").toBeLessThan(sealed);
  });

  it("the added work is capped, and the cap is a named constant", () => {
    expect(CODE).toMatch(/const DEEP_PER_SLICE = \d+;/);
    expect(CODE, "the lane takes the whole map instead of a capped page")
      .toMatch(/\.slice\(0, DEEP_PER_SLICE\)/);
    const cap = Number(/const DEEP_PER_SLICE = (\d+);/.exec(CODE)?.[1]);
    // 160 at-cap boards x 500 postings is real work. The bootstrap lane's 25
    // is the largest per-slice prepend this function has actually survived.
    expect(cap).toBeGreaterThan(0);
    expect(cap, "a prepend larger than the proven-safe bootstrap lane").toBeLessThanOrEqual(25);
  });

  it("dedupe happens BEFORE the cap, not after", () => {
    // Filtering after slicing would let boards already in this slice consume
    // the lane's places with fetches that never happen — the lane would report
    // 25 selected and deliver fewer.
    const filterAt = CODE.indexOf("!taken.has(t)");
    const capAt = CODE.indexOf(".slice(0, DEEP_PER_SLICE)");
    expect(filterAt, "the lane does not dedupe against the slice").toBeGreaterThan(-1);
    expect(capAt).toBeGreaterThan(-1);
    expect(filterAt, "the cap is applied before the dedupe").toBeLessThan(capAt);
  });

  it("dedupes against every other source in the slice", () => {
    expect(CODE).toMatch(/const taken = new Set\(\[\.\.\.baseSlice, \.\.\.demandBoards, \.\.\.bootstrapBoards\]\.map\(\(s\) => s\.token\)\)/);
  });

  it("is round-robin, phased on the cold cursor", () => {
    expect(CODE, "no rotation — the first boards in the map would starve the rest")
      .toMatch(/const start = cold % tokens\.length;/);
    expect(CODE).toMatch(/\[\.\.\.tokens\.slice\(start\), \.\.\.tokens\.slice\(0, start\)\]/);
  });

  it("runs only on cold slices and can never break the rotation", () => {
    const lane = CODE.slice(CODE.indexOf("let deepBoards"), CODE.indexOf("const slice = [...demandBoards"));
    expect(lane, "the lane is not gated to cold slices").toMatch(/if \(!inHotPhase\)/);
    expect(lane, "an accelerator that can throw is a dependency, not an accelerator")
      .toMatch(/\} catch \{/);
  });

  it("reports whether it actually ran, not just that offsets moved", () => {
    // selected vs candidates is the split that separates "the token never
    // resolved to a JobSource" from "it was fetched and had nothing left".
    expect(CODE).toMatch(/deepLane = \{ at: new Date\(\)\.toISOString\(\), candidates: tokens\.length, selected: deepBoards\.length, start \};/);
    // Written when the lane ran EVEN IF no cursor moved — "ran and selected
    // none" is precisely the state that has to be distinguishable.
    expect(CODE).toMatch(/if \(deepCursorsDirty \|\| deepLane\) \{/);
    expect(CODE, "the lane's counters never reach the status bundle")
      .toMatch(/lane: \(\(\) => \{/);
  });

  it("the lane's counters cannot corrupt the numbers used to judge the lane", () => {
    // __lane rides in the deep_cursor row. Both readers keep only positive
    // integers, so an object-valued key is inert to them. This is the whole
    // reason it is safe to store instrumentation in the row it measures.
    expect(CODE).toMatch(/__lane: deepLane/);
    // Refresh-side reader.
    expect(CODE).toMatch(/if \(Number\.isInteger\(n\) && \(n as number\) > 0\) out\[k\] = n as number;/);
    // Status-side reader.
    expect(CODE).toMatch(/const entries = Object\.entries\(v\)\.filter\(\(\[, n\]\) => typeof n === "number" && n > 0\);/);

    // And the semantics those two lines rely on, exercised rather than asserted:
    const row = { "cvshealth~wd1~CVS": 1000, "nike~wd1~nke": 500, __lane: { selected: 25, candidates: 66 } };
    const entries = Object.entries(row).filter(([, n]) => typeof n === "number" && n > 0);
    expect(entries).toHaveLength(2);
    expect(Math.max(...entries.map(([, n]) => n as number))).toBe(1000);
    expect(entries.reduce((t, [, n]) => t + (n as number), 0)).toBe(1500);
  });

  it("rotation covers every board: the window is wider than the cursor's step", () => {
    // A re-implementation of the selection rule, not the shipped code — it
    // exists to prove the FAIRNESS property the shipped rule depends on. The
    // cold cursor moves COLD_SLICE (80) per slice, so successive starts step
    // by 80 % len. Coverage holds only while the cap exceeds that step, which
    // is why the cap must never shrink below it without re-checking this.
    const COLD_SLICE = Number(/const COLD_SLICE = (\d+);/.exec(CODE)?.[1]);
    const cap = Number(/const DEEP_PER_SLICE = (\d+);/.exec(CODE)?.[1]);
    const tokens = Array.from({ length: 66 }, (_, i) => `board-${i}`);
    const seen = new Set<string>();
    for (let pass = 0, cold = 0; pass < 40; pass++, cold += COLD_SLICE) {
      const start = cold % tokens.length;
      [...tokens.slice(start), ...tokens.slice(0, start)].slice(0, cap).forEach((t) => seen.add(t));
    }
    expect(seen.size, "some boards are never selected — the rotation starves them").toBe(tokens.length);
  });
});
