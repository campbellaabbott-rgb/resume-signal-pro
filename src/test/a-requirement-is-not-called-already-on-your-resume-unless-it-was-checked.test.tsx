/**
 * A REQUIREMENT IS NOT CALLED ALREADY ON YOUR RÉSUMÉ UNLESS IT WAS CHECKED
 * (S13-051, bug reconcile of 2026-11-19, lane paid-results; owner decision 12
 * of 2026-11-21).
 *
 * WHAT WAS WRONG. The $5 Full Analysis printed a green list headed "From the
 * posting, already on your résumé": the posting's requirements less those the
 * analysis listed as missing. Nothing reads the résumé there, and the
 * schema asks for up to 12 requirements but at most 8 missing terms, so the
 * green list claimed requirements the résumé does not have:
 *   (A) 12 requirements, 8 listed as missing, for a résumé that names only
 *       Python and AWS: CI/CD pipelines and PostgreSQL were "already on your
 *       résumé";
 *   (B) "Container orchestration" and "Infrastructure as code" were green
 *       directly above "Kubernetes" and "Terraform" in amber.
 * A buyer told they already have what the job asks for does not add it.
 *
 * NOW the same list is headed "Also asked for in the posting", in neutral
 * chips, in all nine languages: it says what the posting asks for, which is
 * all the subtraction knows. No requirement is shown in green.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const json = (rel: string) => JSON.parse(readFileSync(resolve(__dirname, "..", rel), "utf8")) as Record<string, Record<string, unknown>>;
const mainLocale = (l: string) => json(`i18n/locales/${l}.json`);
const paidShard = (l: string) => json(`i18n/shards/paid/${l}.json`);
/** What the old heading said in each language: the claim no list may make. */
const claimIn = (l: string) => String((mainLocale(l).analysisResults as Record<string, unknown>).jdKeywordsOnResume);

const report = (extractedKeywords: string[], missingKeywords: string[]): AnalysisData => ({
  industry: "technology",
  experienceLevel: "mid",
  hasJobDescription: true,
  atsScore: { score: 58, breakdown: { jobTitleMatch: 9, skillsMatch: 14, actionVerbUsage: 10, keywordCoverage: 11, formattingScore: 14 }, improvements: [] },
  jobDescriptionAlignment: {
    matchScore: 48,
    extractedKeywords,
    missingKeywords,
    suggestedEdits: [],
    roleMatchAnalysis: "Partly aligned",
    gapAnalysis: "Several platform tools are not named",
  },
});

// (A) the schema's caps: 12 requirements, 8 missing; the résumé names only Python and AWS.
const CASE_A = report(
  ["Python", "AWS", "CI/CD pipelines", "PostgreSQL", "Kubernetes", "Terraform", "Go", "React", "GraphQL", "Kafka", "Docker", "Redis"],
  ["Kubernetes", "Terraform", "Go", "React", "GraphQL", "Kafka", "Docker", "Redis"],
);
// (B) the paraphrase: the requirement and the missing term share no word.
const CASE_B = report(["Container orchestration", "Infrastructure as code", "Python"], ["Kubernetes", "Terraform"]);

const greenChips = (root: Element) =>
  [...root.querySelectorAll("span")].filter((s) => /\btext-success\b/.test(s.className) && /\bbg-success\//.test(s.className)).map((s) => s.textContent?.trim());

describe("the posting's other requirements", () => {
  for (const [name, data, others] of [
    ["A (12 requirements, 8 missing)", CASE_A, ["Python", "AWS", "CI/CD pipelines", "PostgreSQL"]],
    ["B (a paraphrase of what is missing)", CASE_B, ["Container orchestration", "Infrastructure as code", "Python"]],
  ] as const) {
    it(`case ${name}: no requirement is called already on the résumé, and none is green`, () => {
      const { container } = render(<AnalysisResults data={data} />);
      const text = container.textContent ?? "";
      expect(text, "the report still says a requirement it never checked is on the résumé").not.toContain(claimIn("en"));
      expect(text).not.toMatch(/already on your r[eé]sum[eé]/i);
      const required = data.jobDescriptionAlignment!.extractedKeywords;
      expect(greenChips(container).filter((c) => required.includes(c ?? "")), "a requirement is shown in green as found").toEqual([]);
    });

    it(`case ${name}: the list is still shown, headed as what the posting also asks for`, () => {
      const { container } = render(<AnalysisResults data={data} />);
      const list = container.querySelector("[data-testid=posting-also-asks]");
      expect(list, "the posting's other requirements are no longer shown").not.toBeNull();
      expect(list!.textContent).toContain(String(paidShard("en").paidAnalysis.alsoAskedInPosting));
      const chips = [...list!.querySelectorAll("span.rounded-lg")].map((s) => s.textContent?.trim());
      expect(chips).toEqual([...others]);
    });
  }
});

describe("in every language", () => {
  for (const l of LOCALES) {
    it(`${l}: the heading says what the posting asks for, never that the résumé has it`, async () => {
      i18n.addResourceBundle(l, "translation", mainLocale(l), true, true);
      i18n.addResourceBundle(l, "translation", paidShard(l), true, true);
      await i18n.changeLanguage(l);
      const { container } = render(<AnalysisResults data={CASE_B} />);
      const text = container.textContent ?? "";
      expect(text, `${l} still prints the old claim`).not.toContain(claimIn(l));
      const heading = String(paidShard(l).paidAnalysis.alsoAskedInPosting);
      expect(heading.trim().length).toBeGreaterThan(0);
      expect(text).toContain(heading);
      if (l !== "en" && l !== "en-GB") expect(heading, `${l} is not translated`).not.toBe(String(paidShard("en").paidAnalysis.alsoAskedInPosting));
    });
  }
});
