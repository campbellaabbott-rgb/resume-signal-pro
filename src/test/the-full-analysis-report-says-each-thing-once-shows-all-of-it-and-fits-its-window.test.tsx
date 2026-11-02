/**
 * THE FULL ANALYSIS REPORT SAYS EACH THING ONCE, SHOWS ALL OF IT, AND FITS
 * ITS WINDOW (S13-021, S13-051, S13-053, S13-054, S13-055, S13-123).
 *
 * The $5 report (src/components/AnalysisResults.tsx), rendered:
 *   - S13-021: the Jump to Section panel was forced open from 768 px and
 *     covered the right of the max-w-4xl report up to about 1,300 px. It is
 *     now open by itself only at 2xl, behind its toggle below that, and never
 *     taller than the window.
 *   - S13-051: the posting's requirements showed in green as found directly
 *     above the same terms in amber as missing. Green is now the posting's
 *     requirements less the missing ones.
 *   - S13-053: improvements, suggestions, issues and recommendations past the
 *     first two or three were cut from the page and so from its PDF.
 *   - S13-054: a score of 72 showed as "Resume Strength 72" and "ATS
 *     Compatibility 72", with "Above average for your industry" that nothing
 *     measures, and "Keywords Added" for keywords only suggested.
 *   - S13-055: the five LinkedIn scores sat in five fixed columns at 375 px.
 *   - S13-123: the report's last line sent the reader to "the share link
 *     above", which the page did not show.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import en from "../i18n/locales/en.json";
import { AnalysisResults, keywordsNotMissing, type AnalysisData } from "@/components/AnalysisResults";

afterEach(cleanup);

const BASE: AnalysisData = {
  industry: "technology",
  experienceLevel: "senior",
  optimizedBullets: [{ original: "Did work", improved: "Shipped work", explanation: "Clearer" }] as unknown as AnalysisData["optimizedBullets"],
  actionVerbs: [{ weak: "did", strong: "shipped", context: "x" }] as unknown as AnalysisData["actionVerbs"],
  keywords: ["Kubernetes", "Terraform"] as unknown as AnalysisData["keywords"],
  redFlags: ["A gap"] as unknown as AnalysisData["redFlags"],
  actionPlan: ["Step one"],
};

const atsScore = (score: number, improvements: string[]) => ({
  score,
  breakdown: { jobTitleMatch: 10, skillsMatch: 20, actionVerbUsage: 10, keywordCoverage: 15, formattingScore: 17 },
  improvements,
});

describe("S13-054: one score, and no claim nothing measures", () => {
  it("a 72 is shown once, with no industry comparison", () => {
    const { container } = render(<AnalysisResults data={{ ...BASE, atsScore: atsScore(72, ["One"]) }} />);
    expect(screen.queryByText(i18n.t("analysisResults.resumeStrength"))).toBeNull();
    expect(screen.getByText(i18n.t("analysisResults.atsCompatibilityScore"))).toBeTruthy();
    expect(container.textContent).not.toContain(i18n.t("analysisResults.aboveAverage"));
    const shown = [...container.querySelectorAll("span")].filter((e) => e.textContent?.trim() === "72");
    expect(shown.length, "72 printed as more than one score").toBe(1);
  });

  it("a high proxy score with no ATS score makes no industry claim either", () => {
    const many = { ...BASE, optimizedBullets: Array(6).fill(BASE.optimizedBullets![0]), actionVerbs: Array(5).fill(BASE.actionVerbs![0]), keywords: Array(10).fill("k") as unknown as AnalysisData["keywords"], redFlags: [] as unknown as AnalysisData["redFlags"], summaryRewrite: { professionalSummary: "x", linkedInHeadline: "y" }, skillsGap: { missingTechnical: [], missingSoft: [], recommendations: "" } } as AnalysisData;
    const { container } = render(<AnalysisResults data={many} />);
    expect(screen.getByText(i18n.t("analysisResults.resumeStrength"))).toBeTruthy();
    expect(screen.getByText("70"), "the proxy is 70, the line's old threshold").toBeTruthy();
    expect(container.textContent).not.toContain(i18n.t("analysisResults.aboveAverage"));
  });

  it("suggested keywords are not counted as added", () => {
    const { container } = render(<AnalysisResults data={{ ...BASE, atsScore: atsScore(60, []) }} />);
    expect(container.textContent).not.toContain(i18n.t("analysisResults.stats.keywordsAdded"));
  });
});

describe("S13-053: everything the analysis wrote is on the page", () => {
  it("five improvements, four suggestions, four issues and four recommendations all render", () => {
    const data: AnalysisData = {
      ...BASE,
      atsScore: atsScore(65, ["imp-1", "imp-2", "imp-3", "imp-4", "imp-5"]),
      readabilityMetrics: { grade: "B", bulletPointClarity: "ok", jargonLevel: "low", suggestions: ["sug-1", "sug-2", "sug-3", "sug-4"] },
      formatRecommendations: { currentIssues: ["iss-1", "iss-2", "iss-3", "iss-4"], recommendations: ["rec-1", "rec-2", "rec-3", "rec-4"], sectionOrder: [] },
    };
    const { container } = render(<AnalysisResults data={data} />);
    const text = container.textContent ?? "";
    for (const s of ["imp-4", "imp-5", "sug-4", "iss-3", "iss-4", "rec-3", "rec-4"]) expect(text, s).toContain(s);
  });
});

describe("S13-051: a requirement is green or amber, never both", () => {
  const alignment = {
    matchScore: 55,
    extractedKeywords: ["SQL", "Python", "Excel", " tableau "],
    missingKeywords: ["python", "Tableau"],
    suggestedEdits: [], roleMatchAnalysis: "Fits partly", gapAnalysis: "Some gaps",
  };

  it("the green list leaves out what the amber list says is missing", () => {
    const { container } = render(<AnalysisResults data={{ ...BASE, jobDescriptionAlignment: alignment }} />);
    const green = [...container.querySelectorAll("span.bg-success\\/10.text-success")].map((e) => e.textContent?.trim());
    const amber = [...container.querySelectorAll("span.bg-warning\\/10.text-warning")].map((e) => e.textContent?.trim());
    expect(amber).toEqual(expect.arrayContaining(["python", "Tableau"]));
    expect(green).toEqual(expect.arrayContaining(["SQL", "Excel"]));
    expect(green.map((g) => g?.toLowerCase())).not.toContain("python");
    expect(green.map((g) => g?.toLowerCase())).not.toContain("tableau");
  });

  it("the comparison is the two lists the analysis wrote, case and spacing aside", () => {
    expect(keywordsNotMissing(alignment)).toEqual(["SQL", "Excel"]);
    expect(keywordsNotMissing(undefined)).toEqual([]);
  });
});

describe("S13-021: the section panel is closed below 2xl until its toggle opens it", () => {
  it("no breakpoint under 2xl forces it open, and it never runs past the window", () => {
    render(<AnalysisResults data={{ ...BASE, atsScore: atsScore(60, []), summaryRewrite: { professionalSummary: "x", linkedInHeadline: "y" } }} />);
    const panel = screen.getByTestId("section-nav-panel");
    const toggle = screen.getByRole("button", { name: i18n.t("analysisResults.toggleNavigation") });
    const forcedOpen = (cls: string) => cls.split(/\s+/).filter((c) => /^(sm|md|lg|xl):(opacity-100|pointer-events-auto|relative)$/.test(c) || /^(sm|md|lg|xl):hidden$/.test(c));
    expect(forcedOpen(panel.className)).toEqual([]);
    expect(forcedOpen(toggle.className)).toEqual([]);
    expect(panel.className).toMatch(/\b2xl:opacity-100\b/);
    expect(toggle.className).toMatch(/\b2xl:hidden\b/);
    expect(panel.className).toMatch(/max-h-\[70vh\]/);
    expect(panel.className).toMatch(/pointer-events-none/);
    fireEvent.click(toggle);
    expect(panel.className).toMatch(/pointer-events-auto/);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("S13-055: the LinkedIn breakdown wraps on a phone", () => {
  it("is not five fixed columns, and a label may break", () => {
    const linkedInAnalysis = { profileScore: { overall: 70, breakdown: { headline: 14, about: 12, experience: 16, skills: 15, engagement: 8 } } };
    render(<AnalysisResults data={{ ...BASE, hasLinkedIn: true, linkedInAnalysis }} />);
    const grid = screen.getByTestId("linkedin-breakdown");
    expect(grid.className.split(/\s+/)).not.toContain("grid-cols-5");
    expect(grid.className).toMatch(/\bgrid-cols-2\b/);
    expect(grid.className).toMatch(/\bmd:grid-cols-5\b/);
  });
});

describe("S13-123: the last line names no link the page does not show", () => {
  // The line's new words wait in the pending-locale file until the locale
  // files are free to edit (they are another round's while this one runs).
  const pending = JSON.parse(readFileSync(resolve(__dirname, "../../docs/audit-rest-pending-locales/pages.json"), "utf8")) as Record<string, Record<string, string>>;
  const line = pending["analysisResults.analysisSaved"];

  it("its replacement is written for every locale, with the clock and without the link", () => {
    expect(line?._replaces).toBe(en.analysisResults.analysisSaved);
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      expect(line?.[l], l).toContain("{{analysisDays}}");
    }
    expect(line.en).not.toMatch(/share link|above/i);
  });

  it("rendered with it, says how long it is kept and nothing about a share link above", () => {
    i18n.addResource("en", "translation", "analysisResults.analysisSaved", line.en);
    try {
      const { container } = render(<AnalysisResults data={{ ...BASE, atsScore: atsScore(60, []) }} />);
      expect(container.textContent).not.toMatch(/share link above/i);
      expect(container.textContent).toMatch(/kept for 90 days/);
    } finally {
      i18n.addResource("en", "translation", "analysisResults.analysisSaved", line._replaces);
    }
  });
});
