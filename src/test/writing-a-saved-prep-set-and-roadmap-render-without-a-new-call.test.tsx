/**
 * A SAVED PREP SET OR ROADMAP RENDERS WITHOUT A NEW MODEL CALL
 * (RC-S12-042, the writing tools' half).
 *
 * A past buyer reopening a delivered Interview Coach or Career Path had only
 * the start button: the components could not be handed the copy already
 * delivered, so seeing it again meant generating it again. Both now take a
 * savedCopy (the function's data, or its whole reply) and render it as it
 * is, with no call. The pages that pass it are another change.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { InterviewCoach, savedInterviewData } from "@/components/InterviewCoach";
import { CareerPathSimulator, savedCareerData } from "@/components/CareerPathSimulator";

const RESUME = "Senior engineer with ten years of payments work at Acme. ".repeat(4);
const PREP = {
  interviewProfile: { targetRole: "Senior engineer", difficulty: "Senior", interviewType: "Mixed" },
  questions: [{ id: 1, category: "Behavioral", question: "Tell me about a conflict you resolved.", whyAsked: "To see how you work with people.", strongAnswerTips: [], redFlags: [], sampleOpener: "When", timeLimit: "2 min", difficulty: "Medium" }],
  interviewTips: { beforeInterview: [], duringInterview: [], closingQuestions: [] },
};
const ROADMAP = {
  currentPosition: { title: "Engineer", level: "Senior", strengths: [], gaps: [] },
  paths: [{ id: "steady", name: "The steady climb", emoji: "🧗", description: "Grow into a staff role", timeline: [], requiredSkills: [], riskLevel: "Low", probability: "60%" }],
  immediateNextStep: "Ask for a staff-level project",
};

afterEach(() => invoke.mockReset());

describe("a saved Interview Coach prep set", () => {
  it("renders as delivered, from its data or its whole reply, with no call", () => {
    render(<InterviewCoach resumeText={RESUME} savedCopy={{ success: true, data: PREP }} />);
    expect(screen.getByText("Tell me about a conflict you resolved.")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
    expect(savedInterviewData(PREP)).toBe(PREP);
  });

  it("positive control: nothing saved, or a copy with no questions, shows the start button", () => {
    expect(savedInterviewData({ questions: [] })).toBeNull();
    expect(savedInterviewData("not a copy")).toBeNull();
  });
});

describe("a saved Career Path roadmap", () => {
  it("renders as delivered with no call", () => {
    render(<CareerPathSimulator resumeText={RESUME} savedCopy={ROADMAP} />);
    expect(screen.getAllByText("The steady climb").length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(savedCareerData({ data: ROADMAP })).toBe(ROADMAP);
    expect(savedCareerData({ paths: [] })).toBeNull();
  });
});
