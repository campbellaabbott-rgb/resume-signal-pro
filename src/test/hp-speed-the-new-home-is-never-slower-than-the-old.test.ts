/**
 * THE NEW "/" IS NEVER SLOWER THAN THE OLD ONE (owner decision 2026-10-27,
 * README step 15).
 *
 * Step 15 had two speed targets written before anything was measured: a
 * first-load JavaScript cap for "/" and an LCP ceiling "at 375 throttled"
 * that named no network profile. Measured on the switch-over build, the first
 * failed by 9.5 kB on the shared job card, and the second passed or failed
 * for the old page and the new alike depending on the profile. The owner
 * shipped with today's JavaScript and replaced both with one rule: on the
 * Lighthouse mobile profile and on the unthrottled 4x-CPU profile, the new
 * "/" LCP is no worse than the old "/".
 *
 * The old build's measurement is the baseline, stored in the repo
 * (docs/homepage-pricing/speed-baseline.json), not only in ~/.config, with
 * the switch-over build measured beside it on the same machine on the same
 * day. scripts/home-speed-gate.mjs judges it, and a later re-measure (both
 * builds again, together) is judged by the same function.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { judge, median, tenths, runsFromProbe, GATED_PROFILES } from "../../scripts/home-speed-gate.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const BASELINE = JSON.parse(read("docs/homepage-pricing/speed-baseline.json"));

type Row = { profile: string; case: string; gated: boolean; oldMs: number; newMs: number; oldS: number; newS: number; pass: boolean };

describe("the stored baseline", () => {
  it("names its basis: the day, both commits, the profiles and three runs a case for each build", () => {
    expect(BASELINE.measured).toBe("2026-10-26");
    expect(BASELINE.decided).toBe("2026-10-27");
    expect(BASELINE.builds.old.commit).toBe("5c74e112");
    expect(BASELINE.builds.switchOver.commit).toBe("8d8113ed");
    expect(BASELINE.profiles.lighthouseMobile).toMatchObject({ gated: true, cpuThrottlingRate: 4, latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750 });
    expect(BASELINE.profiles.unthrottled4xCpu).toMatchObject({ gated: true, cpuThrottlingRate: 4, latencyMs: 0 });
    expect(BASELINE.profiles.desktop.gated).toBe(false);
    expect(GATED_PROFILES).toEqual(["lighthouseMobile", "unthrottled4xCpu"]);
    for (const p of GATED_PROFILES) {
      const cases = Object.entries(BASELINE.runs[p] as Record<string, Record<string, { lcpMs: number[] }>>);
      expect(cases.length, p).toBeGreaterThanOrEqual(2);
      for (const [c, builds] of cases) for (const b of ["old", "switchOver"]) expect(builds[b].lcpMs, `${p} ${c} ${b}`).toHaveLength(3);
    }
  });

  it("records the first-load JavaScript the owner shipped with, without gating it", () => {
    expect(BASELINE.firstLoadJs.gzipBytes.loadedOnceTheCardsRender.switchOver).toBe(349482);
    expect(BASELINE.firstLoadJs.gzipBytes.staticClosure.switchOver).toBe(287049);
  });
});

describe("the rule", () => {
  it("rounds a median to the tenth of a second Lighthouse prints", () => {
    expect(median([2344, 2216, 2236])).toBe(2236);
    expect(median([248, 228, 224, 230])).toBe(229);
    expect(tenths(2236)).toBe(2.2);
    expect(tenths(2250)).toBe(2.3);
    expect(tenths(244)).toBe(0.2);
  });

  it("holds today, as the owner read it: about 2.2 s against 2.2 s, and 0.2 s against 0.2 s", () => {
    const rows: Row[] = judge(BASELINE.runs);
    const gated = rows.filter((r) => r.gated);
    expect(gated.length).toBe(6);
    expect(gated.filter((r) => !r.pass)).toEqual([]);
    const first = rows.find((r) => r.profile === "lighthouseMobile" && r.case === "375x812 first visit")!;
    expect(first).toMatchObject({ oldMs: 2180, newMs: 2236, oldS: 2.2, newS: 2.2, pass: true });
    const fast = rows.find((r) => r.profile === "unthrottled4xCpu" && r.case === "375x812 first visit")!;
    expect(fast).toMatchObject({ oldMs: 244, newMs: 228, oldS: 0.2, newS: 0.2, pass: true });
    const desk = rows.find((r) => r.profile === "desktop" && r.case === "1280x800 first visit")!;
    expect(desk).toMatchObject({ gated: false, oldS: 0.5, newS: 0.1 });
  });

  it("fails a new build a tenth of a second slower on either gated profile", () => {
    const slower = structuredClone(BASELINE.runs);
    slower.lighthouseMobile["375x812 first visit"].switchOver.lcpMs = [2316, 2296, 2330];
    const rows: Row[] = judge(slower);
    expect(rows.filter((r) => r.gated && !r.pass).map((r) => `${r.profile} ${r.case}`)).toEqual(["lighthouseMobile 375x812 first visit"]);
    const fast = structuredClone(BASELINE.runs);
    fast.unthrottled4xCpu["375x812 consent chosen"].switchOver.lcpMs = [300, 310, 290];
    expect(judge(fast).filter((r: Row) => r.gated && !r.pass).map((r: Row) => r.case)).toEqual(["375x812 consent chosen"]);
  });

  it("refuses a gated case that one build did not measure", () => {
    const partial = structuredClone(BASELINE.runs);
    delete partial.unthrottled4xCpu["375x812 first visit"].switchOver;
    expect(() => judge(partial)).toThrow(/375x812 first visit/);
  });

  it("reads the probe's own output lines, so a re-measure is judged by the same function", () => {
    const probe = [
      '{"cfg":"phone4x-slow4g","run":1,"lcpMs":2200}',
      '{"cfg":"phone4x-slow4g","run":2,"lcpMs":2210}',
      '{"cfg":"phone4x+consent","run":1,"lcpMs":215}',
      '{"cfg":"desktop1280","run":1,"lcpMs":120}',
      '{"answeredWrites":0}',
    ].join("\n");
    expect(runsFromProbe(probe)).toEqual({
      lighthouseMobile: { "375x812 first visit": [2200, 2210] },
      unthrottled4xCpu: { "375x812 consent chosen": [215] },
      desktop: { "1280x800 first visit": [120] },
    });
  });
});

describe("where the gate is written", () => {
  const readme = read("docs/homepage-pricing/README.md");
  const step15 = readme.slice(readme.indexOf("### 15. Before and after"), readme.indexOf("## Appendix A."));

  it("step 15 states the never-slower rule, its baseline, its judge and the owner's Search Console read", () => {
    expect(step15.length).toBeGreaterThan(500);
    expect(step15).toMatch(/never slower/i);
    expect(step15).toContain("docs/homepage-pricing/speed-baseline.json");
    expect(step15).toContain("scripts/home-speed-gate.mjs");
    expect(step15).toMatch(/Search Console/);
    expect(step15).toMatch(/Core Web Vitals/);
    expect(step15).toMatch(/28 days/);
  });

  it("step 15 no longer gates on the retired JavaScript cap or the profile-less LCP ceiling", () => {
    expect(step15).not.toMatch(/340\s?kB gzip or less/);
    expect(step15).not.toMatch(/1\.2\s?s or\s+less/);
  });

  it("section 99 says where the speed gate is judged", () => {
    const s99 = read("scripts/verify-deploy.d/99-home-pricing.sh");
    expect(s99).toContain("docs/homepage-pricing/speed-baseline.json");
    expect(s99).toContain("scripts/home-speed-gate.mjs");
  });
});
