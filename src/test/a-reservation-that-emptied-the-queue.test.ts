// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGate, runVisit } from "./helpers/slice-worker";

/**
 * A RESERVATION THAT EMPTIED THE QUEUE.
 *
 * .32 made the slice budget count what was HELD: each in-flight board reserved
 * the 2,000-posting per-visit cap until it returned. Correct for the hot
 * phase (two giants at a time) and wrong for the cold one: eight small boards
 * in flight reserve 16,000 against a 12,000 budget, so the first worker to
 * return judged the budget spent and — because the check `continue`d without
 * awaiting — drained every remaining board into "deferred" in one synchronous
 * pass. Measured 2026-09-03 20:19Z: a cold slice fetched 178 postings and
 * deferred 111 boards, and the cold cursor had already advanced past all of
 * them. Freshness p50 climbed 1411 -> 1546 min that afternoon.
 *
 * Two rules now, both pinned here:
 *  1. A board is deferred only on what has LANDED.
 *  2. When the reservation is what fills the budget, the worker retires and
 *     hands the board back to a worker still in flight — concurrency shrinks,
 *     the queue does not. The last worker never retires (nothing in flight,
 *     nothing reserved), so the slice always drains.
 *  3. The reserve is per board: the cap for a hot-phase or deep-lane board,
 *     a small constant for a cold board, and the arithmetic below guarantees
 *     that an empty-handed cold slice cannot even retire a worker.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const num = (name: string) => Number(CODE.match(new RegExp(`const ${name} = ([0-9_]+);`))![1].replace(/_/g, ""));

describe("a reservation that emptied the queue", () => {
  it("defers only on LANDED postings, and never inside the reservation branch", async () => {
    // .90 (n423): the start checks are one gate (start-gate.ts); the worker's turn is RUN, not spelled.
    const budget = num("SLICE_POSTING_BUDGET");
    const board = { source: "lever", token: "a" };
    expect((await runGate({ queue: [board], fetchedInSlice: budget })).deferred, "landed postings").toEqual(["a"]);
    // .41 added a SECOND deferral, on heap — the quantity that actually runs
    // out (the-budget-counted-the-wrong-thing.test.ts). Both are deferrals of
    // a board never attempted; what must never happen is a deferral inside the
    // reservation branch, which is what emptied the queue in the first place.
    // .42 added a third: elapsed wall time, the bound that actually matched
    // the deaths (a-slice-with-no-clock.test.ts).
    // .63 added a SIXTH: a list response over MAX_RESPONSE_BYTES, refused
    // before its body is read. That is the only one of the six that acts
    // BEFORE the allocation exists rather than after — every other bound here
    // measures something already in memory, which is why five of them could be
    // "measured on both sides" and still read as refuted.
    // Six deferrals, each RUN: landed postings (above), heap, wall time, slice size, a wait that cannot end, and the byte budget.
    expect((await runGate({ queue: [board], heapMb: num("HEAP_SOFT_LIMIT_MB") })).deferred, "heap").toEqual(["a"]);
    expect((await runGate({ queue: [board], elapsedMs: num("SLICE_WALL_BUDGET_MS") })).deferred, "wall time").toEqual(["a"]);
    expect((await runGate({ queue: [board], boardsDone: 8, boardBudget: 8 })).deferred, "slice size").toEqual(["a"]);
    expect((await runGate({ queue: [board], fetchedInSlice: budget - 10, inFlightReserve: 40, spinsSoFar: num("YIELD_SPIN_LIMIT") })).deferred, "a wait that cannot end").toEqual(["a"]);
    const over = await runVisit({ board: { source: "lever", token: "a" }, failReason: "oversize 6.2MB" });
    expect([over.deferred, over.failed], "the byte budget").toEqual([["a"], []]);
    // The reservation branch defers nothing while something in flight can still lower it.
    const held = await runGate({ queue: [board], fetchedInSlice: budget - 1, inFlightReserve: 40 });
    expect(held.deferred, "neither deferral may sit in the reservation branch").toEqual([]);
  });

  it("retires the worker and returns the board when the reservation fills the budget", async () => {
    // .39: it YIELDS rather than exiting — `return` ended the worker for the
    // whole slice, ratcheting concurrency down to 1 in the tail of every cold
    // slice (four-ways-to-lose-a-board.test.ts). The board still goes back to
    // the head of the queue for whoever is still in flight.
    const budget = num("SLICE_POSTING_BUDGET");
    const [a, b] = [{ source: "lever", token: "a" }, { source: "lever", token: "b" }];
    const both = await runGate({ queue: [a, b], fetchedInSlice: budget, inFlightReserve: 40 });
    expect([both.deferred, both.waitedMs], "landed check first, so a board over budget is deferred, not bounced between workers").toEqual([["a"], []]);
    const held = await runGate({ queue: [a, b], fetchedInSlice: budget - 10, inFlightReserve: 40, turns: 2 });
    expect(held.queue, "a retired board must go back to the HEAD, or it waits behind the whole queue").toEqual(["a", "b"]);
    expect(held.waitedMs, "it waits, once a turn").toEqual([250, 250]);
    expect(held.exited, "and the worker must NOT exit the slice").toBe(false);
  });

  it("reserves per board — the cap for hot-phase and deep boards, a small constant for cold ones", () => {
    // .36: capped-visit vendors and page-overridden giants reserve the cap too
    // (a-deferred-board-is-not-a-failed-one.test.ts) — cold Oracle boards page to 2,000 by default.
    expect(CODE).toMatch(/const reserve = inHotPhase \|\| deepTokens\.has\(s\.token\) \|\| CAPPED_VISIT_VENDORS\.has\(s\.source\) \|\| !!s\.pages \? MAX_POSTINGS_PER_VISIT : COLD_BOARD_RESERVE;/);
    expect(CODE).toMatch(/const deepTokens = new Set\(deepBoards\.map\(\(b\) => b\.token\)\);/);
    expect(CODE).toMatch(/inFlightReserve \+= reserve;/);
    expect(CODE).toMatch(/finally \{ inFlightReserve -= reserve; \}/);
  });

  it("arithmetic: an empty-handed cold slice cannot retire a worker", () => {
    const concurrency = num("CONCURRENCY");
    const coldReserve = num("COLD_BOARD_RESERVE");
    const deepPerSlice = num("DEEP_PER_SLICE");
    const cap = num("MAX_POSTINGS_PER_VISIT");
    const budget = num("SLICE_POSTING_BUDGET");
    // Worst case seen by a returning worker: every other cold worker in flight
    // plus both deep boards in flight, nothing landed yet.
    const reservedAtMost = (concurrency - 1) * coldReserve + deepPerSlice * cap;
    expect(reservedAtMost, `${reservedAtMost} reserved with nothing landed would retire workers on every cold slice`).toBeLessThan(budget);
    // And the .32 shape is gone. That reservation — every worker holding the
    // full per-visit cap — exceeded the budget on its own AT THE CAP OF THE
    // TIME (2,000): 7 x 2,000 = 14,000 against 12,000. The cap is 600 now
    // (.51: one board holding 2,002 postings cost 206MB), so the historical
    // arithmetic is stated with its own number rather than recomputed from a
    // constant that has since moved.
    // Stated with the numbers OF THE TIME rather than recomputed from live
    // constants: 8 workers each reserving the 2,000-posting cap was 14,000
    // against a 12,000 budget. Concurrency happens to be 8 again after .60,
    // but the literal stays, because this assertion records history and must
    // not start passing or failing on a constant that moves.
    expect((8 - 1) * 2_000).toBeGreaterThanOrEqual(budget);
  });

  it("hot phase keeps the worst case: two giants reserve the cap each", () => {
    expect(num("HOT_CONCURRENCY") * num("MAX_POSTINGS_PER_VISIT")).toBeLessThan(num("SLICE_POSTING_BUDGET"));
  });
});
