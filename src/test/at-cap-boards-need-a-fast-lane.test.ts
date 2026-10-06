// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { constOf, deepLaneRunner, runCompose, runDeepLane, runLaneTakes } from "./helpers/slice-worker";

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
  it("the lane is a source in the slice, AHEAD of the base rotation (.90, n426)", () => {
    // .29 put it LAST so the posting budget would defer the lane before base.
    // Last never ran: behind 25 bootstrap and 80 base boards against a budget
    // of 80, the lane visited 0 boards in 16 of 16 cold slices sampled on .89
    // (2026-10-06). And a base board the budget defers costs nothing since .50:
    // the cursor counts only the base boards started, so it heads the next
    // slice. The composition is run, not spelled; the whole slice is run in
    // a-lane-behind-the-budget-never-ran.test.ts.
    const slice = runCompose({ demand: ["d"], bootstrap: ["b"], retry: ["r"], stale: ["s"], deep: ["x"], base: ["k1", "k2"] });
    expect(slice, "deepBoards is not in the slice at all").toContain("x");
    expect(slice.indexOf("x"), "the deep lane must come before the base rotation").toBeLessThan(slice.indexOf("k1"));
    expect(slice.slice(-2), "the base rotation is the tail").toEqual(["k1", "k2"]);
    // The optimistic write still advances by the base take alone, whatever else rides in the slice.
    expect(CODE, "the cursor must advance by the base take alone, whatever else rides in the slice").toMatch(/baseSliceLen: baseSlice\.length,/);
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
    // THE CONSTANT STAYS TIED TO WHAT IT COUNTS. DEEP_PER_SLICE is derived from
    // a volume allowance over the per-visit cap; if either moves without the
    // other, the lane is silently re-sized in postings — the .21 failure.
    const ceiling = constOf("DEEP_PER_SLICE");
    expect(ceiling, "DEEP_PER_SLICE must be floor(DEEP_VOLUME_PER_SLICE / MAX_POSTINGS_PER_VISIT)")
      .toBe(Math.max(1, Math.floor(constOf("DEEP_VOLUME_PER_SLICE") / constOf("MAX_POSTINGS_PER_VISIT"))));
    expect(ceiling).toBeGreaterThan(0);
    // 160 at-cap boards x 500 postings is real work. The bootstrap lane's 25
    // is the largest per-slice prepend this function has actually survived.
    expect(ceiling, "a prepend larger than the proven-safe bootstrap lane").toBeLessThanOrEqual(25);
    // The take APPLIED (.90: DEEP_LANE_TAKE, 1) never passes the ceiling, and sheds to 0 at L2.
    for (const level of [0, 1, 2] as const) expect(runLaneTakes(level).deepTake, `L${level}`).toBeLessThanOrEqual(ceiling);
    expect(runLaneTakes(2).deepTake).toBe(0);
    // And the lane takes no more than its take, however many boards are waiting.
    const cursors = Array.from({ length: 200 }, (_, i) => [`cap${i}`, 260] as [string, number]);
    for (const take of [0, 1, 2]) {
      expect(runDeepLane({ cursors, cold: 1_234, coldListLen: 44_399, deepTake: take }).picked, `take ${take}`).toHaveLength(take);
    }
  });

  it("dedupe happens BEFORE the cap, not after", () => {
    // Filtering after slicing would let boards already in this slice consume
    // the lane's places with fetches that never happen — the lane would report
    // selected and deliver fewer.
    const cursors: Array<[string, number]> = [["a", 260], ["b", 260], ["c", 260]];
    const r = runDeepLane({ cursors, cold: 0, coldListLen: 44_399, deepTake: 1, base: ["a"] });
    expect(r.picked, "the start board is in the slice, so the next one takes the place").toEqual(["b"]);
    expect(r.lane?.selected).toBe(1);
  });

  it("dedupes against every other source in the slice", () => {
    const cursors: Array<[string, number]> = [["a", 260], ["b", 260], ["c", 260], ["d", 260]];
    const r = runDeepLane({ cursors, cold: 0, coldListLen: 44_399, deepTake: 2, base: ["a"], demand: ["b"], bootstrap: ["c"] });
    expect(r.picked, "base, demand and bootstrap boards are never fetched twice").toEqual(["d"]);
  });

  it("is phased on the cold cursor: the start walks the map as the cursor walks its rotation", () => {
    const cursors = Array.from({ length: 66 }, (_, i) => [`board-${i}`, 500] as [string, number]);
    const startAt = (cold: number) => runDeepLane({ cursors, cold, coldListLen: 31_501, deepTake: 1 }).lane!.start;
    const starts = [0, 480, 9_000, 20_000, 31_500].map(startAt);
    expect(starts, "no rotation — the first boards in the map would starve the rest").toEqual([...starts].sort((a, b) => a - b));
    expect([starts[0], starts[starts.length - 1]], "from the head of the map to its last board").toEqual([0, 65]);
  });

  it("runs only on cold slices and can never break the rotation", () => {
    const cursors: Array<[string, number]> = [["a", 260], ["b", 260]];
    const hot = runDeepLane({ cursors, cold: 0, coldListLen: 44_399, deepTake: 1, inHotPhase: true });
    expect([hot.picked, hot.lane], "the lane is not gated to cold slices").toEqual([[], null]);
    const broken = runDeepLane({ cursors, cold: 0, coldListLen: 44_399, deepTake: 1, select: () => { throw new Error("boom"); } });
    expect([broken.picked, broken.lane], "an accelerator that can throw is a dependency, not an accelerator").toEqual([[], null]);
  });

  it("reports whether it actually ran, not just that offsets moved", () => {
    // selected vs candidates is the split that separates "the token never
    // resolved to a JobSource" from "it was fetched and had nothing left".
    expect(CODE).toMatch(/deepLane = \{ at: new Date\(\)\.toISOString\(\), candidates: tokens\.length, selected: deepBoards\.length, visited: 0, start \};/);
    // ...AND `visited`, because selected is not visited and the gap was the
    // whole story. The deep lane is LAST in the composed slice, and the posting
    // budget stops the loop around 30 boards against a queue index of 85+, so
    // nothing in this lane has actually been fetched in a long time — while
    // `selected: 2` went on being written every cold slice and read, by the
    // runbook's own instruction, as the lane working. An instrumented lane that
    // reports the wrong side of the fork it was added to resolve is worse than
    // an uninstrumented one, because it is believed.
    expect(CODE, "the lane counts what it SELECTED but never what it VISITED")
      .toMatch(/if \(deepLane && deepTokens\.has\(s\.token\)\) deepLane\.visited\+\+;/);
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
    // Refresh-side reader: a Map since .69 (a token named 'constructor' read a
    // function from the Record form), bridged by token-map.ts, whose filter
    // is the same positive-integer rule.
    expect(CODE).toMatch(/const deepCursors: Map<string, number> = tokenMapFromRecord\(deepCursorRow\);/);
    const BRIDGE = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/token-map.ts"), "utf8");
    expect(BRIDGE).toMatch(/if \(Number\.isInteger\(n\) && \(n as number\) > 0\) out\.set\(k, n as number\);/);
    // Status-side reader.
    expect(CODE).toMatch(/const entries = Object\.entries\(v\)\.filter\(\(\[, n\]\) => typeof n === "number" && n > 0\);/);

    // And the semantics those two lines rely on, exercised rather than asserted:
    const row = { "cvshealth~wd1~CVS": 1000, "nike~wd1~nke": 500, __lane: { selected: 25, candidates: 66 } };
    const entries = Object.entries(row).filter(([, n]) => typeof n === "number" && n > 0);
    expect(entries).toHaveLength(2);
    expect(Math.max(...entries.map(([, n]) => n as number))).toBe(1000);
    expect(entries.reduce((t, [, n]) => t + (n as number), 0)).toBe(1500);
  });

  it("rotation covers every board at the take that ships, whatever the cursor's step", () => {
    // Runs the shipped lane. n014: with the start at cold % L, a take of one
    // and the cursor stepping 80 over 66 boards visited only the even
    // positions. Since .90 the start is the cursor's place in its rotation
    // mapped onto the map (deep-lane.ts), so a step sharing a factor with the
    // map's length starves nothing.
    const take = runLaneTakes(0).deepTake;
    const lane = deepLaneRunner();
    const cursors = Array.from({ length: 66 }, (_, i) => [`board-${i}`, 500] as [string, number]);
    for (const step of [80, 55, 66]) {
      const seen = new Set<string>();
      for (let cold = 0; cold < 31_501; cold += step) lane({ cursors, cold, coldListLen: 31_501, deepTake: take }).picked.forEach((t) => seen.add(t));
      expect(seen.size, `step ${step}: some boards are never selected — the rotation starves them`).toBe(cursors.length);
    }
  });
});
