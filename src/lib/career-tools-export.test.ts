import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportInterviewPrepPDF, exportCareerPathPDF } from "./career-tools-export";

function buildInterviewData(overrides?: Record<string, unknown>) {
  return {
    interviewProfile: { targetRole: "Senior Software Engineer", difficulty: "Hard", interviewType: "Technical + Behavioral" },
    questions: [
      {
        category: "Behavioral",
        question: "Tell me about a time you disagreed with a teammate.",
        whyAsked: "Assesses conflict resolution and collaboration style.",
        strongAnswerTips: ["Use STAR format", "Focus on the resolution, not the conflict"],
        redFlags: ["Blaming the other person entirely"],
        sampleOpener: "In my role at Acme Corp, I disagreed with a teammate about...",
        modelAnswer: "A full model answer demonstrating the STAR method in detail.",
        difficulty: "Medium",
      },
    ],
    interviewTips: {
      beforeInterview: ["Research the company's recent product launches"],
      duringInterview: ["Ask clarifying questions before diving into a technical answer"],
      closingQuestions: ["What does success look like in this role after 6 months?"],
    },
    ...overrides,
  };
}

function buildCareerPathData(overrides?: Record<string, unknown>) {
  return {
    currentPosition: { title: "Software Engineer", level: "Mid", strengths: ["Strong fundamentals"], gaps: ["Limited leadership experience"] },
    paths: [
      {
        name: "IC Track",
        description: "Continue as an individual contributor toward Staff Engineer.",
        timeline: [{ year: "2026", role: "Senior Engineer", company: "Current", salaryRange: "$140k-$160k", keyMove: "Lead a cross-team project" }],
        requiredSkills: ["System design", "Mentorship"],
        riskLevel: "Low",
        probability: "High",
        actionPlan90Days: ["Lead a project end-to-end", "Mentor a junior engineer"],
      },
    ],
    immediateNextStep: "Ask your manager for a stretch project this quarter.",
    ...overrides,
  };
}

// jsPDF's .save() relies on browser DOM APIs (creating an <a> element,
// clicking it) — mock just enough so the underlying document-generation
// logic actually runs end-to-end.
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("exportInterviewPrepPDF", () => {
  it("generates a PDF without throwing for a normal report", async () => {
    await expect(exportInterviewPrepPDF(buildInterviewData() as never)).resolves.not.toThrow();
  });

  it("handles many questions without throwing (multi-page pagination)", async () => {
    const questions = Array.from({ length: 14 }, (_, i) => ({
      category: "Technical",
      question: `Question number ${i + 1} about a moderately complex technical scenario?`,
      whyAsked: `This assesses competency area ${i + 1} relevant to the role.`,
      strongAnswerTips: [`Tip 1 for question ${i + 1}`, `Tip 2 for question ${i + 1}`],
      redFlags: [`Red flag to avoid for question ${i + 1}`],
      sampleOpener: `A sample opening sentence for answering question ${i + 1} in an interview setting.`,
      difficulty: "Medium",
    }));
    await expect(exportInterviewPrepPDF(buildInterviewData({ questions }) as never)).resolves.not.toThrow();
  });
});

describe("exportCareerPathPDF", () => {
  it("generates a PDF without throwing for a normal report", async () => {
    await expect(exportCareerPathPDF(buildCareerPathData() as never)).resolves.not.toThrow();
  });

  it("handles multiple career paths with long timelines without throwing (multi-page pagination)", async () => {
    const paths = Array.from({ length: 5 }, (_, i) => ({
      name: `Career Path ${i + 1}`,
      description: `A reasonably detailed description of career path option ${i + 1} and what it entails.`,
      timeline: Array.from({ length: 4 }, (_, j) => ({
        year: `${2026 + j}`,
        role: `Role ${j + 1} on path ${i + 1}`,
        company: "Various",
        salaryRange: "$120k-$180k",
        keyMove: `Key move ${j + 1} for this stage of the path.`,
      })),
      requiredSkills: ["Skill A", "Skill B", "Skill C"],
      riskLevel: "Medium",
      probability: "Medium",
      actionPlan90Days: ["Action 1", "Action 2", "Action 3"],
    }));
    await expect(exportCareerPathPDF(buildCareerPathData({ paths }) as never)).resolves.not.toThrow();
  });
});
