/**
 * EACH INTERVIEW QUESTION KEEPS ITS OWN DRAFT ANSWER (S13-125).
 *
 * Interview Coach held one answer string for every question. Half an answer
 * typed under question 1 showed in question 3's box, Submit sent question 3
 * with question 1's words to the scorer (spending the allowance on a pair
 * that never belonged together), and "Try again" on any question wiped the
 * draft for all of them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import i18n from "@/i18n";
import { InterviewCoach } from "@/components/InterviewCoach";

const RESUME = "Senior engineer with ten years of payments work at Acme. ".repeat(4);
const q = (id: number, question: string) => ({
  id, category: "Behavioral", question, whyAsked: "To see", strongAnswerTips: [], redFlags: [], sampleOpener: "When", timeLimit: "2 min", difficulty: "Medium",
});
const SET = {
  data: {
    success: true,
    data: {
      interviewProfile: { targetRole: "Engineer", difficulty: "Mid", interviewType: "Mixed" },
      questions: [q(1, "Tell me about a conflict."), q(2, "Why this team?"), q(3, "Describe a failure.")],
      interviewTips: { beforeInterview: [], duringInterview: [], closingQuestions: [] },
    },
  },
  error: null,
};
const SCORE = {
  data: { success: true, data: { score: 7, grade: "B", strengths: ["clear"], improvements: ["numbers"], revisedAnswer: "Better.", recruiterReaction: "Good" } },
  error: null,
};

afterEach(() => invoke.mockReset());

async function openSet() {
  invoke.mockResolvedValueOnce(SET);
  render(<InterviewCoach resumeText={RESUME} />);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("interviewCoach.startButton") }));
  await waitFor(() => expect(screen.getByText("Describe a failure.")).toBeTruthy());
}
const box = () => screen.getByPlaceholderText(i18n.t("interviewCoach.answerPlaceholder")) as HTMLTextAreaElement;

describe("Interview Coach drafts", () => {
  it("a draft typed under one question is not shown, or sent, under another", async () => {
    await openSet();
    fireEvent.click(screen.getByText("Tell me about a conflict."));
    fireEvent.change(box(), { target: { value: "Half an answer about the conflict" } });

    fireEvent.click(screen.getByText("Describe a failure."));
    expect(box().value, "question 3's box shows question 1's draft").toBe("");
    fireEvent.change(box(), { target: { value: "The launch that slipped" } });

    invoke.mockResolvedValueOnce(SCORE);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("interviewCoach.submitAnswer") }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const body = invoke.mock.calls[1][1].body as { question: string; answer: string; mode: string };
    expect(body.mode).toBe("evaluate");
    expect(body.question).toBe("Describe a failure.");
    expect(body.answer).toBe("The launch that slipped");

    fireEvent.click(screen.getByText("Tell me about a conflict."));
    await waitFor(() => expect(box().value).toBe("Half an answer about the conflict"));
  });

  it("Try again on one question keeps the other questions' drafts", async () => {
    await openSet();
    fireEvent.click(screen.getByText("Why this team?"));
    fireEvent.change(box(), { target: { value: "Draft for question two" } });

    fireEvent.click(screen.getByText("Describe a failure."));
    fireEvent.change(box(), { target: { value: "Answer for question three" } });
    invoke.mockResolvedValueOnce(SCORE);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("interviewCoach.submitAnswer") }));
    const retry = await screen.findByRole("button", { name: new RegExp(i18n.t("interviewCoach.tryAgain")) });
    fireEvent.click(retry);
    expect(box().value).toBe("");

    fireEvent.click(screen.getByText("Why this team?"));
    expect(box().value).toBe("Draft for question two");
  });
});
