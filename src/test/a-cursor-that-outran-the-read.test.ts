// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { constOf, runGate, runLaneTakes } from "./helpers/slice-worker";

/**
 * A CURSOR THAT OUTRAN THE READ.
 *
 * The slice is composed [demand, bootstrap, retry, stale, deep, COLD ROTATION]
 * (.90; the deep lane was last until then), and a
 * memory-bounded slice necessarily stops partway through it — the posting
 * budget is there precisely to stop it. So the boards it never reached were
 * never read, and the cold cursor must not move past them.
 *
 * MEASURED on .47: the cold cursor moved 16,720 -> 17,760, past 1,040 boards,
 * while at most ~336 could have been fetched. Two thirds of the rotation was
 * marked visited without being read — which is why freshness climbed while
 * works, slices and the chain kick all reported a healthy ingest.
 *
 * .50 fixed that by shrinking every lane to fit a board budget, so the
 * composed length equalled the reachable length. It worked and it was the
 * wrong side of the trade: it throttled the cold rotation to about nine boards
 * a slice — 4,889 slices for one pass — and freshness went 403 -> 2,320
 * minutes while the rotation grew steadily more correct.
 *
 * .56 puts the correction where it belongs. Lanes are full-sized, the posting
 * budget stops the loop wherever memory says, and the POST-LOOP cursor write
 * advances by the base-slice boards actually attempted. The pre-loop write
 * stays optimistic — that is what stops a dying slice re-reading the same
 * boards forever — and the post-loop write, which only happens when the slice
 * survived, tells the truth.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a cursor that outran the read", () => {
  it("counts the base-slice boards actually STARTED", async () => {
    expect(CODE).toMatch(/const baseTokens = new Set\(baseSlice\.map\(\(b\) => b\.token\)\);/);
    expect(CODE).toMatch(/let baseAttempted = 0;/);
    expect(CODE).toMatch(/if \(baseTokens\.has\(s\.token\)\) baseAttempted\+\+;/);
    // Counted where the board is committed to, after every deferral check —
    // a board the budget skipped must not be counted as attempted. RUN since .90 (n423).
    const base = { source: "lever", token: "b" };
    expect((await runGate({ queue: [base], base: ["b"], baseAttempted: 3 })).baseAttempted, "a started base board counts").toBe(4);
    expect((await runGate({ queue: [{ source: "lever", token: "x" }], base: ["b"], baseAttempted: 3 })).baseAttempted, "a board from another lane does not").toBe(3);
    for (const [why, o] of [
      ["landed postings", { fetchedInSlice: constOf("SLICE_POSTING_BUDGET") }],
      ["wall", { elapsedMs: 10_000_000 }],
      ["heap", { heapMb: 10_000 }],
      ["slice size", { boardsDone: 80, boardBudget: 80 }],
    ] as const) {
      expect((await runGate({ queue: [base], base: ["b"], baseAttempted: 3, ...o })).baseAttempted, `after the ${why} deferral`).toBe(3);
    }
    const inc = CODE.indexOf("if (baseTokens.has(s.token)) baseAttempted++;");
    expect(inc, "and before the fetch it accompanies").toBeLessThan(CODE.indexOf("r = await fetchBoard(s,"));
  });

  it("the POST-loop write advances by what was attempted, not by the composed length", () => {
    expect(CODE).toMatch(/const \{ next: progressAfter, wrapped \} = advanceProgress\(\{\s*prev: \{ \.\.\.progressBefore, failedAcc, failedTotal \},\s*\.\.\.advanceArgs,\s*baseSliceLen: baseAttempted,\s*\}\);/);
  });

  it("the PRE-loop write stays optimistic, or a dying slice wedges the rotation", () => {
    // Both writes exist and they are different on purpose: the first protects
    // against a death, the second corrects a survival.
    const pre = CODE.indexOf("const { next } = advanceProgress({ prev: progressBefore, ...advanceArgs });");
    expect(pre, "the optimistic pre-loop advance must still be there").toBeGreaterThan(0);
    expect(pre).toBeLessThan(CODE.indexOf("baseSliceLen: baseAttempted"));
  });

  it("the lanes are full-sized again — the throttle is gone", () => {
    // Run, not spelled (.90): the lane-size block computes without the board
    // budget (the harness binds no boardBudget), the cold slice is whole, and
    // the bootstrap take gives up only the deep lane's board (n426).
    const t = runLaneTakes(0);
    expect(t.effColdSlice).toBe(constOf("COLD_SLICE"));
    expect(t.bootstrapTake + t.deepTake).toBe(constOf("BOOTSTRAP_PER_SLICE"));
    expect(CODE, "no lane may be sized from the board budget again").not.toMatch(/const coldTake = Math\.max\(1, boardBudget/);
  });

  it("the bootstrap lane still drains exactly what it took", () => {
    expect(CODE).toMatch(/queue: queue\.slice\(bootstrapTake\)/);
    expect(CODE).toMatch(/drained: Math\.min\(bootstrapTake, queue\.length\)/);
  });
});
