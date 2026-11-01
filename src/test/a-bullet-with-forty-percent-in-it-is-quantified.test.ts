/**
 * A BULLET WITH "40%" IN IT IS QUANTIFIED (register S10-006).
 *
 * The free scan's quantification test wanted the unit pressed against the
 * digits and a word character after it, so "Grew revenue 40% in a year",
 * "Managed 15 employees", "Led a team of 12" and "Served 50+ clients" all
 * read as having no number. The best résumés got the worst advice: a low
 * quantification rate in the prompt, their strongest bullets listed as
 * "unquantified", and the "add numbers" quick win. Meanwhile "401k" and
 * "3M" read as metrics.
 *
 * Measured on 711 real posting sentences with a digit (corpus in
 * ~/.config/resumebooster/free-scan-wave-corpora/S10-006, 156 of them a
 * held-out check): main wrong on 632, the branch on 2 (both missed by main
 * too), and the branch never wrong where main was right. A slice of it is
 * the fixture below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasMetric, metricEvidence } from "../../supabase/functions/free-keyword-scan/bullet-metrics";
import slice from "./fixtures/free-scan-wave/s10-006-bullet-metrics.json";

describe("the audit's bullets carry their numbers", () => {
  const quantified = [
    "Grew revenue 40% in a year",
    "Cut ticket backlog by 30 % in one quarter",
    "Managed 15 employees across two sites",
    "Led a team of 12 engineers",
    "Served 50+ clients in the region",
    "Saved $250K in vendor spend",
    "Raised €1.2 million in grants",
    "Tripled pipeline (3x) in six months",
    "Answered 200 calls a day",
    "Ran a 12-person support desk",
    "Grew to 10k followers",
    "Lift up to 35 lbs.",
    "Four (4) years of experience in DoD programs",
  ];
  for (const t of quantified) it(`"${t}" is quantified`, () => expect(hasMetric(t)).toBe(true));
});

describe("a number that names something is not a measurement", () => {
  const names = [
    "Managed 401k enrolment for new starters",
    "Wrote the 3M Global Terms of Use",
    "Supported Office 365 rollout",
    "Tier 2 analysts escalated to me",
    "Served a Fortune 500 client",
    "Kept the plant ISO 9001 compliant",
    "Ran the 24/7 help desk",
    "Joined the company in 2019",
    "Attached a DD-214 Member-4 Form",
    "Possess a valid 5 driver's license",
    "Rolled out 5G sites",
    "Wrote the onboarding guide",
  ];
  for (const t of names) it(`"${t}" is not quantified`, () => expect(hasMetric(t), JSON.stringify(metricEvidence(t))).toBe(false));
});

describe("the corpus slice: real posting sentences, labelled by hand", () => {
  const cases = (slice as { cases: Array<{ text: string; metric: boolean; main: boolean }> }).cases;
  it("holds at least 100 cases, a third of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    expect(cases.filter((c) => c.main !== c.metric).length).toBeGreaterThanOrEqual(cases.length / 3);
  });
  for (const c of cases) {
    it(`${c.metric ? "quantified" : "not quantified"}: "${c.text.slice(0, 60)}…"`, () => {
      expect(hasMetric(c.text), JSON.stringify(metricEvidence(c.text))).toBe(c.metric);
    });
  }
});

describe("the scanner counts with the same rule", () => {
  const primary = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8");
  it("analyzeBullets reads hasMetric and the old pattern is gone", () => {
    expect(primary).toContain('import { hasMetric } from "./bullet-metrics.ts";');
    expect(primary).toMatch(/if \(hasMetric\(text\)\) \{\s*quantifiedCount\+\+;/);
    expect(primary).not.toMatch(/const QUANT_PATTERN\b/);
  });
});
