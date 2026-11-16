/**
 * A REPORT jsPDF CANNOT DRAW GOES TO THE PRINT DIALOG (RC-S12-029).
 *
 * The Career Snapshot and Graduate Game Plan PDFs were drawn in helvetica
 * whatever they held. A Hindi, Russian, Chinese or Polish report came out as
 * letter-spaced garbage, after a toast that warned it "may not display" and
 * then said the PDF was ready. A report with a character the built-in fonts
 * cannot draw is now handed to the browser's print dialog as a page marked
 * data-rb-print, which draws every script; jsPDF is never asked to save it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: string[] = [];
vi.mock("jspdf", () => {
  class FakePdf {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    splitTextToSize(text: string) { return [text]; }
    save(name: string) { saved.push(name); }
  }
  const noop = () => undefined;
  const proxied = new Proxy(FakePdf, {
    construct(target, args) {
      const pdf = new target(...(args as []));
      return new Proxy(pdf, { get: (o, k) => (k in o ? (o as never)[k] : noop) });
    },
  });
  return { default: proxied, jsPDF: proxied };
});

import {
  careerSnapshotNeedsPrint,
  exportCareerSnapshotPDF,
  exportGraduateGamePlanPDF,
  gamePlanNeedsPrint,
} from "@/lib/pdf-export";

const snapshot = (summary: string) => ({
  careerSignalScore: {
    overall: "Strong",
    performanceSignal: { score: "Strong", summary },
    trajectorySignal: { score: "Growth", summary: "Steady." },
    credibilitySignal: { score: "High", summary: "Long tenures." },
    seniorityAlignment: { currentLevel: "Senior", targetFit: "Aligned", summary: "Fits." },
  },
  recruiterPerception: { summary: "A strong senior engineer." },
  topStrengths: [{ strength: "Payments", evidence: "Migrated payments." }],
  careerRisks: [{ risk: "No reports", recruiterQuestion: "Led?", mitigation: "Mentoring." }],
  positioningGuidance: { idealPositioning: "Senior IC.", rolesToTarget: ["Staff"], rolesToAvoid: ["Manager"], companyStages: ["Series B"], storyFraming: "Multiplier." },
  priorityFixes: [{ fix: "Add mentoring", impact: "High", timeEstimate: "15 minutes" }],
});
const WEEK = { focus: "Focus", tasks: ["Task"] };
const plan = (summary: string) => ({
  resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary, quickFixes: [] },
  roleTargetingMap: { summary: "Junior.", priorityRoles: [{ title: "Junior Engineer", whyFit: "CS." }], rolesToAvoid: [] },
  applicationStrategy: { weeklyTarget: "15", whereToApply: [{ channel: "Career pages", priority: "High", tip: "Early." }], whatToAvoid: [], keyInsight: "Referrals." },
  networkingPlaybook: { approach: "Alumni.", outreachScript: { scenario: "Cold", script: "Hi" }, linkedInTips: [] },
  interviewReadiness: { summary: "STAR.", storiesToPrepare: [], whyThisRole: "Mission.", projectTalkingPoints: [] },
  thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK, week4: WEEK },
});

const HINDI = "भुगतान प्रणाली का नेतृत्व किया";
const POLISH = "Łódź, zespół płatności";

beforeEach(() => { saved.length = 0; });

describe("the Career Snapshot", () => {
  it("in Hindi needs print, and is printed as a data-rb-print page holding the Hindi, never drawn by jsPDF", () => {
    const data = snapshot(HINDI);
    expect(careerSnapshotNeedsPrint(data)).toBe(true);
    const printed: string[] = [];
    expect(exportCareerSnapshotPDF(data, { print: (h) => printed.push(h), lang: "hi" })).toEqual({ method: "print" });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("data-rb-print");
    expect(printed[0]).toContain(HINDI);
    expect(printed[0]).toContain('lang="hi"');
    expect(saved).toEqual([]);
  });

  it("with a Polish letter jsPDF cannot draw is printed too", () => {
    expect(careerSnapshotNeedsPrint(snapshot(POLISH))).toBe(true);
  });

  it("in English or with é and € (which jsPDF draws) is still a jsPDF file", () => {
    const data = snapshot("Led the café's €2,000 payments rebuild.");
    expect(careerSnapshotNeedsPrint(data)).toBe(false);
    const printed: string[] = [];
    expect(exportCareerSnapshotPDF(data, { print: (h) => printed.push(h) })).toEqual({ method: "pdf" });
    expect(printed).toEqual([]);
    expect(saved).toEqual(["career-snapshot-report.pdf"]);
  });

  it("a report field holding markup is printed as text, never as markup", () => {
    const printed: string[] = [];
    exportCareerSnapshotPDF(snapshot(`${HINDI} <img src=x onerror=alert(1)>`), { print: (h) => printed.push(h) });
    expect(printed[0]).not.toContain("<img");
    expect(printed[0]).toContain("&lt;img");
  });
});

describe("the Graduate Game Plan", () => {
  it("in Hindi is printed, never drawn by jsPDF", () => {
    const data = plan(HINDI);
    expect(gamePlanNeedsPrint(data)).toBe(true);
    const printed: string[] = [];
    expect(exportGraduateGamePlanPDF(data, { print: (h) => printed.push(h) })).toEqual({ method: "print" });
    expect(printed[0]).toContain("data-rb-print");
    expect(printed[0]).toContain(HINDI);
    expect(saved).toEqual([]);
  });

  it("in English is a jsPDF file", () => {
    const data = plan("Solid for entry-level roles.");
    expect(gamePlanNeedsPrint(data)).toBe(false);
    expect(exportGraduateGamePlanPDF(data, { print: () => { throw new Error("printed"); } })).toEqual({ method: "pdf" });
    expect(saved).toEqual(["graduate-game-plan.pdf"]);
  });
});
