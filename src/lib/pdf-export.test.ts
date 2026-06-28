import { describe, it, expect } from "vitest";
import { exportCareerSnapshotPDF, exportGraduateGamePlanPDF } from "./pdf-export";

function buildCareerSnapshot(overrides?: Record<string, unknown>) {
  return {
    careerSignalScore: {
      overall: "Strong",
      performanceSignal: { score: "8/10", summary: "Consistently exceeds targets." },
      trajectorySignal: { score: "7/10", summary: "Steady upward progression." },
      credibilitySignal: { score: "9/10", summary: "Well-quantified achievements." },
      seniorityAlignment: { currentLevel: "Senior", targetFit: "Staff", summary: "Ready for the next level." },
    },
    recruiterPerception: { summary: "Reads as a strong senior IC with leadership potential." },
    topStrengths: [{ strength: "Technical depth", evidence: "Led migration of core payments system." }],
    careerRisks: [{ risk: "Limited people-management experience", recruiterQuestion: "Have you managed a team?", mitigation: "Highlight informal mentorship." }],
    positioningGuidance: {
      idealPositioning: "Senior IC track at a Series B-D startup.",
      rolesToTarget: ["Staff Engineer", "Principal Engineer"],
      rolesToAvoid: ["People Manager"],
      companyStages: ["Series B", "Series C"],
      storyFraming: "Frame as a force-multiplier IC, not a manager-in-waiting.",
    },
    priorityFixes: [{ fix: "Add a leadership/mentorship bullet", impact: "High", timeEstimate: "15 min" }],
    ...overrides,
  };
}

function buildGraduateGamePlan(overrides?: Record<string, unknown>) {
  return {
    resumeReadinessGate: { verdict: "Ready to Apply", confidence: "High", summary: "Solid for entry-level roles.", quickFixes: ["Add GPA if 3.5+"] },
    roleTargetingMap: {
      summary: "Best fit for associate/junior roles in tech.",
      priorityRoles: [{ title: "Junior Software Engineer", whyFit: "Strong CS fundamentals." }],
      rolesToAvoid: [{ title: "Senior Engineer", reason: "Insufficient experience." }],
    },
    applicationStrategy: {
      weeklyTarget: "10-15 applications/week",
      whereToApply: [{ channel: "LinkedIn", priority: "High", tip: "Apply within 48 hours of posting." }],
      whatToAvoid: ["Mass-applying without tailoring"],
      keyInsight: "Referrals outperform cold applications 5x.",
    },
    networkingPlaybook: {
      approach: "Warm outreach to alumni network.",
      outreachScript: { scenario: "Cold LinkedIn message", script: "Hi, I noticed we both went to..." },
      linkedInTips: ["Post about projects weekly"],
    },
    interviewReadiness: {
      summary: "Practice STAR-format stories.",
      storiesToPrepare: [{ type: "Conflict resolution", prompt: "Tell me about a disagreement with a teammate." }],
      whyThisRole: "Genuine interest in the company's mission.",
      projectTalkingPoints: ["Capstone project architecture decisions"],
    },
    thirtyDayPlan: {
      week1: { focus: "Resume polish", tasks: ["Finalize resume", "Set up job alerts"] },
      week2: { focus: "Applications", tasks: ["Apply to 15 roles"] },
      week3: { focus: "Networking", tasks: ["Reach out to 10 alumni"] },
      week4: { focus: "Interview prep", tasks: ["Mock interviews"] },
    },
    ...overrides,
  };
}

describe("exportCareerSnapshotPDF", () => {
  it("generates a PDF without throwing for a normal report", () => {
    expect(() => exportCareerSnapshotPDF(buildCareerSnapshot() as never)).not.toThrow();
  });

  it("handles many career risks/priority fixes without throwing (multi-page pagination)", () => {
    const data = buildCareerSnapshot({
      careerRisks: Array.from({ length: 15 }, (_, i) => ({
        risk: `Risk number ${i + 1} with a moderately long description of the concern.`,
        recruiterQuestion: `Question ${i + 1} a recruiter might reasonably ask about this gap?`,
        mitigation: `A reasonably detailed mitigation strategy for risk ${i + 1} that spans more than a few words.`,
      })),
      priorityFixes: Array.from({ length: 15 }, (_, i) => ({
        fix: `Fix number ${i + 1}`,
        impact: "High",
        timeEstimate: "30 min",
      })),
    });
    expect(() => exportCareerSnapshotPDF(data as never)).not.toThrow();
  });
});

describe("exportGraduateGamePlanPDF", () => {
  it("generates a PDF without throwing for a normal report", () => {
    expect(() => exportGraduateGamePlanPDF(buildGraduateGamePlan() as never)).not.toThrow();
  });

  it("handles many tasks across all four weeks without throwing (multi-page pagination)", () => {
    const manyTasks = Array.from({ length: 12 }, (_, i) => `Task ${i + 1}: a reasonably detailed action item description.`);
    const data = buildGraduateGamePlan({
      thirtyDayPlan: {
        week1: { focus: "Resume polish", tasks: manyTasks },
        week2: { focus: "Applications", tasks: manyTasks },
        week3: { focus: "Networking", tasks: manyTasks },
        week4: { focus: "Interview prep", tasks: manyTasks },
      },
    });
    expect(() => exportGraduateGamePlanPDF(data as never)).not.toThrow();
  });
});
