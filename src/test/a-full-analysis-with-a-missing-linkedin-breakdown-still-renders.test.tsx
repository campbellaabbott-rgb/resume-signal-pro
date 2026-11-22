/**
 * A FULL ANALYSIS WITH A MISSING LINKEDIN BREAKDOWN STILL RENDERS (S11-068,
 * bug reconcile of 2026-11-19, lane paid-results).
 *
 * WHAT WAS WRONG. analyze-resume checks only that the LinkedIn section is an
 * object, and the report read Object.entries(profileScore.breakdown) with no
 * guard: a profile score that came back without its five parts threw, and
 * since the success page has no boundary of its own, the buyer of a $5 Full
 * Analysis got the app's crash page instead of everything else they paid for.
 * The résumé builder had the same shape: normalizeBuilderResume passed the
 * model's bullets through as they came, and the preview called b.trim() on a
 * null or a number among them.
 *
 * NOW the report draws the LinkedIn scores that are numbers (none when there
 * is no breakdown), every section of the report sits in its own error
 * boundary so one malformed section never blanks the rest, and the builder
 * keeps only the strings of its lists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// The boundary's crash report goes to the error log; here it goes nowhere.
vi.mock("@/lib/client-crash-report", () => ({ reportClientCrash: vi.fn() }));

import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { ResumePreview } from "@/components/builder/ResumePreview";
import { normalizeBuilderResume, type BuilderResume } from "@/types/resume-builder";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE: AnalysisData = {
  industry: "technology",
  experienceLevel: "mid",
  hasLinkedIn: true,
  atsScore: { score: 66, breakdown: { jobTitleMatch: 10, skillsMatch: 20, actionVerbUsage: 10, keywordCoverage: 12, formattingScore: 14 }, improvements: ["Name the tools you used"] },
  summaryRewrite: { professionalSummary: "Data analyst who turns messy sales data into weekly decisions.", linkedInHeadline: "Data Analyst | SQL | Tableau" },
  actionPlan: ["Add the SQL window functions you used to the first role"],
};

describe("a LinkedIn section the model returned incomplete", () => {
  it("a profile score with no breakdown renders the score and the rest of the report", () => {
    const data = { ...BASE, linkedInAnalysis: { profileScore: { overall: 64 } } } as unknown as AnalysisData;
    const { container } = render(<AnalysisResults data={data} />);
    const linkedin = container.querySelector("#linkedin");
    expect(linkedin, "the LinkedIn section is gone").not.toBeNull();
    expect(linkedin!.textContent).toContain("64");
    expect(container.querySelector("[data-testid=linkedin-breakdown]"), "an empty breakdown grid was drawn").toBeNull();
    expect(container.textContent).toContain("Data analyst who turns messy sales data into weekly decisions.");
    expect(container.textContent).toContain("Add the SQL window functions you used to the first role");
  });

  it("a breakdown with parts that are not numbers shows only the parts that are", () => {
    const data = { ...BASE, linkedInAnalysis: { profileScore: { overall: 70, breakdown: { headline: 15, about: null, skills: "12", experience: { score: 3 } } } } } as unknown as AnalysisData;
    const { container } = render(<AnalysisResults data={data} />);
    const grid = container.querySelector("[data-testid=linkedin-breakdown]");
    expect(grid).not.toBeNull();
    expect([...grid!.children].map((c) => c.firstElementChild?.textContent)).toEqual(["15/20"]);
    expect(container.textContent).toContain("Add the SQL window functions you used to the first role");
  });
});

describe("one malformed section", () => {
  it("is contained by its own boundary: the score, the summary and the plan still render", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // An object where the page expects a sentence: React refuses to draw it.
    const data = { ...BASE, optimizedBullets: [{ original: "Did reports", improved: { text: "Built weekly sales reports" }, reason: "Clearer" }] } as unknown as AnalysisData;
    const { container } = render(<AnalysisResults data={data} />);
    expect(container.querySelector("#bullets"), "the malformed section drew").toBeNull();
    expect(container.textContent).toContain("66");
    expect(container.textContent).toContain("Data analyst who turns messy sales data into weekly decisions.");
    expect(container.textContent).toContain("Add the SQL window functions you used to the first role");
  });
});

describe("the résumé builder", () => {
  it("keeps only the strings of a list the model wrote", () => {
    const resume = normalizeBuilderResume({
      contact: { fullName: "Ana Ruiz" },
      experience: [
        { company: "Northwind", title: "Data Analyst", bullets: [null, 42, "Cut the weekly report from 6 hours to 1", { text: "x" }] },
        { company: "Contoso", title: "Analyst", bullets: [null] },
      ],
      skills: ["SQL", null, 7, "Tableau"],
      certifications: [undefined, "PL-300"],
    });
    expect(resume.experience[0].bullets).toEqual(["Cut the weekly report from 6 hours to 1"]);
    expect(resume.experience[1].bullets).toEqual([""]);
    expect(resume.skills).toEqual(["SQL", "Tableau"]);
    expect(resume.certifications).toEqual(["PL-300"]);
  });

  it("the preview draws a normalised résumé the model returned with a null bullet", () => {
    const resume = normalizeBuilderResume({
      contact: { fullName: "Ana Ruiz" },
      experience: [{ company: "Northwind", title: "Data Analyst", bullets: [null, "Cut the weekly report from 6 hours to 1"] }],
      skills: ["SQL", null],
    });
    const { container } = render(<ResumePreview resume={resume} />);
    expect(container.textContent).toContain("Cut the weekly report from 6 hours to 1");
    expect(container.textContent).toContain("SQL");
  });

  it("the preview itself draws a saved résumé whose lists carry a null or a number", () => {
    const saved = {
      contact: { fullName: "Ana Ruiz", title: "", email: "", phone: "", location: "", linkedIn: "", website: "" },
      summary: "",
      experience: [{ id: "e1", company: "Northwind", title: "Data Analyst", location: "", startDate: "2021", endDate: "Present", bullets: [null, 3, "Owned the sales dashboard"] }],
      education: [],
      skills: [null, "SQL"],
      certifications: [5],
    } as unknown as BuilderResume;
    const { container } = render(<ResumePreview resume={saved} />);
    expect(container.textContent).toContain("Owned the sales dashboard");
    expect(container.textContent).toContain("SQL");
  });
});
