import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A CURSOR THAT OUTRAN THE READ.
 *
 * The slice is composed [demand, bootstrap, retry, COLD ROTATION, deep], and
 * the board budget introduced in .44 stops the loop after N boards in that
 * order. With a budget of 16 and a bootstrap lane of 25, bootstrap consumed
 * the entire budget and the cold rotation got NOTHING — while the cold cursor
 * still advanced by the full composed slice length of 80.
 *
 * MEASURED over ten minutes on .47: the cold cursor moved 16,720 -> 17,760,
 * past 1,040 boards, while at most ~336 could have been fetched at the budgets
 * in force. Two thirds of the rotation was marked visited without being read.
 * That is why freshness climbed from 863 to 1,042 minutes while works, slices
 * and the chain kick all said the ingest was healthy — every signal was true,
 * and the boards were still not being fetched.
 *
 * This file already carried the same lesson for load shedding: "advancing by
 * 10 while shedding took 3 would skip 7 giants' freshness every shed hop".
 * The board budget was a second way for the take to fall short of the composed
 * slice, and the cursor was never taught about it.
 *
 * The invariant: EVERY LANE IS SIZED TO FIT THE BUDGET BEFORE THE SLICE IS
 * COMPOSED, so the composed length is the length the loop can actually reach.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a cursor that outran the read", () => {
  it("every lane is sized from the budget, not from its own constant", () => {
    expect(CODE).toMatch(/const deepTake = Math\.min\(shedDeepPerSlice, boardBudget >= 12 \? shedDeepPerSlice : 0\);/);
    expect(CODE).toMatch(/const retryTake = Math\.min\(shedRetryPerSlice, 2\);/);
    expect(CODE).toMatch(/const bootstrapTake = Math\.min\(shedBootstrapPerSlice, Math\.max\(0, Math\.floor\(\(boardBudget - deepTake - retryTake\) \* 0\.3\)\)\);/);
    expect(CODE).toMatch(/const coldTake = Math\.max\(1, boardBudget - deepTake - retryTake - bootstrapTake\);/);
    expect(CODE).toMatch(/const effColdSlice = Math\.min\(shedColdSlice, coldTake\);/);
  });

  it("the lanes cannot sum past the budget", () => {
    // The arithmetic, evaluated rather than eyeballed, at both ends of the ramp.
    for (const budget of [8, 12, 16]) {
      const deep = budget >= 12 ? 2 : 0;
      const retry = 2;
      const boot = Math.max(0, Math.floor((budget - deep - retry) * 0.3));
      const cold = Math.max(1, budget - deep - retry - boot);
      expect(deep + retry + boot + cold, `lanes must fit budget ${budget}`).toBeLessThanOrEqual(budget);
      expect(cold, `the cold rotation must get a real share at budget ${budget}`).toBeGreaterThan(0);
    }
  });

  it("the demand lane is paid for out of the cold take, before the cursor is written", () => {
    expect(CODE).toMatch(/baseSlice = baseSlice\.slice\(0, Math\.max\(1, effColdSlice - demandBoards\.length\)\)/);
    const trim = CODE.indexOf("baseSlice = baseSlice.slice(0, Math.max(1, effColdSlice - demandBoards.length))");
    expect(trim, "the trim must precede the cursor write, which reads baseSlice.length")
      .toBeLessThan(CODE.indexOf("baseSliceLen: baseSlice.length"));
    expect(trim, "and precede the slice assembly it feeds")
      .toBeLessThan(CODE.indexOf("const slice = [...demandBoards"));
  });

  it("the bootstrap lane drains its CAPPED take, not the shed constant", () => {
    // Draining more than was taken is the same defect from the other side: the
    // queue would advance past boards this slice never fetched.
    expect(CODE).toMatch(/queue: queue\.slice\(bootstrapTake\)/);
    expect(CODE).toMatch(/drained: Math\.min\(bootstrapTake, queue\.length\)/);
  });
});
