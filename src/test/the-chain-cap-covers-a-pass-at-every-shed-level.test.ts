// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { constOf, INDEX_PATH, runLaneTakes } from "./helpers/slice-worker";

/**
 * S11-022: CHAIN_CAP assumed 10-board hot hops, but a hot hop takes
 * min(shed step, floor(HOT_POSTING_BUDGET / MAX_POSTINGS_PER_VISIT)) = 4
 * boards (3 at shed level 2). The cap, 176, was short of the 190 hops a pass
 * needs, so every chain stopped at cold slice 147 of 160, recorded chain_kick
 * 'continued', and idled five to seven minutes until the :x9 backup cron.
 * Live twice on 2026-10-11 (08:51Z and 09:44Z).
 *
 * The cap is evaluated from its shipped expression and checked against the
 * hops a pass takes at every shed level, using the hot step the shipped
 * lane-size block computes at that level.
 */
const RAW = readFileSync(INDEX_PATH, "utf8");

function shippedCap(): number {
  const names = ["HOT_SIZE", "HOT_SLICE", "COLD_SLICES_PER_PASS", "HOT_POSTING_BUDGET", "MAX_POSTINGS_PER_VISIT"];
  const floor = /^const HOT_STEP_FLOOR = (.+);$/m.exec(RAW)?.[1];
  const cap = /^const CHAIN_CAP = (.+?);/m.exec(RAW)?.[1];
  expect(cap, "const CHAIN_CAP not found at the top level of job-board/index.ts").toBeTruthy();
  const body = `${floor ? `const HOT_STEP_FLOOR = ${floor};` : ""} return ${cap};`;
  return new Function(...names, body)(...names.map(constOf)) as number;
}

describe("the chain cap covers a whole pass at every shed level (S11-022)", () => {
  for (const level of [0, 1, 2] as const) {
    it(`shed level ${level}`, () => {
      const step = runLaneTakes(level).effHotSlice;
      expect(step).toBeGreaterThan(0);
      const hops = Math.ceil(constOf("HOT_SIZE") / step) + constOf("COLD_SLICES_PER_PASS");
      expect(
        shippedCap(),
        `a pass at shed level ${level} takes ${hops} hops (${step}-board hot hops); a cap below that stops the chain short of the pass end`,
      ).toBeGreaterThanOrEqual(hops);
    });
  }

  it("is still a bound: no more than the slowest pass plus the stall headroom", () => {
    const slowest = Math.max(...([0, 1, 2] as const).map((l) => Math.ceil(constOf("HOT_SIZE") / runLaneTakes(l).effHotSlice))) + constOf("COLD_SLICES_PER_PASS");
    expect(shippedCap()).toBe(slowest + 4);
  });
});
