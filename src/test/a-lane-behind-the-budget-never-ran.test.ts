// @vitest-environment node
import { describe, expect, it } from "vitest";
import { advanceProgress } from "../../supabase/functions/job-board/rotation";
import { deepLaneStart, selectDeepLane } from "../../supabase/functions/job-board/deep-lane";
import { constOf, deepLaneRunner, runCompose, runDeepLane, runGate, runLaneTakes } from "./helpers/slice-worker";

/**
 * A LANE BEHIND THE BUDGET NEVER RAN (job-board .90, F7).
 *
 * The deep lane resumes capped boards (Workday, Oracle, iCIMS...) between their
 * cold-rotation turns. It sat LAST in the slice, behind 25 bootstrap boards and
 * 80 base boards, against a board budget of 80 and a posting budget of 1,500:
 * on .89 `deepCursor.lane` read visited 0 in every one of 16 cold slices sampled
 * 00:53-01:16Z on 2026-10-06 (selected 2, candidates ~720), and again at
 * 03:19Z. So pg~wd5~1000, whose 471 in-window postings sit at feed positions
 * 0-470 of 816, moved one 260-row window per cold rotation (~6h) and served 0.
 *
 * Now the slice is [demand, bootstrap, retry, stale, deep, base], the deep take
 * (1) comes out of the bootstrap take, and the lane's start is mapped from the
 * cold cursor's place in its rotation. These run the shipped lane-size block,
 * the deep-lane block, the slice composition and the worker's start gate
 * (helpers/slice-worker.ts) and the shipped cursor rule (rotation.ts).
 */

type Board = { source: string; token: string };
const N = 44_399; // the live cold list on 2026-10-06 (44,519 catalogued - 120 hot)

/** Runs the composed slice through the shipped start gate, one board at a time, and reports what started. */
async function runSlice(queue: Board[], o: { base: string[]; boardBudget: number; postings: (b: Board) => number }) {
  const byToken = new Map(queue.map((b) => [b.token, b]));
  let q = queue, fetched = 0, done = 0, baseAttempted = 0;
  const started: string[] = [], deferred: string[] = [];
  for (;;) {
    const g = await runGate({ queue: q, fetchedInSlice: fetched, boardsDone: done, baseAttempted, base: o.base, boardBudget: o.boardBudget, turns: q.length + 1 });
    deferred.push(...g.deferred);
    baseAttempted = g.baseAttempted;
    if (!g.started) break;
    started.push(g.started);
    done++;
    fetched += o.postings(byToken.get(g.started)!);
    q = g.queue.map((t) => byToken.get(t)!);
  }
  return { started, deferred, baseAttempted, fetched };
}

/** A cold slice at rest, its lanes full, the deep board chosen by the shipped lane from ~700 capped boards. */
function restingSlice(cold: number) {
  const t = runLaneTakes(0);
  const names = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  const cursors = names("cap", 700).map((k) => [k, 260] as [string, number]);
  const base = names(`c${cold}+`, constOf("COLD_SLICE"));
  const deep = runDeepLane({ cursors, cold, coldListLen: N, deepTake: t.deepTake, base }).picked;
  const lanes = {
    demand: ["demand0"], bootstrap: names("boot", t.bootstrapTake), retry: names("retry", t.retryTake),
    stale: names("stale", t.effStalePerSlice), deep, base,
  };
  const queue = runCompose(lanes).map((token) => ({ source: token.startsWith("cap") ? "workday" : "lever", token }));
  return { t, lanes, queue };
}

const cursorAfter = (cold: number, baseAttempted: number) => advanceProgress({
  prev: { hot: 120, cold, coldDone: 10, failedAcc: [] }, inHotPhase: false, hotSlice: 4, baseSliceLen: baseAttempted, coldListLen: N,
}).next.cold;

describe("the deep lane runs, ahead of the base rotation", () => {
  it("a slice stopped by the board budget starts its deep board before any base board, and the cursor moves by base boards started only", async () => {
    const cold = 24_890;
    const { lanes, queue } = restingSlice(cold);
    expect(lanes.deep.length, "the lane chose a board").toBeGreaterThan(0);
    const run = await runSlice(queue, { base: lanes.base, boardBudget: constOf("MAX_BOARDS_PER_SLICE"), postings: () => 5 });
    const deepAt = run.started.indexOf(lanes.deep[0]);
    const firstBase = run.started.findIndex((k) => lanes.base.includes(k));
    expect(deepAt, "the deep board was started (on .89 it never was)").toBeGreaterThanOrEqual(0);
    expect(deepAt, "and before the first base board").toBeLessThan(firstBase);
    const baseStarted = run.started.filter((k) => lanes.base.includes(k)).length;
    expect(run.baseAttempted, "the worker counts base boards only").toBe(baseStarted);
    // The base share of the 80-board budget is what it was with 25 bootstrap boards and the lane at the tail.
    const before = constOf("MAX_BOARDS_PER_SLICE") - (lanes.demand.length + constOf("BOOTSTRAP_PER_SLICE") + lanes.retry.length + lanes.stale.length);
    expect(baseStarted, "the deep board took a bootstrap board's place, not a base board's").toBe(before);
    expect(cursorAfter(cold, run.baseAttempted), "the cold cursor advances by base boards started, never by the deep board").toBe(cold + baseStarted);
    expect(run.deferred.every((k) => lanes.base.includes(k)), "only base boards are left for the next slice").toBe(true);
  });

  it("a slice stopped by the posting budget still reaches its deep board, and the base boards it deferred head the next slice", async () => {
    const cold = 24_890;
    const { lanes, queue } = restingSlice(cold);
    const postings = (b: Board) => (lanes.deep.includes(b.token) ? 260 : lanes.base.includes(b.token) ? 60 : 2);
    const run = await runSlice(queue, { base: lanes.base, boardBudget: constOf("MAX_BOARDS_PER_SLICE"), postings });
    expect(run.fetched, "the posting budget stopped this slice").toBeGreaterThanOrEqual(constOf("SLICE_POSTING_BUDGET"));
    expect(run.started, "the deep board was read").toContain(lanes.deep[0]);
    const next = cursorAfter(cold, run.baseAttempted);
    expect(next - cold).toBe(run.baseAttempted);
    expect(run.deferred[0], "the first base board the budget deferred is where the next slice starts").toBe(lanes.base[next - cold]);
  });

  it("the deep take comes out of the bootstrap take at every shed level, and 0 turns the lane off", () => {
    const deepCeiling = constOf("DEEP_PER_SLICE");
    for (const level of [0, 1, 2] as const) {
      const t = runLaneTakes(level);
      expect(t.deepTake + t.bootstrapTake, `L${level}: the lanes ahead of base hold as many boards as the bootstrap lane alone did`).toBe(t.effBootstrapPerSlice);
      expect(t.deepTake, `L${level}: never past the memory ceiling`).toBeLessThanOrEqual(deepCeiling);
    }
    expect(runLaneTakes(0).deepTake, "one deep board a slice at rest").toBe(1);
    expect(runLaneTakes(2).deepTake, "the deep lane is the first thing L2 sheds").toBe(0);
    const off = runLaneTakes(0, { DEEP_LANE_TAKE: 0 });
    expect([off.deepTake, off.bootstrapTake], "rolled back to 0: no deep board, the bootstrap lane whole again").toEqual([0, constOf("BOOTSTRAP_PER_SLICE")]);
  });
});

describe("a take of one reaches every candidate, whatever the cursor's stride", () => {
  /** One cold rotation of slices at the given strides: the distinct boards the shipped lane chose, and how many slices ran. */
  const rotation = (candidates: number, coldListLen: number, stride: (i: number) => number) => {
    const take = runLaneTakes(0).deepTake;
    const lane = deepLaneRunner();
    const cursors = Array.from({ length: candidates }, (_, i) => [`cap${i}`, 260] as [string, number]);
    const seen = new Set<string>();
    let cold = 0, slices = 0;
    for (;;) {
      for (const k of lane({ cursors, cold, coldListLen, deepTake: take }).picked) seen.add(k);
      const next = (cold + stride(slices++)) % coldListLen;
      if (next < cold) break;
      cold = next;
    }
    return { distinct: seen.size, slices };
  };

  it("a constant stride sharing a factor with the candidate count starves no board (a cold % L start did)", () => {
    // n014's shape: 66 candidates, the cursor stepping 80; and the live shape: ~700 candidates, 55 base boards a slice.
    for (const [candidates, stride] of [[66, 80], [66, 55], [700, 55], [700, 46], [725, 50]]) {
      const r = rotation(candidates, N, () => stride);
      expect(r.distinct, `${candidates} candidates, stride ${stride}: every candidate (${r.slices} slices)`).toBe(candidates);
    }
  });

  it("strides taken from live slices, and a list longer than a rotation has slices: as many boards as slices allow", () => {
    const live = [55, 54, 56, 58, 20, 35, 14, 57];
    expect(rotation(700, N, (i) => live[i % live.length]).distinct).toBe(700);
    const r = rotation(700, N, () => 80);
    expect(r.slices, "fewer slices than candidates").toBeLessThan(700);
    expect(r.distinct, "one new board every slice").toBe(r.slices);
  });

  it("the start walks the list in order as the cursor moves through its rotation", () => {
    const cursors = Array.from({ length: 700 }, (_, i) => [`cap${i}`, 260] as [string, number]);
    const starts = [0, 63, 1_000, 22_199, 44_398].map((cold) => runDeepLane({ cursors, cold, coldListLen: N, deepTake: 1 }).lane!.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBe(0);
    expect(starts[starts.length - 1]).toBe(699);
    expect(deepLaneStart(5, N, 0), "no candidates").toBe(0);
    expect(deepLaneStart(N + 63, N, 700), "a cursor past the end is read modulo the list").toBe(deepLaneStart(63, N, 700));
    expect(selectDeepLane(["a", "b"], { cold: 0, coldListLen: N, take: 0, taken: new Set() }).picked).toEqual([]);
  });
});
