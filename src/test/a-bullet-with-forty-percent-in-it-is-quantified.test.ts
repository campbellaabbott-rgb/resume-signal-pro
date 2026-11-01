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
 *
 * Review fix (2026-11-01). A bare number of two or more digits ("Processed
 * 150 invoices", "Trained 60,000 educators") was not read at all, nor a
 * currency written after the amount ("52-68K€"), a verb-moved scale ("Saved
 * 50k") or a span glued to its unit ("7-10years"). A bare number now counts
 * unless it is a year, a date, a clock time, a label, a list of names, a
 * phone number, an address or a plan name. Re-measured: on the builder's 711
 * labelled sentences main 79 right, the branch 709, the fix 710; on the
 * reviewer's 2,853 real sentences main reads 128 as quantified, the branch
 * 1,554, the fix 1,751. Of the 31 main reads that the fix does not make,
 * every one is a name main misread ("401K plan", "100M instead of 10G",
 * "H-1B"); the reviewer's four main-right cases now pass.
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

describe("a bare number measures; a name with a number does not (review fix)", () => {
  // The reviewer's four main-right cases (review-S10-006/branch-worse.json), real text.
  const reviewer = [
    "Minimum of 7-10years quota carrying in enterprise software / SaaS",
    "1.48hours per week/ 48 giờ 1 tuần",
    "💰 Rémunération : 52-68K€ fixe + variable + intéressement",
    "💰 Rémunération : 46 à 58K€ bruts fixes (Paris) + variable + intéressement",
  ];
  for (const t of reviewer) it(`"${t}" is quantified`, () => expect(hasMetric(t)).toBe(true));
  const quantified: Array<[string, string]> = [
    ["Processed 150 invoices a week", "number"],
    ["Trained 60,000 educators across the state", "number"],
    ["You'd rather convert 40 warm executive relationships than cold-call 400 strangers.", "number"],
    ["Saved 50k annually by renegotiating contracts", "scale"],
    ["Grew ARR from 200K to 1.2M", "scale"],
  ];
  for (const [t, rule] of quantified) it(`"${t}" is quantified (${rule})`, () => expect(metricEvidence(t)?.rule).toBe(rule));
  const names = [
    "Parental leave and 401K plan",
    "Includes annualized bonus, 401k match, healthcare coverage",
    "Contributions to 401k",
    "Call (818) 717-1000 to apply",
    "Interviews on 16 November",
    "Shift starts at 16:30",
    "Located at 301 West State Street",
    "Holds Series 7 and 63 licences",
    "Compliant with 21 CFR Part 11",
    "Rule 144 letters",
    "Windows 10 rollout",
    "Grade 12 diploma",
    "106 not to discriminate",
    "WORKED AT 7514 S PADRE ISLAND DR",
  ];
  for (const t of names) it(`"${t}" is not quantified`, () => expect(metricEvidence(t)).toBeNull());
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
