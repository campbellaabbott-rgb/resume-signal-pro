/**
 * A WRAPPED ACTION LINE DOES NOT OVERPRINT THE NEXT (S10-062, bug reconcile
 * of 2026-11-19, lane paid-results). Past ATS Defense buyers keep their page
 * and its PDF, which is what they print and work from.
 *
 * WHAT WAS WRONG. The PDF writer's addText returns how far a block of text
 * wrapped, but the action-plan and red-flag loops moved down a fixed 5 to 8 mm
 * after each line: an action or a red flag longer than one line had its time
 * line or its fix printed over its own second line. And the writer passed a
 * check mark, a cross, a warning sign and an arrow to helvetica, which jsPDF
 * writes in WinAnsi: none of the four is in it, so each printed as other
 * glyphs.
 *
 * NOW each line moves the next down by as far as it wrapped, and everything
 * drawn is WinAnsi: the report's marks are written in ASCII, and the model's
 * text passes through pdfText. Held here with jsPDF replaced by a recording
 * stub that wraps text the way the writer measures it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

type Drawn = { lines: string[]; x: number; y: number; page: number; fontSize: number };
const pdfLog = vi.hoisted(() => ({ drawn: [] as Drawn[], saved: [] as string[] }));

vi.mock("jspdf", () => {
  class RecordingPdf {
    private fontSize = 16;
    private page = 1;
    private pages = 1;
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFontSize(n: number) { this.fontSize = n; return this; }
    setFont() { return this; }
    setTextColor() { return this; }
    setFillColor() { return this; }
    rect() { return this; }
    roundedRect() { return this; }
    addPage() { this.pages++; this.page = this.pages; return this; }
    setPage(n: number) { this.page = n; return this; }
    getNumberOfPages() { return this.pages; }
    /** About 0.5 mm a point a character: a 10 pt line holds a 180 mm width's 36 characters. */
    splitTextToSize(text: string, maxWidth: number): string[] {
      const per = Math.max(1, Math.floor(maxWidth / (this.fontSize * 0.5)));
      const out: string[] = [];
      for (const para of String(text).split("\n")) {
        let line = "";
        for (const word of para.split(" ")) {
          const next = line ? `${line} ${word}` : word;
          if (next.length > per && line) { out.push(line); line = word; } else line = next;
        }
        out.push(line);
      }
      return out;
    }
    text(t: string | string[], x: number, y: number) {
      pdfLog.drawn.push({ lines: Array.isArray(t) ? t : [t], x, y, page: this.page, fontSize: this.fontSize });
      return this;
    }
    save(name: string) { pdfLog.saved.push(name); }
  }
  return { default: RecordingPdf, jsPDF: RecordingPdf };
});

import { ATSDefenseResults, pdfText, type ATSDefenseData } from "@/components/ATSDefenseResults";

afterEach(() => {
  cleanup();
  pdfLog.drawn.length = 0;
  pdfLog.saved.length = 0;
});

const LONG_ACTION = "Rewrite the summary so it names the warehouse platform, the dashboards you shipped and the teams that used them every week, in the posting's own words";
const LONG_FLAG = "Two roles overlap by eight months with no explanation of whether they were concurrent contracts or a transition period";
const LONG_FIX = "Add the word contract to both titles and one line under the second role saying the first was part time while the second began";

const breakdown = { keywordDensity: 50, formatCompliance: 60, sectionStructure: 70, parseability: 80 };
const REPORT: ATSDefenseData = {
  beforeScore: { overall: 52, breakdown },
  afterScore: { overall: 84, breakdown },
  compatibilityAudit: { overallGrade: "C", criticalIssues: [], parsingProblems: [], atsSystemsCompatibility: [] },
  keywordOptimization: {
    primaryRole: { roleName: "Analytics Engineer", currentKeywordMatch: 40, targetKeywordMatch: 85, missingKeywords: ["dbt", "Airflow"], keywordsToAdd: [] },
    secondaryRoles: [],
  },
  formatRestructuring: { currentFormatIssues: [], recommendedFormat: "Reverse chronological", sectionOrder: [], fontRecommendation: "", marginRecommendation: "", elementsToRemove: [], elementsToKeep: [] },
  industryKeywordBank: { industry: "Analytics", hardSkills: ["SQL"], softSkills: ["Communication"], certifications: [], tools: ["Looker"], actionVerbs: [] },
  linkedInAlignment: { headlineRecommendation: "Analytics Engineer | dbt | SQL", summaryKeyPoints: [], skillsToFeature: [], keywordConsistency: "" },
  optimizedResumeSections: { professionalSummary: "Analytics engineer who builds the models finance reads every morning.", coreCompetencies: ["SQL", "dbt"], experienceBullets: [] },
  actionPlan: [
    { priority: 1, action: LONG_ACTION, timeEstimate: "20 minutes", impact: "critical" },
    { priority: 2, action: "Move skills above education", timeEstimate: "5 minutes", impact: "high" },
  ],
  redFlagsSummary: [
    { flag: LONG_FLAG, whyItMatters: "A screener reads it as a gap", howToFix: LONG_FIX },
    { flag: "No dates on the certificate", whyItMatters: "Looks stale", howToFix: "Add the year" },
  ],
  parseSimulation: {
    overallConfidence: 72,
    checks: [
      { id: "sections", label: "Section Headers", status: "pass", detail: "All 4 standard section headers detected." },
      { id: "dates", label: "Date Parsing", status: "warning", detail: "Only 1 date pattern found." },
      { id: "tables", label: "Tables", status: "fail", detail: "A table holds the skills." },
    ],
  } as ATSDefenseData["parseSimulation"],
};

/** Windows-1252, the encoding jsPDF writes helvetica in. */
const WIN_ANSI_ABOVE_LATIN1 = "ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™";
const inWinAnsi = (c: string) => /[\x20-\x7e\xa0-\xff]/.test(c) || WIN_ANSI_ABOVE_LATIN1.includes(c);

function downloadPdf(data: ATSDefenseData) {
  render(createElement(ATSDefenseResults, { data }));
  fireEvent.click(screen.getByRole("button", { name: /Download PDF Report/i }));
  expect(pdfLog.saved, "the PDF was never written").toEqual(["ats-defense-report.pdf"]);
}

/** The drawn blocks from the one whose first line starts with `from` up to the one that starts with `to`. */
function blocksBetween(from: string, to: string): Drawn[] {
  const a = pdfLog.drawn.findIndex((d) => d.lines[0]?.startsWith(from));
  const b = pdfLog.drawn.findIndex((d, i) => i > a && d.lines[0]?.startsWith(to));
  expect(a, `no block starting ${from}`).toBeGreaterThanOrEqual(0);
  expect(b, `no block starting ${to}`).toBeGreaterThan(a);
  return pdfLog.drawn.slice(a, b);
}

/** Each block starts below where the one before it ended (its lines at 0.4 mm a point, the writer's own measure). */
function overprints(blocks: Drawn[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1], cur = blocks[i];
    if (cur.page !== prev.page) continue;
    const bottom = prev.y + prev.lines.length * prev.fontSize * 0.4;
    if (cur.y < bottom - 0.01) out.push(`"${cur.lines[0].slice(0, 40)}" at y=${cur.y.toFixed(1)} over "${prev.lines[0].slice(0, 40)}", which runs to y=${bottom.toFixed(1)}`);
  }
  return out;
}

describe("the ATS Defense PDF", () => {
  it("an action that wraps pushes its time line and the next action below it", () => {
    downloadPdf(REPORT);
    const plan = blocksBetween("Priority Action Plan", "Keyword Optimization");
    const action = plan.find((d) => d.lines[0].startsWith("1. "));
    expect(action, "the long action was not drawn").toBeTruthy();
    expect(action!.lines.length, "the stub did not wrap the long action").toBeGreaterThan(1);
    expect(overprints(plan)).toEqual([]);
    const ys = plan.map((d) => d.y);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
  });

  it("a red flag that wraps pushes its fix and the next flag below it", () => {
    downloadPdf(REPORT);
    const start = pdfLog.drawn.findIndex((d) => d.lines[0]?.startsWith("Red Flags to Fix"));
    expect(start).toBeGreaterThanOrEqual(0);
    const flags = pdfLog.drawn.slice(start).filter((d) => !d.lines[0].startsWith("Page "));
    expect(flags.some((d) => d.lines.length > 1), "the stub did not wrap the long flag").toBe(true);
    expect(overprints(flags)).toEqual([]);
  });

  it("the parse checks, each label and its detail, do not overprint", () => {
    downloadPdf(REPORT);
    expect(overprints(blocksBetween("Overall parse confidence", "Priority Action Plan"))).toEqual([]);
  });

  it("draws no character helvetica cannot: the marks and the arrow are ASCII", () => {
    downloadPdf(REPORT);
    const outside = pdfLog.drawn.flatMap((d) => d.lines.flatMap((l) => [...l].filter((c) => !inWinAnsi(c)).map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()}) in "${l.slice(0, 50)}"`)));
    expect(outside).toEqual([]);
    const text = pdfLog.drawn.flatMap((d) => d.lines).join(" ");
    expect(text).toContain("OK Section Headers");
    expect(text).toContain("X Tables");
    expect(text).toContain("Current Match: 40% -> Target: 85%");
    expect(text).toContain(`! ${LONG_FLAG.split(" ").slice(0, 3).join(" ")}`);
  });

  it("the model's own text is drawn in WinAnsi too", () => {
    const data: ATSDefenseData = {
      ...REPORT,
      actionPlan: [{ priority: 1, action: "Lead with impact → name the result ✓ and keep ≥ 3 metrics 🚀", timeEstimate: "10 min", impact: "high" }],
      redFlagsSummary: [{ flag: "Dates disagree ⚠", whyItMatters: "", howToFix: "Use one format ✗ not two" }],
    };
    downloadPdf(data);
    const text = pdfLog.drawn.flatMap((d) => d.lines).join(" ");
    expect([...text].filter((c) => !inWinAnsi(c))).toEqual([]);
    expect(text).toContain("impact -> name the result OK and keep >= 3 metrics");
  });
});

describe("pdfText", () => {
  it("keeps what WinAnsi has, writes signs in ASCII, drops an accent WinAnsi lacks and leaves out a symbol", () => {
    expect(pdfText("Résumé – naïve “quotes” • €5 … café")).toBe("Résumé – naïve “quotes” • €5 … café");
    expect(pdfText("✓ ✗ ⚠ → ≥ ≤")).toBe("OK X ! -> >= <=");
    expect(pdfText("Łódź Kraków Đorđe")).toBe("Lódz Kraków Dorde");
    expect(pdfText("张伟")).toBe("??");
    expect(pdfText("Shipped 🚀 fast")).toBe("Shipped  fast");
    expect(pdfText(undefined)).toBe("");
  });
});
