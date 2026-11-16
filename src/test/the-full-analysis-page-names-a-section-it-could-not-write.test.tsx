/**
 * THE FULL ANALYSIS PAGE NAMES A SECTION IT COULD NOT WRITE (S14X-041; bug
 * round 2026-11-12).
 *
 * WHAT WAS WRONG. The analysis is asked in parts, and a posting or LinkedIn
 * section whose call failed is left out while the rest is delivered. The page
 * then simply had no posting card: a buyer who paid for a comparison with a
 * posting was shown none, and not told why.
 *
 * NOW analyze-resume names each section it went out without (missingSections,
 * src/test/a-full-analysis-bought-with-a-posting-says-when-the-posting-section-is-missing.test.ts),
 * and the report says so at its top, in the overview the PDF captures
 * (data-testid sections-missing), in the reader's language. An analysis
 * stored before missingSections existed is read the same way when it says it
 * had a posting and has no posting section.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";

afterEach(() => cleanup());

const BASE: AnalysisData = {
  industry: "technology",
  experienceLevel: "senior",
  hasLinkedIn: false,
  atsScore: { score: 71, breakdown: { jobTitleMatch: 10, skillsMatch: 20, actionVerbUsage: 10, keywordCoverage: 15, formattingScore: 16 }, improvements: ["Lead with impact"] },
  optimizedBullets: [{ original: "Did work", improved: "Shipped work", reason: "Clearer" }],
  actionVerbs: [{ weak: "did", strong: "shipped" }],
  keywords: ["Kubernetes"],
  redFlags: [],
  actionPlan: ["Step one"],
} as AnalysisData;

const note = (data: Partial<AnalysisData> & Record<string, unknown>) => {
  const { container } = render(<AnalysisResults data={{ ...BASE, ...data } as AnalysisData} />);
  return container.querySelector("[data-testid='sections-missing']");
};
const words = (k: string) => i18n.t(`paidAnalysis.sectionsMissing.${k}`);

describe("a section the analysis went out without is named on the report", () => {
  it("the posting section: named, in the overview the PDF captures", () => {
    const el = note({ hasJobDescription: false, missingSections: ["jobDescription"] });
    expect(el, "the report says nothing about the posting comparison it does not have").toBeTruthy();
    expect(words("jobDescription")).not.toBe("paidAnalysis.sectionsMissing.jobDescription");
    expect(el?.textContent).toContain(words("jobDescription"));
    expect(el?.closest("#overview"), "the note is outside the overview, so the PDF leaves it out").toBeTruthy();
  });

  it("the LinkedIn section, and both", () => {
    expect(note({ missingSections: ["linkedIn"] })?.textContent).toContain(words("linkedIn"));
    cleanup();
    const both = note({ missingSections: ["jobDescription", "linkedIn"] });
    expect(both?.textContent).toContain(words("jobDescription"));
    expect(both?.textContent).toContain(words("linkedIn"));
  });

  it("an analysis stored before missingSections that had a posting and has no posting section", () => {
    expect(note({ hasJobDescription: true })?.textContent).toContain(words("jobDescription"));
  });

  it("a whole analysis, or one asked with no posting, names nothing", () => {
    expect(note({})).toBeNull();
    cleanup();
    expect(note({ hasJobDescription: false })).toBeNull();
    cleanup();
    expect(note({ missingSections: ["somethingElse"] })).toBeNull();
    cleanup();
    expect(note({
      hasJobDescription: true,
      jobDescriptionAlignment: { matchScore: 60, extractedKeywords: [], missingKeywords: [], suggestedEdits: [], roleMatchAnalysis: "ok", gapAnalysis: "ok" },
    })).toBeNull();
  });

  it("the words are in every language, and only English says them in English", () => {
    const shard = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/paid", `${l}.json`), "utf8")).paidAnalysis;
    const en = shard("en").sectionsMissing;
    expect(en?.jobDescription && en?.linkedIn).toBeTruthy();
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      for (const k of ["jobDescription", "linkedIn"]) {
        expect(shard(l).sectionsMissing?.[k], `${l}: ${k}`).toBeTruthy();
        expect(shard(l).sectionsMissing[k], `${l} says ${k} in English`).not.toBe(en[k]);
      }
    }
  });
});
