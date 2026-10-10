// @vitest-environment node
/**
 * THE COLD CURSOR COUNTED STARTS, NOT POSITIONS.
 *
 * Sweep S8-087 (2026-10-08). After a slice that survived, the cold cursor
 * moved by the number of base boards STARTED. Two things in the base slice are
 * not starts and sit inside it:
 *
 *   - a dormant board (not due for recheck) is skipped before it is counted,
 *     so the cursor fell one short per skip and the next slice read the last
 *     started board again (a simulation of 20 boards, slice 5, b2 dormant
 *     fetched b4 twice; live, ~505 dormant of ~44k cold boards, ~1% duplicate
 *     fetches);
 *   - a board the reservation wait gave up on is deferred while later boards
 *     still start, so the count landed the cursor PAST it: that board waited a
 *     whole rotation and a started one was read twice.
 *
 * The cursor now passes the prefix of the base slice that was started or
 * skipped as dormant. These run the shipped start gate (helpers/slice-worker.ts)
 * and the shipped post-loop cursor write, lifted from index.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { advanceProgress, baseConsumedPrefix, type RefreshProgress } from "../../supabase/functions/job-board/rotation";
import { constOf, INDEX_PATH, runGate } from "./helpers/slice-worker";

type Board = { source: string; token: string };
const N = 44_399;

/** The shipped post-loop write: where the next slice starts. */
function cursorAfter(cold: number, base: string[], baseAttempted: number, consumed: string[]): number {
  const RAW = readFileSync(INDEX_PATH, "utf8");
  const at = RAW.indexOf("  const { next: progressAfter, wrapped } = advanceProgress({");
  expect(at, "the post-loop cursor write moved; re-point this test").toBeGreaterThan(-1);
  const span = RAW.slice(at, RAW.indexOf("});", at) + 3);
  const js = transformSync(`${span}\nreturn progressAfter.cold;`, { loader: "ts" }).code;
  const progressBefore: RefreshProgress = { hot: 120, cold, coldDone: 3, failedAcc: [], failedTotal: 0 };
  const advanceArgs = { inHotPhase: false, hotSlice: 10, baseSliceLen: base.length, coldListLen: N };
  return new Function(
    "advanceProgress", "baseConsumedPrefix", "progressBefore", "failedAcc", "failedTotal", "advanceArgs",
    "baseAttempted", "baseSlice", "boardKeyOf", "baseConsumed", js,
  )(
    advanceProgress, baseConsumedPrefix, progressBefore, [], 0, advanceArgs,
    baseAttempted, base.map((token) => ({ source: "lever", token })), (b: Board) => b.token, new Set(consumed),
  ) as number;
}

/** One worker through the shipped gate. `spinOut` boards give up on the reservation wait. */
async function runSlice(base: string[], o: { dormant?: string[]; spinOut?: string[]; boardBudget?: number }) {
  let q: Board[] = base.map((token) => ({ source: "lever", token }));
  let baseAttempted = 0, done = 0;
  let consumed: string[] = [];
  const started: string[] = [], deferred: string[] = [];
  while (q.length) {
    const head = q[0].token;
    const spin = o.spinOut?.includes(head);
    const g = await runGate({
      queue: q, base, baseAttempted, consumed, boardsDone: done, boardBudget: o.boardBudget ?? 80, dormant: o.dormant,
      // A full reservation, waited on past the spin limit: the board is deferred, the next one may start.
      ...(spin ? { inFlightReserve: constOf("SLICE_POSTING_BUDGET"), spinsSoFar: constOf("YIELD_SPIN_LIMIT") } : {}),
    });
    baseAttempted = g.baseAttempted;
    consumed = g.consumed;
    deferred.push(...g.deferred);
    if (g.started) { started.push(g.started); done++; }
    q = g.queue.map((token) => ({ source: "lever", token }));
  }
  return { started, deferred, baseAttempted, consumed };
}

describe("the cold cursor passes what was read or skipped as dormant, no more and no less (S8-087)", () => {
  it("a dormant skip is consumed: the next slice does not read the last started board again", async () => {
    const base = ["b0", "b1", "b2", "b3", "b4"];
    // The board budget stops the slice after three starts; b1 is dormant.
    const s = await runSlice(base, { dormant: ["b1"], boardBudget: 3 });
    expect(s.started).toEqual(["b0", "b2", "b3"]);
    expect(s.deferred).toEqual(["b4"]);
    const next = cursorAfter(1000, base, s.baseAttempted, s.consumed);
    expect(next, "a count of starts restarts at b3, read again").toBe(1004);
  });

  it("a board deferred ahead of later starts heads the next slice instead of waiting a rotation", async () => {
    const base = ["b0", "b1", "b2", "b3"];
    const s = await runSlice(base, { spinOut: ["b1"] });
    expect(s.started).toEqual(["b0", "b2", "b3"]);
    expect(s.deferred).toEqual(["b1"]);
    const next = cursorAfter(1000, base, s.baseAttempted, s.consumed);
    expect(next, "a count of starts moved the cursor past b1 to b3").toBe(1001);
  });

  it("a slice the budget stops in order moves exactly as before, and a whole slice moves by all of it", async () => {
    const base = ["b0", "b1", "b2", "b3", "b4"];
    const stopped = await runSlice(base, { boardBudget: 2 });
    expect(cursorAfter(1000, base, stopped.baseAttempted, stopped.consumed)).toBe(1002);
    const whole = await runSlice(base, {});
    expect(cursorAfter(N - 2, base, whole.baseAttempted, whole.consumed), "and wraps").toBe(3);
  });
});
