/**
 * THE POSTING REQUIREMENTS SHOWN AS ON YOUR RÉSUMÉ LEAVE OUT WHAT IS MISSING
 * IN OTHER WORDS (RC-S13-051; bug round 2026-11-12).
 *
 * WHAT WAS WRONG. The report's green list "From the posting, already on your
 * résumé" is every requirement the posting names (extractedKeywords) less
 * those the analysis lists as missing (missingKeywords), and S13-051 compared
 * them only as written. The model words the two lists independently, so a
 * requirement it extracted as "Experience with OKRs and roadmaps" and listed
 * as missing as "OKRs" was printed in green directly above the same thing in
 * amber: the report told the buyer they had what it said they lacked.
 *
 * NOW a requirement is left out of the green list when it shares a word that
 * carries meaning (not "experience", "with", "skills", "years" and the like;
 * any case, a plural's s ignored) with anything listed as missing. Leaving a
 * requirement out of "already on your résumé" says less, never something
 * false. The model's own list of matched requirements (the plan's other half)
 * needs a schema change the caps guard pins, and is the integrator's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AnalysisResults, keywordsNotMissing, type AnalysisData } from "@/components/AnalysisResults";

afterEach(() => cleanup());

describe("keywordsNotMissing", () => {
  it("a requirement worded differently from the missing one it contains is not shown as on the résumé", () => {
    expect(keywordsNotMissing({ extractedKeywords: ["Experience with OKRs and roadmaps"], missingKeywords: ["OKRs"] })).toEqual([]);
    expect(keywordsNotMissing({ extractedKeywords: ["SQL"], missingKeywords: ["Advanced SQL databases"] })).toEqual([]);
    expect(keywordsNotMissing({ extractedKeywords: ["Stakeholder management"], missingKeywords: ["stakeholders"] })).toEqual([]);
  });

  it("requirements that share only words that carry no meaning stay", () => {
    expect(keywordsNotMissing({
      extractedKeywords: ["Experience with Python", "Strong communication skills", "5+ years of experience", "Kubernetes"],
      missingKeywords: ["Experience with Terraform", "Strong leadership skills"],
    })).toEqual(["Experience with Python", "Strong communication skills", "5+ years of experience", "Kubernetes"]);
  });

  it("the same as written is still left out, and nothing listed as missing leaves the list whole", () => {
    expect(keywordsNotMissing({ extractedKeywords: ["Go", " docker "], missingKeywords: ["DOCKER"] })).toEqual(["Go"]);
    expect(keywordsNotMissing({ extractedKeywords: ["Go", "Rust"], missingKeywords: [] })).toEqual(["Go", "Rust"]);
    expect(keywordsNotMissing(undefined)).toEqual([]);
  });
});

describe("the report", () => {
  it("prints no green chip for a requirement it lists as missing in other words", () => {
    const data = {
      industry: "technology",
      experienceLevel: "mid",
      hasJobDescription: true,
      atsScore: { score: 60, breakdown: { jobTitleMatch: 10, skillsMatch: 10, actionVerbUsage: 10, keywordCoverage: 15, formattingScore: 15 }, improvements: [] },
      optimizedBullets: [],
      actionVerbs: [],
      keywords: [],
      redFlags: [],
      jobDescriptionAlignment: {
        matchScore: 55,
        extractedKeywords: ["Experience with OKRs and roadmaps", "Python"],
        missingKeywords: ["OKRs"],
        suggestedEdits: [],
        roleMatchAnalysis: "Partial",
        gapAnalysis: "OKRs",
      },
    } as unknown as AnalysisData;
    const { container } = render(<AnalysisResults data={data} />);
    const section = container.querySelector("#jdalignment") ?? container;
    const chips = [...section.querySelectorAll("span")].map((s) => s.textContent);
    expect(chips, "the green list still claims what the amber list says is missing").not.toContain("Experience with OKRs and roadmaps");
    expect(chips).toContain("Python");
    expect(chips).toContain("OKRs");
  });
});
