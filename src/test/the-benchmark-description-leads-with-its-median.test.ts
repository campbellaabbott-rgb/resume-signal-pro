// @vitest-environment node
/**
 * THE BENCHMARK DESCRIPTION LEADS WITH ITS MEDIAN (SEO audit 2026-11-18,
 * GEO-8).
 *
 * /research/ats-score-benchmarks answers "what is a good ATS score?" with a
 * measured median, and its meta description, the sentence a results page or
 * an answer engine quotes, held no number at all. It now leads with the
 * median and the middle half the page prints, the scans they come from and
 * the day they were taken, under 160 characters; with no figures it keeps the
 * static sentence.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { codeOf } from "./helpers/strip-comments";

const S = seo as unknown as {
  benchmarkDescription?: (o: unknown, asOf?: unknown) => string;
  BENCHMARK_DESCRIPTION_FALLBACK?: string;
};
const OVERALL = { median: 55, p25: 45, p75: 58, n: 1190 };

describe("the benchmarks description", () => {
  it("leads with the median, the middle half, the scans and the day, under 160 characters", () => {
    expect(typeof S.benchmarkDescription).toBe("function");
    const d = S.benchmarkDescription!(OVERALL, "2026-11-06T04:00:00Z");
    expect(d.startsWith("Median ATS score 55 (middle half 45-58) across 1,190 real resume scans, as of 2026-11-06.")).toBe(true);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it("drops its closing clause rather than run past 160 characters", () => {
    const d = S.benchmarkDescription!({ median: 55, p25: 45, p75: 58, n: 123_456_789_012 }, "2026-11-06");
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toMatch(/^Median ATS score 55/);
  });

  it("with any figure missing, keeps the static sentence and states no number", () => {
    for (const o of [null, {}, { ...OVERALL, median: null }, { ...OVERALL, n: 0 }, { ...OVERALL, p75: "58" }]) {
      expect(S.benchmarkDescription!(o, "2026-11-06")).toBe(S.BENCHMARK_DESCRIPTION_FALLBACK);
    }
    expect(S.BENCHMARK_DESCRIPTION_FALLBACK).not.toMatch(/\d/);
  });

  it("is what the bake writes for the page, from the figures the page prints", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    const call = code.slice(code.indexOf('path: "/research/ats-score-benchmarks"'), code.indexOf('path: "/research/ats-score-benchmarks"') + 900);
    expect(call).toMatch(/description: benchmarkDescription\(o, ins\?\.as_of\),/);
    expect(code).toMatch(/const o = ins\?\.overall;/);
  });
});
