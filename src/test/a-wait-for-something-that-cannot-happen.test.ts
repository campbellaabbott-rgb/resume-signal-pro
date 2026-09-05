import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A WAIT FOR SOMETHING THAT CANNOT HAPPEN.
 *
 * The root cause, found after six versions of fixes aimed at memory.
 *
 * .39 replaced a `return` with a yield: when the in-flight reservation fills
 * the posting budget, the worker hands the board back and waits rather than
 * retiring for the whole slice. That fixed a real defect. It also created this
 * one: `inFlightReserve` only falls when a board RETURNS, and `fetchedInSlice`
 * only RISES, so once the reservation is zero and the sum still exceeds the
 * budget, the worker is waiting for an event that cannot occur. Every worker
 * that reaches it spins on a 250ms timer until the platform kills the isolate.
 *
 * The evidence was in front of me the whole time and I read it as memory: a
 * `loop-done` breadcrumb had NEVER appeared in any trace, across every version
 * since .39. The loop was not dying. It was never exiting.
 *
 * It was nearly unreachable at the old 12,000-posting budget — the window is
 * `fetchedInSlice` within one board's reservation of the budget — which is why
 * it lay dormant until .52 set the budget to a measured 1,400 and made the
 * window ordinary.
 *
 * The invariant: EVERY PATH THROUGH THE LOOP BODY EITHER STARTS A BOARD OR
 * REMOVES ONE FROM THE QUEUE. A wait is only legitimate while something is in
 * flight that can end it.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const num = (n: string) => Number(CODE.match(new RegExp(`const ${n} = ([0-9_]+)`))![1].replace(/_/g, ""));

describe("a wait for something that cannot happen", () => {
  it("a worker never waits when nothing is in flight", () => {
    expect(CODE).toMatch(/if \(inFlightReserve === 0 \|\| spins > YIELD_SPIN_LIMIT\) \{\s*budgetSkipped\.push\(s\.token\);\s*continue;\s*\}/);
    // The wait must come AFTER that escape, or the escape is unreachable.
    const escape = CODE.indexOf("if (inFlightReserve === 0 || spins > YIELD_SPIN_LIMIT)");
    const wait = CODE.indexOf("await new Promise((r) => setTimeout(r, 250));");
    expect(escape).toBeGreaterThan(0);
    expect(escape, "the escape must be checked before the wait").toBeLessThan(wait);
  });

  it("the spin is counted per board and capped", () => {
    expect(CODE).toMatch(/const yieldsByToken = new Map<string, number>\(\);/);
    expect(CODE).toMatch(/const spins = \(yieldsByToken\.get\(s\.token\) \?\? 0\) \+ 1;/);
    expect(num("YIELD_SPIN_LIMIT")).toBeGreaterThan(0);
    expect(num("YIELD_SPIN_LIMIT") * 250, "the cap must be short enough to leave the slice time to finish")
      .toBeLessThan(30_000);
  });

  it("the deadlock window is real arithmetic, not a hypothetical", () => {
    // With nothing in flight, a worker reaches the wait whenever
    // fetchedInSlice sits within one board's reservation of the budget. At the
    // measured budget that window is ordinary; the escape is what makes it
    // survivable.
    const budget = num("SLICE_POSTING_BUDGET");
    const cap = num("MAX_POSTINGS_PER_VISIT");
    expect(budget - cap, "the window is reachable on a normal slice, which is why the escape matters")
      .toBeLessThan(budget);
    expect(cap).toBeLessThan(budget);
  });

  it("a deferred board is still not a failed one", () => {
    // The escape defers; deferrals must stay out of failure accounting or a
    // board nobody attempted feeds the retry lane and, sustained, the prune.
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
    expect(CODE).toMatch(/!budgetSkippedSet\.has\(tk\)/);
  });
});
