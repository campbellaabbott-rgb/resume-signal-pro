import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A SLICE WITH NO CLOCK.
 *
 * Four fixes were aimed at slices dying on WORKER_RESOURCE_LIMIT before this
 * one. .40 finally measured instead of guessing, and .41 read the measurement
 * wrong: heap was 200MB at the moment of death, so heap looked like the cause,
 * and it was not. On .41 slices went on dying at heap 70 and 132 — below the
 * 150MB bound, which never fired, and far below the ~256MB ceiling.
 *
 * What separates the slices is DURATION. Every slice that ever wrote its
 * terminal stamp finished inside 128 seconds — 85.9, 93.3, 97.0, 102.8, 108.5,
 * 109.5, 115.0, 127.8 — and the one recorded death ran 158.3. The isolate has a
 * wall-clock ceiling and the slice had no clock at all: the only time bound
 * anywhere in the loop was FETCH_TIMEOUT_MS, on one fetch.
 *
 * The stop must leave room for what happens AFTER it: a board already in
 * flight can add a whole FETCH_TIMEOUT_MS, and then the stamps and the chain
 * kick still have to run. A slice that dies loses its work and stops the
 * chain; a slice that stops early defers a few boards and keeps the rotation
 * alive, which is the whole trade.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const num = (name: string) => Number(CODE.match(new RegExp(`const ${name} = ([0-9_]+)`))![1].replace(/_/g, ""));

describe("a slice with no clock", () => {
  it("stops taking new boards on elapsed wall time", () => {
    expect(CODE).toMatch(/if \(Date\.now\(\) - sliceWallStart >= SLICE_WALL_BUDGET_MS\) \{\s*wallStopped = true;\s*budgetSkipped\.push\(s\.token\);\s*continue;\s*\}/);
    const stop = CODE.indexOf("Date.now() - sliceWallStart >= SLICE_WALL_BUDGET_MS");
    expect(stop, "before the fetch it prevents").toBeLessThan(CODE.indexOf("r = await fetchBoard(s,"));
    expect(stop, "after the dormancy skip, like the other bounds").toBeGreaterThan(CODE.indexOf("if (skipTokens.has(s.token)) continue;"));
  });

  it("the budget leaves room for an in-flight fetch AND the stamps that follow", () => {
    const budget = num("SLICE_WALL_BUDGET_MS");
    const fetchTimeout = num("FETCH_TIMEOUT_MS");
    // The shortest slice that ever died was 158.3s; the longest that survived
    // was 127.8s. Stopping at `budget` lands the slice near budget+fetchTimeout,
    // which must sit inside the surviving range with room for the terminal
    // write (SLICE_STATS_WRITE_MS) and the chain kick.
    // REVERTED 2026-09-05 on the product owner's call. Freshness went 403 ->
    // 2,366 minutes across a day in which this machinery made the rotation
    // steadily more correct and steadily slower. The measurements below stay
    // written down because they were real; the constants went back to the
    // values that held freshness near the promise, and these bounds are
    // backstops now rather than active throttles.
    // The longest slice that ever SURVIVED was 127.8s; the wall budget is a
    // backstop against a hung slice, so it need only leave room for the
    // terminal write, not sit inside the survivor range.
    expect(budget + fetchTimeout + num("SLICE_STATS_WRITE_MS")).toBeLessThan(180_000);
    expect(budget, "and not so small that a slice does no useful work").toBeGreaterThanOrEqual(60_000);
  });

  it("a wall stop is a DEFERRAL, never a failure", () => {
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
    expect(CODE).toMatch(/!budgetSkippedSet\.has\(tk\)/);
  });

  it("elapsed time rides the breadcrumbs and the stop rides the status row", () => {
    // .54: the periodic mark became a per-board pair. "Always 8" was the
    // reading that hid which board the slice died on
    // (where-the-slice-stopped-saying-anything.test.ts).
    expect(CODE).toMatch(/breadcrumb\(client, "board-fetched", \{ boardsDone, token: s\.token, got: r \? r\.jobs\.length : 0, fetched: fetchedInSlice, inFlight: inFlightReserve, elapsedMs: Date\.now\(\) - sliceWallStart \}\)/);
    expect(CODE).toMatch(/wallStopped, sizeStopped, elapsedMs: Date\.now\(\) - sliceWallStart \}\)/);
    expect(CODE).toMatch(/wallStopped: sliceBudgetNote\.wallStopped,/);
  });

  it("is capped at a size the breadcrumbs show it reaches", () => {
    // .43. Not a theory about the cause — an observation about what survives.
    // .47: the cap is no longer a constant — it rides the chain and ramps
    // (a-cap-that-finds-its-own-ceiling.test.ts), so the stop reads the budget
    // this hop was handed.
    expect(CODE).toMatch(/if \(boardsDone >= boardBudget\) \{\s*sizeStopped = true;\s*budgetSkipped\.push\(s\.token\);\s*continue;\s*\}/);
    // Floor and ceiling are equal after the revert: the ramp is neutralised
    // and a slice composes its full COLD_SLICE again.
    expect(num("MIN_BOARDS_PER_SLICE")).toBe(num("MAX_BOARDS_PER_SLICE"));
    expect(CODE).toMatch(/sizeStopped: sliceBudgetNote\.sizeStopped,/);
    // Resolution had to improve too: one mark then silence located the death
    // only to within a 24-board window.
    // .54: per-board marks replaced the every-eighth one — "always 8" was the
    // reading that hid which board the slice died on, because 8 is the budget.
    expect(CODE).toMatch(/\+\+boardsDone;\s*await breadcrumb\(client, "board-fetched"/);
  });

  it("the heap bound stays, and is honest about what it is", () => {
    // Kept because it is a real secondary ceiling, not because it explained
    // anything — it never fired on the slices it was shipped for.
    expect(CODE).toMatch(/heapNow >= HEAP_SOFT_LIMIT_MB/);
    expect(RAW).toMatch(/it was not the cause/);
  });
});
