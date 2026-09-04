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
    // .47 added the ramped board budget as a fourth parameter; the hop is
    // still captured first, which is what this guard is about.
    expect(CODE).toMatch(/chainHop = 0, boardBudget = MIN_BOARDS_PER_SLICE\): Promise<\{ ok: boolean; detail: string \}> \{\s*currentHop = chainHop;/);
  });

  it("heap and rss are read from the runtime, in megabytes", () => {
    // .37: this runtime has no Deno.memoryUsage, and calling it in the payload
    // froze the row for three hours. The probe is total now and the numbers are
    // optional (a-statistic-nobody-reads-took-the-rotation-down.test.ts).
    expect(CODE).toMatch(/out\.heapMb = Math\.round\(u\.heapUsed \/ 1048576\);/);
    expect(CODE).toMatch(/out\.rssMb = Math\.round\(u\.rss \/ 1048576\);/);
  });

  it("BOTH slice_stats writers stamp hop, heap and rss", () => {
    expect(CODE, "liveness stamp").toMatch(/works: \(Number\(pv\.works\) \|\| 0\) \+ 1,\s*workHop: currentHop,\s*\.\.\.\(mem\.heapMb !== undefined \? \{ workHeapMb: mem\.heapMb \} : \{\}\),/);
    expect(CODE, "terminal write").toMatch(/slices: \(Number\(pv\.slices\) \|\| 0\) \+ 1,\s*hop: currentHop,\s*\.\.\.\(mem\.heapMb !== undefined \? \{ heapMb: mem\.heapMb \} : \{\}\),/);
  });
});
