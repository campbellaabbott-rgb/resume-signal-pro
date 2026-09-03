import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * WHERE A CHAIN DIES IS A NUMBER, NOT A GUESS.
 *
 * 2026-09-03: three WORKER_RESOURCE_LIMIT deaths at hops 6, 7 and 6, while
 * chains otherwise reach hop 9; the last died after a SMALL cold slice
 * (6,386 postings, 39s). Per-slice budgets cannot explain that; pressure
 * accumulating across hops on a reused isolate can — but that stays a
 * hypothesis until the slice row carries the hop and the heap. Both writers
 * stamp them; the hop is set at runRefresh ENTRY so a slice that dies before
 * its terminal write still leaves the liveness stamp with the right hop.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("where a chain dies is a number", () => {
  it("the hop is captured at runRefresh entry", () => {
    expect(CODE).toMatch(/let currentHop = 0;/);
    expect(CODE).toMatch(/chainHop = 0\): Promise<\{ ok: boolean; detail: string \}> \{\s*currentHop = chainHop;/);
  });

  it("heap and rss are read from the runtime, in megabytes", () => {
    expect(CODE).toMatch(/const heapMb = \(\) => Math\.round\(Deno\.memoryUsage\(\)\.heapUsed \/ 1048576\);/);
    expect(CODE).toMatch(/const rssMb = \(\) => Math\.round\(Deno\.memoryUsage\(\)\.rss \/ 1048576\);/);
  });

  it("BOTH slice_stats writers stamp hop, heap and rss", () => {
    expect(CODE, "liveness stamp").toMatch(/works: \(Number\(pv\.works\) \|\| 0\) \+ 1,\s*workHop: currentHop, workHeapMb: heapMb\(\), workRssMb: rssMb\(\),/);
    expect(CODE, "terminal write").toMatch(/slices: \(Number\(pv\.slices\) \|\| 0\) \+ 1,\s*hop: currentHop, heapMb: heapMb\(\), rssMb: rssMb\(\),/);
  });
});
