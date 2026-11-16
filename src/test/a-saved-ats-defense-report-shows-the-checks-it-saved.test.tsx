/**
 * A SAVED ATS DEFENSE REPORT SHOWS THE CHECKS IT SAVED (RC-S12-031).
 *
 * The ATS Parse Simulation ran only on the résumé the viewing tab held, so a
 * buyer who opened the report from the mail, on another device or after the
 * tab closed got the report without it. generate-ats-defense now saves the
 * checks with the report (never the résumé), and the report shows them when
 * the tab holds no résumé. A copy saved before that says the checks were not
 * kept, rather than leaving a hole where the section was.
 *
 * The real report component, rendered on its own.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ATSDefenseResults, type ATSDefenseData } from "@/components/ATSDefenseResults";
import pastBuyers from "../i18n/shards/past-buyers/en.json";

afterEach(() => cleanup());

const breakdown = { keywordDensity: 50, formatCompliance: 60, sectionStructure: 70, parseability: 80 };
const REPORT: ATSDefenseData = {
  beforeScore: { overall: 58, breakdown },
  afterScore: { overall: 81, breakdown },
  compatibilityAudit: { overallGrade: "B", criticalIssues: [], parsingProblems: [], atsSystemsCompatibility: [] },
  keywordOptimization: {
    primaryRole: { roleName: "Data Analyst", currentKeywordMatch: 40, targetKeywordMatch: 80, missingKeywords: [], keywordsToAdd: [] },
    secondaryRoles: [],
  },
  formatRestructuring: {
    currentFormatIssues: [], recommendedFormat: "Reverse chronological", sectionOrder: [], fontRecommendation: "", marginRecommendation: "",
    elementsToRemove: [], elementsToKeep: [],
  },
  industryKeywordBank: { industry: "Analytics", hardSkills: [], softSkills: [], certifications: [], tools: [], actionVerbs: [] },
  linkedInAlignment: { headlineRecommendation: "", summaryKeyPoints: [], skillsToFeature: [], keywordConsistency: "" },
  optimizedResumeSections: { professionalSummary: "", coreCompetencies: [], experienceBullets: [] },
  actionPlan: [],
  redFlagsSummary: [],
};
const SAVED = {
  overallConfidence: 67,
  checks: [
    { id: "sections", label: "Section Headers", status: "pass", detail: "All 4 standard section headers detected." },
    { id: "dates", label: "Date Parsing", status: "warning", detail: "Only 1 date pattern found." },
  ],
};

describe("the ATS Parse Simulation on a saved report", () => {
  it("with no résumé in the tab, the checks saved with the report are shown", () => {
    render(<ATSDefenseResults data={{ ...REPORT, parseSimulation: SAVED } as ATSDefenseData} />);
    const saved = document.querySelector("[data-rb-saved-parse-simulation]");
    expect(saved, "the saved checks were not shown").not.toBeNull();
    expect(saved!.textContent).toContain("Section Headers");
    expect(saved!.textContent).toContain("Only 1 date pattern found.");
    expect(saved!.textContent).toContain("67%");
    expect(screen.getByText(pastBuyers.pastBuyers.parseSimulationSaved)).toBeInTheDocument();
  });

  it("a copy saved before the checks were kept says so, instead of leaving the section out", () => {
    render(<ATSDefenseResults data={REPORT} />);
    expect(document.querySelector("[data-rb-saved-parse-simulation]")).toBeNull();
    expect(screen.getByText(pastBuyers.pastBuyers.parseSimulationMissing)).toBeInTheDocument();
  });

  it("a saved set that is not a set of checks is not drawn", () => {
    render(<ATSDefenseResults data={{ ...REPORT, parseSimulation: { overallConfidence: 50, checks: [{ label: 1 }] } } as unknown as ATSDefenseData} />);
    expect(document.querySelector("[data-rb-saved-parse-simulation]")).toBeNull();
    expect(screen.getByText(pastBuyers.pastBuyers.parseSimulationMissing)).toBeInTheDocument();
  });

  it("with the résumé in the tab, the checks run live on it and the saved set is not shown", () => {
    const resume = "Priya Raman | priya@example.com | 555-010-0142\nEXPERIENCE\nData Analyst, Jan 2020 - Present\nEDUCATION\nBSc, 2019\nSKILLS\nSQL";
    render(<ATSDefenseResults data={{ ...REPORT, parseSimulation: SAVED } as ATSDefenseData} resumeText={resume} />);
    expect(document.querySelector("[data-rb-saved-parse-simulation]")).toBeNull();
    expect(screen.queryByText(pastBuyers.pastBuyers.parseSimulationMissing)).toBeNull();
  });
});
