import { describe, expect, it } from "vitest";
import {
  classifyQuestion,
  PROTECTED_DEMOGRAPHIC,
  PROTECTED_FACTUAL,
  shapeModelAnswers,
} from "../../supabase/functions/_shared/application-questions";
import { matchQuestion, normaliseLabel, type StandingAnswers } from "../../worker/src/questions/match.js";
import * as workerProtected from "../../worker/src/questions/protected.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-008. The classifier called criminal-history, age, immigration,
 * salary, medical and protected-trait questions `draftable`, so apply-agent had
 * the model write answers to them; the worker, which did not recognise those
 * labels either, filled a "supported" draft into a REQUIRED box. The only thing
 * between a language model and an employer on "Have you ever been convicted?"
 * was the model's own supported flag.
 *
 * One corpus, both runtimes: the server must not classify these as draftable,
 * and the worker must not send a prepared draft for them even if one arrives.
 */
const PROTECTED = [
  "Have you ever been convicted of a crime?",
  "Have you ever been convicted of a felony?",
  "Do you have any pending criminal cases?",
  "Are there any criminal charges pending against you?",
  "Have you ever been arrested?",
  "Are you willing to undergo a drug test?",
  "Are you at least 21 years of age?",
  "Are you at least 21?",
  "How old are you?",
  "What is your age?",
  "Can you legally work in Australia?",
  "Do you have the right to live and work in the UK?",
  "Are you a U.S. citizen or permanent resident?",
  "Do you hold a green card?",
  "What is your current visa status?",
  "Are you currently on OPT?",
  "Do you have a valid passport?",
  "What are your wage expectations?",
  "What is your Total Cost To Company?",
  "What hourly rate are you looking for?",
  "What is your expected OTE?",
  "Do you have any medical conditions that may affect your work?",
  "Do you require any reasonable accommodations for the interview?",
  "Are you currently pregnant?",
  "Are you able to perform the essential functions of the job?",
  "Do you have relatives employed by the company?",
  "Are you able to work weekends?",
  "Can you work night shifts?",
  "What is your tax ID number?",
  "Do you identify as LGBTQ+?",
  "Are you Aboriginal or Torres Strait Islander?",
  "Have you served in the military?",
  "What is your age range?",
  "Which caste do you belong to?",
];

/** Résumé questions in the same vocabulary. Widening must not swallow them. */
const STAYS_DRAFTABLE = [
  "Describe your experience working in a medical setting",
  "Do you have Medical Terminology knowledge?",
  "What was your average close rate across your team?",
  "Describe your experience with hotel accommodations and guest services",
  "How familiar are you with Service Titan?",
  "Tell us about a time you handled a difficult customer",
  "Have you managed a team of at least 15 people?",
];

const MODEL_TEXT = "MODEL-WRITTEN ANSWER";
const FULL: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "+1 555 0100",
  city: "Denver", country: "United States", address: "1 Main St", postcode: "80202", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
};
const box = (label: string): DomQuestion => ({ name: "q", type: "textarea", required: true, label, options: [] });
const sent = (label: string) =>
  matchQuestion(box(label), FULL, undefined, new Map([[normaliseLabel(label), MODEL_TEXT]]));

describe("a protected question is never handed to the model", () => {
  it.each(PROTECTED)("the server does not call it draftable: %s", (label) => {
    expect(classifyQuestion(label, "")).not.toBe("draftable");
  });

  it.each(PROTECTED)("the worker does not send a drafted answer for it: %s", (label) => {
    const r = sent(label);
    expect(r && r.kind === "fill" ? r.value : null).not.toBe(MODEL_TEXT);
    // A required one stops for the candidate rather than going out blank.
    expect(r?.kind === "fill" || r?.kind === "unanswerable" || r?.kind === "choose").toBe(true);
  });
});

describe("résumé questions in the same words are still drafted, in both runtimes", () => {
  it.each(STAYS_DRAFTABLE)("%s", (label) => {
    expect(classifyQuestion(label, "")).toBe("draftable");
    expect(sent(label)).toMatchObject({ kind: "fill", value: MODEL_TEXT });
  });
});

describe("the two runtimes hold one list", () => {
  it("the worker's protected patterns are the server's, character for character", () => {
    expect(workerProtected.PROTECTED_FACTUAL.source).toBe(PROTECTED_FACTUAL.source);
    expect(workerProtected.PROTECTED_DEMOGRAPHIC.source).toBe(PROTECTED_DEMOGRAPHIC.source);
  });
});

describe("the model's reply is read for what it says, not for what it left out", () => {
  it("an answer with no supported flag is not a supported answer", () => {
    const { answers } = shapeModelAnswers(
      [{ question: "Why this role?", answer: "Because." }],
      { inferred: false, askedLabels: new Set(["Why this role?"]) },
    );
    expect(answers[0]).toMatchObject({ supported: false });
    expect(answers[0]!.note).not.toBe("");
  });

  it("a question the model invented in inferred mode is classified before it is answered", () => {
    const { answers, skipped } = shapeModelAnswers(
      [
        { question: "Are you a U.S. citizen?", answer: "Yes", supported: true },
        { question: "Why do you want to work here?", answer: "Because of the product.", supported: true },
      ],
      { inferred: true, askedLabels: new Set() },
    );
    expect(answers.map((a) => a.question)).toEqual(["Why do you want to work here?"]);
    expect(skipped).toEqual([{ question: "Are you a U.S. citizen?", class: "factual" }]);
  });
});
