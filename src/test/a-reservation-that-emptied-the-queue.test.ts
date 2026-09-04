import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  it("defers only on LANDED postings, and never inside the reservation branch", () => {
    expect(CODE).toMatch(/if \(fetchedInSlice >= SLICE_POSTING_BUDGET\) \{ budgetSkipped\.push\(s\.token\); continue; \}/);
    // .41 added a SECOND deferral, on heap — the quantity that actually runs
    // out (the-budget-counted-the-wrong-thing.test.ts). Both are deferrals of
    // a board never attempted; what must never happen is a deferral inside the
    // reservation branch, which is what emptied the queue in the first place.
    expect((CODE.match(/budgetSkipped\.push\(/g) ?? []).length, "two deferral sites: landed postings, and heap").toBe(2);
    expect(CODE).toMatch(/if \(heapNow !== undefined && heapNow >= HEAP_SOFT_LIMIT_MB\) \{\s*heapStopped = true;\s*budgetSkipped\.push\(s\.token\);\s*continue;\s*\}/);
    expect(CODE, "neither deferral may sit in the reservation branch").not.toMatch(/inFlightReserve >= SLICE_POSTING_BUDGET\) \{\s*budgetSkipped/);
  });

  it("retires the worker and returns the board when the reservation fills the budget", () => {
    const landed = CODE.indexOf("if (fetchedInSlice >= SLICE_POSTING_BUDGET) {");
    // .39: it YIELDS rather than exiting — `return` ended the worker for the
    // whole slice, ratcheting concurrency down to 1 in the tail of every cold
    // slice (four-ways-to-lose-a-board.test.ts). The board still goes back to
    // the head of the queue for whoever is still in flight.
    const retire = CODE.indexOf("if (fetchedInSlice + inFlightReserve >= SLICE_POSTING_BUDGET) {");
    expect(retire, "retire branch missing").toBeGreaterThan(0);
    expect(retire, "landed check first, so a board over budget is deferred, not bounced between workers").toBeGreaterThan(landed);
    expect(CODE, "a retired board must go back to the HEAD, or it waits behind the whole queue").toMatch(/queue\.unshift\(s\);\s*await new Promise\(\(r\) => setTimeout\(r, 250\)\);\s*continue;/);
    expect(CODE, "and the worker must NOT exit the slice").not.toMatch(/queue\.unshift\(s\); return;/);
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
    // And the .32 shape is gone: the old reservation DID exceed the budget.
    expect((concurrency - 1) * cap).toBeGreaterThanOrEqual(budget);
  });

  it("hot phase keeps the worst case: two giants reserve the cap each", () => {
    expect(num("HOT_CONCURRENCY") * num("MAX_POSTINGS_PER_VISIT")).toBeLessThan(num("SLICE_POSTING_BUDGET"));
  });
});
