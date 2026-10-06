// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { constOf, runGate } from "./helpers/slice-worker";

/**
 * THE BUDGET COUNTED POSTINGS; THE ISOLATE RUNS OUT OF BYTES.
 *
 * Three fixes were aimed at slices dying on WORKER_RESOURCE_LIMIT before this
 * one, and every one was aimed at a theory, because a slice that dies records
 * nothing. .40's breadcrumbs measured it instead, three samples over two
 * slices:
 *
 *     24 boards    250 postings   heap 101MB   in flight 2500
 *     48 boards    540 postings   heap 200MB   in flight 4500
 *     72 boards   2316 postings   heap 196MB   in flight  500
 *
 * Heap tracks BOARDS PROCESSED, not postings — 540 postings sat in 200MB —
 * and it does not fall when the in-flight reservation drains to one small
 * board, so it is not the concurrent payloads either. Meanwhile the posting
 * budget could never fire: the slice that died at 200MB had spent 4.5% of it.
 *
 * The slice now stops on the quantity that actually runs out, and stops
 * CLEANLY — deferred boards are not failures, the stamps are written, the
 * chain continues. A slice that dies loses its work and stops the chain.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const num = (name: string) => Number(CODE.match(new RegExp(`const ${name} = ([0-9_]+)`))![1].replace(/_/g, ""));

describe("the budget counted the wrong thing", () => {
  it("the slice stops on heap, before starting a board", async () => {
    // .90 (n423): one start gate (start-gate.ts); the worker's turn is RUN, not spelled.
    const limit = constOf("HEAP_SOFT_LIMIT_MB");
    const board = { source: "lever", token: "a" };
    const full = await runGate({ queue: [board], heapMb: limit });
    expect(full.started, "no board is started at the limit, so its fetch never runs").toBeNull();
    expect(full.heapStopped).toBe(true);
    expect(full.deferred).toEqual(["a"]);
    expect((await runGate({ queue: [board], heapMb: limit - 1 })).started).toBe("a");
    expect((await runGate({ queue: [board], heapMb: undefined })).started, "an unmeasurable heap stops nothing").toBe("a");
    // After the dormancy skip — the same position the posting budget occupies.
    const dormant = await runGate({ queue: [board], heapMb: limit, dormant: ["a"] });
    expect(dormant.deferred, "a dormant board is skipped before the gate, not counted as deferred").toEqual([]);
    expect(dormant.heapStopped).toBe(false);
  });

  it("the limit leaves headroom for the boards already in flight", () => {
    // REVERTED 2026-09-05 on the product owner's call. Freshness went 403 ->
    // 2,366 minutes across a day in which this machinery made the rotation
    // steadily more correct and steadily slower. The measurements below stay
    // written down because they were real; the constants went back to the
    // values that held freshness near the promise, and these bounds are
    // backstops now rather than active throttles.
    const limit = num("HEAP_SOFT_LIMIT_MB");
    // Measured: 48 boards reached 200MB and the isolate died shortly after,
    // so the ceiling is near 256MB. The limit must sit far enough below it
    // that the in-flight boards can still land.
    expect(limit).toBeGreaterThanOrEqual(100);
    expect(limit, "a backstop below the ceiling, not a throttle").toBeLessThan(256);
  });

  it("a heap stop is a DEFERRAL, never a failure", () => {
    // budgetSkipped is excluded from the failure accounting, so a board the
    // slice never reached does not feed the retry lane or the prune.
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
    expect(CODE).toMatch(/!budgetSkippedSet\.has\(tk\)/);
  });

  it("the stop is reported where the outage was invisible", () => {
    expect(CODE).toMatch(/heapStopped, wallStopped, sizeStopped, boardBudget \};/);
    expect(CODE).toMatch(/heapStopped: sliceBudgetNote\.heapStopped,/);
    expect(CODE).toMatch(/breadcrumb\(client, "loop-done", \{ boardsDone, fetched: fetchedInSlice, skipped: budgetSkipped\.length, heapStopped, wallStopped/);
  });

  it("the posting budget stays — it bounds a different thing, and says so", async () => {
    const spent = await runGate({ queue: [{ source: "lever", token: "a" }], fetchedInSlice: constOf("SLICE_POSTING_BUDGET") });
    expect(spent.deferred).toEqual(["a"]);
    expect([spent.heapStopped, spent.wallStopped, spent.sizeStopped], "a landed-budget deferral raises no other stop").toEqual([false, false, false]);
    expect(num("SLICE_POSTING_BUDGET")).toBeGreaterThan(0);
  });
});
