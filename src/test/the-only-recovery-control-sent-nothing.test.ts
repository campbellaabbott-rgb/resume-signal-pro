import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE ONLY RECOVERY CONTROL SENT NOTHING.
 *
 * A click-through of every control on the live board (2026-09-03) plus a
 * code audit of each one, three refuters per finding. Every control sent its
 * parameter — except these, pinned here.
 */
const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));

/** The dependency list of the fit-scoring effect, as names. */
const scoringEffectDeps = (): string[] => {
  const m = /const unscored = jobs\.filter[\s\S]*?\n {2}\}, \[([^\]]*)\]\);/.exec(JOBS);
  expect(m, "the scoring effect moved — re-point this helper").toBeTruthy();
  return m![1].split(",").map((s) => s.trim()).filter(Boolean);
};

describe("the only recovery control sent nothing", () => {
  it("Try again is a dependency of the scoring effect and keeps the scores it has", () => {
    expect(JOBS).toMatch(/const \[fitRetry, setFitRetry\] = useState\(0\);/);
    expect(JOBS).toMatch(/onClick=\{\(\) => \{ setFitFailedCount\(0\); setFitRetry\(\(n\) => n \+ 1\); \}\}/);
    // MEMBERSHIP, NOT THE WHOLE LIST. This pinned the dependency array by its
    // exact contents, so adding a fifth dependency (fitResumeGen, which is what
    // makes a replaced résumé re-score) failed a test about the retry button.
    // What this line is for is that `fitRetry` is IN the list.
    expect(scoringEffectDeps(), "a retry that nothing depends on sends no request").toContain("fitRetry");
    expect(JOBS, "a retry must not wipe successful scores").not.toMatch(/setFitFailedCount\(0\); setFits\(\{\}\);/);
  });

  it("Show those too relaxes whatever is hiding the unpriced rows", () => {
    expect(JOBS).toMatch(/if \(salaryFloor > 0 \|\| salaryCeiling > 0\) setIncludeUnstatedPay\(true\);\s*if \(payBasis\) setPayBasis\(""\);\s*if \(statedPayOnly\) setStatedPayOnly\(false\);/);
    expect(JOBS).not.toMatch(/if \(disclosure\.kind === "salary"\) setSalaryFloor\(0\);/);
  });

  it("Incl. unstated pay renders for a ceiling as well as a floor", () => {
    expect(JOBS).toMatch(/\{\(salaryFloor > 0 \|\| salaryCeiling > 0\) && \(\s*<label/);
  });

  it("the industry rail reads the filtered facet, so it survives other filters", () => {
    expect(JOBS).toMatch(/const railCounts = filteredCats \?\? data\?\.categories \?\? null;/);
    // .37: reading a MISSING count as zero deleted every category the server's
    // facet deadline never reached — see an-uncounted-industry-is-not-an-empty-one,
    // which owns the behaviour. Here, only that the old spelling stays dead.
    expect(JOBS).toMatch(/\.filter\(\(c\) => \(railCounts \? railCount\(c\) !== 0 : c !== "other"\)\)/);
    expect(JOBS).toMatch(/return \(railCount\(b\) \?\? -1\) - \(railCount\(a\) \?\? -1\);/);
    expect(JOBS).toMatch(/\{typeof n === "number" && <span className="opacity-70">\{fmtFacet\(n\)\}<\/span>\}/);
  });

  it("a parse rate limit is not reported as a bad file", () => {
    expect(JOBS).toMatch(/throw new Error\(status === 429 \? "rate_limited" : status === 422 \? "no_text" : "parse failed"\);/);
    expect(JOBS).toMatch(/reason === "rate_limited"\s*\? t\("jobsPage\.dropRateLimited"/);
    const en = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8"));
    expect(typeof en.jobsPage.dropRateLimited).toBe("string");
  });
});
