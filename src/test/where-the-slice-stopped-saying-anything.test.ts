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
    const loop = CODE.indexOf('breadcrumb(client, "loop"');
    const done = CODE.indexOf('breadcrumb(client, "loop-done"');
    expect(start, "before the loop").toBeGreaterThan(0);
    expect(loop, "inside the loop").toBeGreaterThan(start);
    expect(done, "after the loop").toBeGreaterThan(loop);
    // The whole point: the last mark must be written BEFORE the terminal stamp,
    // or a dying slice still records nothing.
    expect(done).toBeLessThan(CODE.indexOf("await stampSliceWork(client, inHotPhase, sliceWallStart);"));
  });

  it("the in-loop mark is periodic, not per board", () => {
    // .42 added elapsedMs — the quantity that turned out to matter.
    expect(CODE).toMatch(/if \(\+\+boardsDone % 24 === 0\) await breadcrumb\(client, "loop", \{ boardsDone, fetched: fetchedInSlice, inFlight: inFlightReserve, elapsedMs: Date\.now\(\) - sliceWallStart \}\);/);
  });

  it("carries the hop and the heap, and reaches the status action", () => {
    expect(CODE).toMatch(/v: \{ at: new Date\(\)\.toISOString\(\), hop: currentHop, seq: \+\+traceSeq, mark, \.\.\.memStamp\(\)/);
    expect(CODE).toMatch(/sliceTrace: \(\(traceRow as \{ data\?: \{ v\?: unknown \} \} \| null\)\?\.data\?\.v \?\? null\)/);
  });
});
