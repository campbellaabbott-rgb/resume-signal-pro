/**
 * A TRANSLATED VERDICT DREW A STRONG CAREER AS RISKY, AND A MISSING LIST
 * CRASHED THE PAGE (sweep S8-034, S8-073).
 *
 * CareerSnapshotResults, GraduateGamePlanResults and pdf-export pick colours
 * and gauges by the English verdicts. A strong report whose verdicts came
 * back in Spanish ("Fuerte", "Alta", "Crecimiento") drew five red badges and
 * every gauge at 30%. And the renderers read about twenty nested paths
 * unguarded, so an omitted careerRisks, priorityFixes, companyStages or
 * seniorityAlignment, a string rolesToAvoid or an object topStrengths (a
 * missing networkingPlaybook or interviewReadiness in the Game Plan) crashed
 * the success page; stored reports keep whatever shape they were saved in.
 *
 * Now each report is shaped before anything reads it (career-report-shape.ts,
 * byte-identical to the generators' copy), translated verdicts are read as
 * their English values, the page shows each verdict in the reader's
 * language, and one section that still fails cannot blank the others.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { CareerSnapshotResults } from "@/components/CareerSnapshotResults";
import { GraduateGamePlanResults } from "@/components/GraduateGamePlanResults";
import { exportCareerSnapshotPDF, exportGraduateGamePlanPDF } from "@/lib/pdf-export";
import { REPORT_ENUMS, REPORT_ENUM_KEY, canonicalReportEnum } from "@/lib/career-report-shape";

const root = resolve(__dirname, "../..");
const LOCALES = resolve(root, "src/i18n/locales");

const strong = (scores: Record<string, string>) => ({
  careerSignalScore: {
    overall: scores.overall,
    performanceSignal: { score: scores.performance, summary: "Beats quota." },
    trajectorySignal: { score: scores.trajectory, summary: "Promoted twice." },
    credibilitySignal: { score: scores.credibility, summary: "Long tenures." },
    seniorityAlignment: { currentLevel: scores.level, targetFit: scores.fit, summary: "Fits." },
  },
  recruiterPerception: { summary: "A strong senior engineer." },
  topStrengths: [{ strength: "Payments", evidence: "Migrated payments." }],
  careerRisks: [{ risk: "No reports", recruiterQuestion: "Managed?", mitigation: "Mentoring." }],
  positioningGuidance: { idealPositioning: "Senior IC.", rolesToTarget: ["Staff"], rolesToAvoid: ["Manager"], companyStages: ["Series B"], storyFraming: "Force multiplier." },
  priorityFixes: [{ fix: "Add mentoring", impact: "Shows leadership", timeEstimate: "15 minutes" }],
});
const ENGLISH = { overall: "Strong", performance: "Strong", trajectory: "Growth", credibility: "High", level: "Senior", fit: "Aligned" };
const SPANISH = { overall: "Fuerte", performance: "Fuerte", trajectory: "Crecimiento", credibility: "Alta", level: "Sénior", fit: "Alineado" };

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const tones = (c: HTMLElement) => ({
  destructive: c.querySelectorAll(".text-destructive").length,
  success: c.querySelectorAll(".text-success").length,
});

describe("a Career Snapshot whose verdicts came back translated", () => {
  it("draws the same colours as the English report", () => {
    const en = tones(render(<CareerSnapshotResults data={strong(ENGLISH)} />).container);
    const es = tones(render(<CareerSnapshotResults data={strong(SPANISH)} />).container);
    expect(en.destructive).toBe(0);
    expect(es).toEqual(en);
  });

  it("shows each verdict in the reader's language, from its English value", async () => {
    const es = JSON.parse(readFileSync(resolve(LOCALES, "es.json"), "utf8"));
    i18n.addResourceBundle("es", "translation", es, true, true);
    await i18n.changeLanguage("es");
    render(<CareerSnapshotResults data={strong(ENGLISH)} />);
    expect(screen.getAllByText(es.careerReportEnum.strong).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(es.careerReportEnum.growth)).toBeTruthy();
    expect(screen.queryByText("Strong")).toBeNull();
  });
});

describe("a report saved in a drifted shape", () => {
  const base = strong(ENGLISH);
  const { seniorityAlignment: _s, ...signalWithout } = base.careerSignalScore;
  const variants: Record<string, unknown> = {
    "no careerRisks": { ...base, careerRisks: undefined },
    "no priorityFixes": { ...base, priorityFixes: undefined },
    "no companyStages": { ...base, positioningGuidance: { ...base.positioningGuidance, companyStages: undefined } },
    "no seniorityAlignment": { ...base, careerSignalScore: signalWithout },
    "a string rolesToAvoid": { ...base, positioningGuidance: { ...base.positioningGuidance, rolesToAvoid: "People manager" } },
    "an object topStrengths": { ...base, topStrengths: { strength: "Payments", evidence: "Migrated." } },
  };
  for (const [name, data] of Object.entries(variants)) {
    it(`renders and exports a Career Snapshot with ${name}`, () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => render(<CareerSnapshotResults data={data} />)).not.toThrow();
      expect(() => exportCareerSnapshotPDF(data)).not.toThrow();
    });
  }

  const WEEK = { focus: "Focus", tasks: ["Task"] };
  const plan = {
    resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary: "Go.", quickFixes: [] },
    roleTargetingMap: { summary: "Junior.", priorityRoles: [{ title: "Junior Engineer", whyFit: "CS." }], rolesToAvoid: [{ title: "Senior", reason: "Too early." }] },
    applicationStrategy: { weeklyTarget: "15", whereToApply: [{ channel: "Career pages", priority: "High", tip: "Early." }], whatToAvoid: ["Spray"], keyInsight: "Referrals." },
    networkingPlaybook: { approach: "Alumni.", outreachScript: { scenario: "Cold", script: "Hi" }, linkedInTips: ["Post"] },
    interviewReadiness: { summary: "STAR.", storiesToPrepare: [{ type: "Teamwork", prompt: "A time..." }], whyThisRole: "Mission.", projectTalkingPoints: ["Capstone"] },
    thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK, week4: WEEK },
  };
  const planVariants: Record<string, unknown> = {
    "no networkingPlaybook": { ...plan, networkingPlaybook: undefined },
    "no interviewReadiness": { ...plan, interviewReadiness: undefined },
    "a string rolesToAvoid": { ...plan, roleTargetingMap: { ...plan.roleTargetingMap, rolesToAvoid: "Senior roles" } },
    "a missing week": { ...plan, thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK } },
  };
  for (const [name, data] of Object.entries(planVariants)) {
    it(`renders and exports a Game Plan with ${name}`, () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => render(<GraduateGamePlanResults data={data} />)).not.toThrow();
      expect(() => exportGraduateGamePlanPDF(data)).not.toThrow();
    });
  }
});

describe("the two copies of the report shape", () => {
  it("are byte-identical", () => {
    expect(readFileSync(resolve(root, "src/lib/career-report-shape.ts"), "utf8")).toBe(
      readFileSync(resolve(root, "supabase/functions/_shared/career-report-shape.ts"), "utf8"),
    );
  });

  it("read every language's own label for a verdict back as its English value", () => {
    for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".json"))) {
      const labels = JSON.parse(readFileSync(resolve(LOCALES, file), "utf8")).careerReportEnum as Record<string, string>;
      for (const [kind, values] of Object.entries(REPORT_ENUMS)) {
        for (const value of values) {
          const label = labels[REPORT_ENUM_KEY[value]];
          expect(label, `${file} ${value}`).toBeTruthy();
          expect(canonicalReportEnum(kind as keyof typeof REPORT_ENUMS, label), `${file} ${kind} "${label}"`).toBe(value);
        }
      }
    }
  });
});
