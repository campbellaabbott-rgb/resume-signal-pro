import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WHERE THE SLICE STOPPED SAYING ANYTHING.
 *
 * Three fixes have now been aimed at the chain dying with 546, and every one
 * of them was aimed at a guess, because the row that was supposed to explain
 * the death only lands if the slice SURVIVES. A slice that dies records
 * nothing, so silence has been the only evidence and every theory has fitted
 * it — including mine, twice.
 *
 * Measured 2026-09-04 18:16Z on .39: the cursor and the bootstrap stamp, both
 * written BEFORE the fetch loop, were two minutes old, while the terminal
 * stamp was 163 minutes old. That places the death inside the fetch loop and
 * says nothing about where in it, or at what cost.
 *
 * These breadcrumbs overwrite one row as the slice proceeds, so whatever the
 * row last says is how far the isolate got and what it was holding. The rules
 * that keep instrumentation from becoming the next outage are pinned here:
 * bounded, swallowed, and never called inside the payload of anything.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
// Prose reads RAW, code reads CODE. Asserting a comment against stripped
// source is this repo's oldest guard bug — seven occurrences, this one mine,
// written into a file whose subject is instrumentation discipline.

describe("where the slice stopped saying anything", () => {
  it("a breadcrumb can never break the thing it measures", () => {
    expect(CODE, "bounded, like the stamp writers").toMatch(/await Promise\.race\(\[write, new Promise<void>\(\(r\) => setTimeout\(r, 600\)\)\]\);/);
    expect(RAW, "and swallowed — a lost breadcrumb is survivable, a wedged rotation is not").toMatch(/\}\)\(\)\.catch\(\(\) => \{ \/\* never break the thing it measures \*\/ \}\);/);
    expect(CODE, "the memory probe is the total one, never a raw runtime call").not.toMatch(/Deno\.memoryUsage\(\)/);
  });

  it("marks the three points that bracket the fetch loop", () => {
    const start = CODE.indexOf('breadcrumb(client, "slice-start"');
    const loop = CODE.indexOf('breadcrumb(client, "board-fetched"');
    const done = CODE.indexOf('breadcrumb(client, "loop-done"');
    expect(start, "before the loop").toBeGreaterThan(0);
    expect(loop, "inside the loop").toBeGreaterThan(start);
    const stored = CODE.indexOf('breadcrumb(client, "board-stored"');
    expect(stored, "and a mark at the END of the board's own DB work").toBeGreaterThan(loop);
    expect(stored, "still before the loop exits").toBeLessThan(done);
    expect(done, "after the loop").toBeGreaterThan(loop);
    // The whole point: the last mark must be written BEFORE the terminal stamp,
    // or a dying slice still records nothing.
    expect(done).toBeLessThan(CODE.indexOf("await stampSliceWork(client, inHotPhase, sliceWallStart);"));
  });

  it("the marks are per board, and bracket its DB work", () => {
    // .54. Periodic marks reported that the slice always reached 8 boards and
    // never 16 — true, and useless, because 8 IS the budget. A pair per board
    // names which board, and whether it died fetching or storing: 760 lines of
    // existing-row paging, upserts and verification stamps run between them.
    expect(CODE).toMatch(/\+\+boardsDone;\s*await breadcrumb\(client, "board-fetched"/);
    expect(CODE).toMatch(/await breadcrumb\(client, "board-stored", \{ boardsDone, token: s\.token, rows: rows\.length, fetched: fetchedInSlice \}\);/);
    expect(CODE, "and the budget still bounds how many pairs a slice can write").toMatch(/if \(boardsDone >= boardBudget\)/);
  });

  it("carries the hop and the heap, and reaches the status action", () => {
    expect(CODE).toMatch(/v: \{ at: new Date\(\)\.toISOString\(\), hop: currentHop, seq: \+\+traceSeq, mark, \.\.\.memStamp\(\)/);
    expect(CODE).toMatch(/sliceTrace: \(\(traceRow as \{ data\?: \{ v\?: unknown \} \} \| null\)\?\.data\?\.v \?\? null\)/);
  });
});
