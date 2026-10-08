import { describe, expect, it } from "vitest";
import { matchQuestion, RE_SPONSOR_INVERTED, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { buildPacket, SPONSOR_INVERTED } from "../../supabase/functions/_shared/submission-packet";

/**
 * Sweep S8-006. Wave 1 widened the review sheet's inversion rule to read
 * "without needing / requiring sponsorship" as the opposite question, and left
 * the worker's own rule alone. A candidate who needs sponsorship then approved
 * a sheet that said "No" to "able to work in the US without requiring visa
 * sponsorship?" while the worker, filling the real form, sent "Yes".
 *
 * The two runtimes cannot share a file (the worker builds from worker/src
 * only), so they share a literal and this test feeds the same labels through
 * both and requires the same answer.
 */
const LABELS = [
  "Are you able to work in the US without requiring visa sponsorship?",
  "Are you authorized to work in the US without needing sponsorship?",
  "Can you work in the US without needing any sponsorship?",
  "Are you legally authorised to work in the US without requiring any visa sponsorship?",
  "Can you work in the US without the need for sponsorship?",
  "Will you now or in the future require sponsorship to work in the US?",
  "Do you require visa sponsorship to work in the US?",
];

const worker = (requiresSponsorship: boolean): StandingAnswers => ({
  fullName: "Sam Rivera", firstName: "Sam", lastName: "Rivera", email: "sam@example.com", phone: "",
  city: "Denver", country: "United States", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
});

const radio = (label: string): DomQuestion => ({ name: "q", type: "radio", required: true, label, options: ["Yes", "No"] });

function sheetAnswer(label: string, requiresSponsorship: boolean): string | undefined {
  const p = buildPacket({
    questions: [{ label, required: true, fieldType: "radio" }],
    profile: { fullName: "Sam Rivera", country: "United States" },
    standing: { workAuthorized: true, requiresSponsorship },
    drafted: [],
    automationTier: "auto",
  });
  return p.fields.find((f) => f.key === label)?.value;
}

describe("the worker and the review sheet answer a sponsorship question the same way", () => {
  for (const needs of [true, false]) {
    it.each(LABELS)(`requiresSponsorship=${needs}: %s`, (label) => {
      const sheet = sheetAnswer(label, needs);
      const sent = matchQuestion(radio(label), worker(needs));
      expect(sheet, "the review sheet answers it").toMatch(/^(Yes|No)$/);
      expect(sent).toMatchObject({ kind: "choose", option: sheet });
    });
  }

  it("a candidate who needs sponsorship says No to working without it, in both runtimes", () => {
    const label = "Are you able to work in the US without requiring visa sponsorship?";
    expect(sheetAnswer(label, true)).toBe("No");
    expect(matchQuestion(radio(label), worker(true))).toMatchObject({ kind: "choose", option: "No" });
    expect(matchQuestion(radio(label), worker(false))).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("the two runtimes carry the same inversion literal", () => {
    expect(RE_SPONSOR_INVERTED.source).toBe(SPONSOR_INVERTED.source);
  });
});
