/**
 * THE COACH AND THE CAREER PATH SHOWED ENGLISH LABELS IN A TRANSLATED PRODUCT.
 *
 * Since S8-034 every paid generator is told to keep the fixed-choice values
 * of its format in English, because pages pick colours by them. Career
 * Snapshot and Game Plan were given localised labels; Interview Coach
 * (difficulty "Entry/Mid/Senior" and "Easy/Medium/Hard", category
 * "Behavioral/Technical/...") and Career Path (level, riskLevel "High") still
 * rendered those values raw, so a Spanish buyer read "Hard", "Behavioral" and
 * "Riesgo: High" in an otherwise Spanish report. The colours keep keying on
 * the English value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import i18n from "@/i18n";
import { InterviewCoach } from "@/components/InterviewCoach";
import { CareerPathSimulator } from "@/components/CareerPathSimulator";

const es = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/es.json"), "utf8"));
const RESUME = "Senior engineer with ten years of payments work at Acme. ".repeat(4);

beforeEach(async () => {
  i18n.addResourceBundle("es", "translation", es, true, true);
  await i18n.changeLanguage("es");
});
afterEach(async () => {
  invoke.mockReset();
  await i18n.changeLanguage("en");
});

describe("Interview Coach in Spanish", () => {
  it("shows difficulty and category in Spanish, coloured by the English value", async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        data: {
          interviewProfile: { targetRole: "Ingeniero sénior", difficulty: "Senior", interviewType: "Mixta" },
          questions: [{ id: 1, category: "Behavioral", question: "¿Cuéntame de un conflicto?", whyAsked: "Para ver", strongAnswerTips: [], redFlags: [], sampleOpener: "Cuando", timeLimit: "2 min", difficulty: "Hard" }],
          interviewTips: { beforeInterview: [], duringInterview: [], closingQuestions: [] },
        },
      },
      error: null,
    });
    const { container } = render(<InterviewCoach resumeText={RESUME} />);
    fireEvent.click(screen.getByRole("button", { name: es.interviewCoach.startButton }));
    await waitFor(() => expect(screen.getByText(es.careerReportEnum.hard)).toBeTruthy());
    expect(screen.getByText(es.careerReportEnum.behavioral)).toBeTruthy();
    expect(screen.getByText(es.careerReportEnum.senior)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bHard\b|\bBehavioral\b/);
    expect(screen.getByText(es.careerReportEnum.hard).className).toMatch(/text-red-700/);
  });
});

describe("Career Path in Spanish", () => {
  it("shows the level and the risk in Spanish, coloured by the English value", async () => {
    invoke.mockResolvedValue({
      data: {
        success: true,
        data: {
          currentPosition: { title: "Ingeniero", level: "Lead", strengths: [], gaps: [] },
          paths: [{ id: "ambitious", name: "La ambiciosa", emoji: "🚀", description: "Subir rápido", timeline: [], requiredSkills: [], riskLevel: "High", probability: "30%" }],
          immediateNextStep: "Hablar con tu jefe",
        },
      },
      error: null,
    });
    const { container } = render(<CareerPathSimulator resumeText={RESUME} />);
    fireEvent.click(screen.getByRole("button", { name: es.careerPathSimulator.simulateButton }));
    const risk = es.careerPathSimulator.risk.replace("{{level}}", es.careerReportEnum.high);
    await waitFor(() => expect(screen.getByText(risk)).toBeTruthy());
    expect(screen.getByText(es.careerReportEnum.lead)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bHigh\b/);
    expect(screen.getByText(risk).className).toMatch(/text-red-600/);
  });
});
