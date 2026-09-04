import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  it("the slice stops on heap, before starting a board", () => {
    expect(CODE).toMatch(/const heapNow = memStamp\(\)\.heapMb;\s*if \(heapNow !== undefined && heapNow >= HEAP_SOFT_LIMIT_MB\) \{\s*heapStopped = true;\s*budgetSkipped\.push\(s\.token\);\s*continue;\s*\}/);
    // Before the fetch it prevents, and after the dormancy skip — the same
    // position the posting budget occupies.
    const heap = CODE.indexOf("const heapNow = memStamp().heapMb;");
    expect(heap).toBeGreaterThan(CODE.indexOf("if (skipTokens.has(s.token)) continue;"));
    expect(heap).toBeLessThan(CODE.indexOf("r = await fetchBoard(s,"));
  });

  it("the limit leaves headroom for the boards already in flight", () => {
    const limit = num("HEAP_SOFT_LIMIT_MB");
    // Measured: 48 boards reached 200MB and the isolate died shortly after,
    // so the ceiling is near 256MB. The limit must sit far enough below it
    // that the in-flight boards can still land.
    expect(limit).toBeGreaterThanOrEqual(100);
    expect(limit).toBeLessThanOrEqual(180);
  });

  it("a heap stop is a DEFERRAL, never a failure", () => {
    // budgetSkipped is excluded from the failure accounting, so a board the
    // slice never reached does not feed the retry lane or the prune.
    expect(CODE).toMatch(/const budgetSkippedSet = new Set\(budgetSkipped\);/);
    expect(CODE).toMatch(/!budgetSkippedSet\.has\(tk\)/);
  });

  it("the stop is reported where the outage was invisible", () => {
    expect(CODE).toMatch(/heapStopped, wallStopped, sizeStopped \};/);
    expect(CODE).toMatch(/heapStopped: sliceBudgetNote\.heapStopped,/);
    expect(CODE).toMatch(/breadcrumb\(client, "loop-done", \{ boardsDone, fetched: fetchedInSlice, skipped: budgetSkipped\.length, heapStopped, wallStopped/);
  });

  it("the posting budget stays — it bounds a different thing, and says so", () => {
    expect(CODE).toMatch(/if \(fetchedInSlice >= SLICE_POSTING_BUDGET\) \{ budgetSkipped\.push\(s\.token\); continue; \}/);
    expect(num("SLICE_POSTING_BUDGET")).toBeGreaterThan(0);
  });
});
