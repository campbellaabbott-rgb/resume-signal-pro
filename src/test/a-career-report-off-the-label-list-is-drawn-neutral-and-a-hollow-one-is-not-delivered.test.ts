/**
 * A CAREER REPORT WITH A LABEL OFF THE LIST IS DRAWN NEUTRAL, AND A HOLLOW ONE
 * IS NOT DELIVERED (register S11-148).
 *
 * The wave-3 shape check refused a whole Career Snapshot or Game Plan over
 * one off-list or translated label ("Declining", "Low" for a trajectory,
 * "Listo para postularte"): the generator walked its model chain to a 502 and
 * a paid delivery failed although the page could draw it. In the other
 * direction a reply whose strengths, risks, fixes, positioning or weeks were
 * empty passed with no problem and shipped as delivered.
 *
 * Run against the shipped shape module (the generators' copy is byte-
 * identical, held by the translated-verdict test).
 */
import { describe, expect, it } from "vitest";
import { reportTone, shapeCareerSnapshot, shapeGamePlan } from "../../supabase/functions/_shared/career-report-shape";

const snapshot = (over: Record<string, unknown> = {}) => ({
  careerSignalScore: {
    overall: "Strong",
    performanceSignal: { score: "Strong", summary: "Beats quota." },
    trajectorySignal: { score: "Growth", summary: "Promoted twice." },
    credibilitySignal: { score: "High", summary: "Long tenures." },
    seniorityAlignment: { currentLevel: "Senior", targetFit: "Aligned", summary: "Fits." },
  },
  recruiterPerception: { summary: "A strong senior engineer." },
  topStrengths: [{ strength: "Payments", evidence: "Migrated payments." }],
  careerRisks: [{ risk: "No reports", recruiterQuestion: "Managed?", mitigation: "Mentoring." }],
  positioningGuidance: { idealPositioning: "Senior IC.", rolesToTarget: ["Staff"], rolesToAvoid: ["Manager"], companyStages: ["Series B"], storyFraming: "Force multiplier." },
  priorityFixes: [{ fix: "Add mentoring", impact: "Shows leadership", timeEstimate: "15 minutes" }],
  ...over,
});
const WEEK = { focus: "Focus", tasks: ["Apply to five roles"] };
const plan = (over: Record<string, unknown> = {}) => ({
  resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary: "Go.", quickFixes: [] },
  roleTargetingMap: { summary: "Junior.", priorityRoles: [{ title: "Junior Engineer", whyFit: "CS." }], rolesToAvoid: [] },
  applicationStrategy: { weeklyTarget: "15", whereToApply: [{ channel: "Career pages", priority: "High", tip: "Early." }], whatToAvoid: [], keyInsight: "Referrals." },
  networkingPlaybook: { approach: "Alumni.", outreachScript: { scenario: "Cold", script: "Hi" }, linkedInTips: [] },
  interviewReadiness: { summary: "STAR.", storiesToPrepare: [], whyThisRole: "Mission.", projectTalkingPoints: [] },
  thirtyDayPlan: { week1: WEEK, week2: WEEK, week3: WEEK, week4: WEEK },
  ...over,
});

describe("a label off the list", () => {
  it("does not refuse a Snapshot, and is drawn neutral, never red", () => {
    const base = snapshot();
    const r = shapeCareerSnapshot({
      ...base,
      careerSignalScore: { ...base.careerSignalScore, trajectorySignal: { score: "Declining", summary: "Flat." }, credibilitySignal: { score: "Low-ish", summary: "Short." } },
    });
    expect(r.problems).toEqual([]);
    expect(r.data.careerSignalScore.trajectorySignal.score).toBe("");
    expect(reportTone(r.data.careerSignalScore.trajectorySignal.score)).toBe("unknown");
  });

  it("does not refuse a Game Plan, and a channel with no priority is fine", () => {
    const base = plan();
    const r = shapeGamePlan({
      ...base,
      resumeReadinessGate: { ...base.resumeReadinessGate, verdict: "Listo para postularte" },
      applicationStrategy: { ...base.applicationStrategy, whereToApply: [{ channel: "Career pages", tip: "Early." }, { channel: "Referrals", priority: "Low", tip: "Ask." }] },
    });
    expect(r.problems).toEqual([]);
    expect(r.data.resumeReadinessGate.verdict).toBe("");
    expect(r.data.applicationStrategy.whereToApply.map((w) => w.priority)).toEqual(["", "Low"]);
  });

  it("a verdict that is missing altogether is still incomplete", () => {
    const base = snapshot();
    const { overall: _o, ...withoutOverall } = base.careerSignalScore;
    expect(shapeCareerSnapshot({ ...base, careerSignalScore: withoutOverall }).problems).toContain("careerSignalScore.overall is missing");
  });

  it("a translated label on the list is still read as its English value", () => {
    const base = snapshot();
    const r = shapeCareerSnapshot({ ...base, careerSignalScore: { ...base.careerSignalScore, overall: "Fuerte" } });
    expect(r.data.careerSignalScore.overall).toBe("Strong");
    expect(r.problems).toEqual([]);
  });
});

describe("a hollow report", () => {
  for (const [name, over, problem] of [
    ["no strengths", { topStrengths: [] }, "topStrengths is empty"],
    ["a strength with no text", { topStrengths: [{ strength: "", evidence: "" }] }, "topStrengths is empty"],
    ["no risks", { careerRisks: [] }, "careerRisks is empty"],
    ["no fixes", { priorityFixes: [] }, "priorityFixes is empty"],
    ["no positioning", { positioningGuidance: { idealPositioning: "", rolesToTarget: [], rolesToAvoid: [], companyStages: [], storyFraming: "" } }, "positioningGuidance.idealPositioning is empty"],
    ["no recruiter summary", { recruiterPerception: { summary: "" } }, "recruiterPerception.summary is empty"],
  ] as const) {
    it(`a Snapshot with ${name} is not delivered`, () => {
      expect(shapeCareerSnapshot(snapshot(over as Record<string, unknown>)).problems).toContain(problem);
    });
  }

  it("a Game Plan with an empty week or no readiness summary is not delivered", () => {
    expect(shapeGamePlan(plan({ thirtyDayPlan: { week1: WEEK, week2: { focus: "Rest", tasks: [] }, week3: WEEK, week4: WEEK } })).problems).toContain("thirtyDayPlan.week2.tasks is empty");
    expect(shapeGamePlan(plan({ resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary: "", quickFixes: [] } })).problems).toContain("resumeReadinessGate.summary is empty");
  });

  it("the complete reports have no problems", () => {
    expect(shapeCareerSnapshot(snapshot()).problems).toEqual([]);
    expect(shapeGamePlan(plan()).problems).toEqual([]);
  });
});
