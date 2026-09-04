import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A STATISTIC NOBODY READS TOOK THE ROTATION DOWN.
 *
 * .36 added `Deno.memoryUsage()` to the payload of both slice_stats writers to
 * investigate 546 deaths. The Supabase edge runtime does not provide that API,
 * so every write threw while building its payload — inside the
 * `.catch(() => {})` each writer wraps around itself, written for a lost EMA
 * sample, not for a payload that can never succeed.
 *
 * MEASURED LIVE 2026-09-04: the row froze at 10:50:48Z, the deploy instant,
 * and was still frozen three hours later (`works` 2095, `slices` 4154) while
 * refresh_progress in the same function kept advancing and bootstrap slices
 * kept stamping 13:42:57Z. Thirty minutes in, shedSignal called the row stale
 * and floored the fleet at L1 — `drained: 10` on the live status — so every
 * cold slice dropped to 48 boards and freshness p50 climbed 403 -> 497.
 *
 * The row is a control input. Three rules now, pinned here:
 *   1. The memory probe is TOTAL: it answers {} for any runtime, never throws.
 *   2. Its fields are SPREAD into the payload, never called inside it, so an
 *      absent runtime API costs a field instead of the write.
 *   3. A stamp that fails is RECORDED and surfaced on status, because the
 *      thing that made this cost three hours was the silence, not the throw.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a statistic nobody reads took the rotation down", () => {
  it("the memory probe is total — feature-detected, wrapped, and never throwing", () => {
    expect(CODE).toMatch(/function memStamp\(\): \{ heapMb\?: number; rssMb\?: number \} \{\s*try \{/);
    expect(CODE).toMatch(/if \(typeof mu !== "function"\) return \{\};/);
    expect(CODE).toMatch(/\} catch \{ return \{\}; \}/);
    expect(CODE, "a raw runtime call in the payload is the whole bug").not.toMatch(/const heapMb = \(\) => Math\.round\(Deno\.memoryUsage\(\)/);
    expect(CODE, "every reachable memoryUsage call must be the guarded one").toMatch(/memoryUsage\?: \(\) => \{ heapUsed\?: number; rss\?: number \}/);
    expect((CODE.match(/Deno\.memoryUsage\(\)/g) ?? []).length).toBe(0);
  });

  it("both writers compute the probe BEFORE the payload and spread the result", () => {
    for (const w of ["stampSliceWork", "recordSliceStats"]) {
      const body = CODE.slice(CODE.indexOf(`async function ${w}(`), CODE.indexOf(`async function ${w}(`) + 1800);
      expect(body, `${w} must probe outside the write`).toMatch(/const mem = memStamp\(\);/);
      expect(body.indexOf("const mem = memStamp();"), `${w} must probe before the write starts`).toBeLessThan(body.indexOf("const write = (async () =>"));
      expect(body, `${w} must not call the probe inside the payload`).not.toMatch(/: memStamp\(\)/);
    }
    expect(CODE).toMatch(/\.\.\.\(mem\.heapMb !== undefined \? \{ workHeapMb: mem\.heapMb \} : \{\}\),/);
    expect(CODE).toMatch(/\.\.\.\(mem\.rssMb !== undefined \? \{ workRssMb: mem\.rssMb \} : \{\}\),/);
    expect(CODE).toMatch(/\.\.\.\(mem\.heapMb !== undefined \? \{ heapMb: mem\.heapMb \} : \{\}\),/);
    expect(CODE).toMatch(/\.\.\.\(mem\.rssMb !== undefined \? \{ rssMb: mem\.rssMb \} : \{\}\),/);
    expect(CODE, "the hop cannot throw and stays unconditional").toMatch(/workHop: currentHop,/);
  });

  it("a failed stamp is recorded, not swallowed, and reaches the status action", () => {
    expect(CODE).toMatch(/let sliceStampError: string \| null = null;/);
    expect(CODE).toMatch(/\}\)\(\)\.catch\(\(e\) => \{ sliceStampError = `work: \$\{String\(e\)\.slice\(0, 160\)\}`; \}\);/);
    expect(CODE).toMatch(/\}\)\(\)\.catch\(\(e\) => \{ sliceStampError = `slice: \$\{String\(e\)\.slice\(0, 160\)\}`; \}\);/);
    expect(CODE).toMatch(/stampError: sliceStampError,/);
    expect(CODE, "no writer may go back to swallowing its own failure").not.toMatch(/\}\)\(\)\.catch\(\(\) => \{ \}\);/);
  });
});
