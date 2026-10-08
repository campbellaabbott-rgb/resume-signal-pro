import { describe, expect, it } from "vitest";
import { matchQuestion, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-043. The yes-pattern accepted "I am / I do / I will" followed by a
 * word boundary, and the space before "not" is one. With the options
 * ["I do not require sponsorship", "I will require sponsorship"], a candidate
 * who needs sponsorship was given the first; "I am not authorized" and "I am
 * not willing to relocate" were picked the same way; and "I consent" never
 * matched at all, so a consenting candidate always got "I do not consent".
 */
const person = (over: Partial<StandingAnswers> = {}): StandingAnswers => ({
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "Denver", country: "United States", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: true, willingToRelocate: true,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: true, ...over,
});
const radio = (label: string, options: string[]): DomQuestion => ({ name: "q", type: "radio", required: true, label, options });

describe("a negated option is never the yes", () => {
  it("a candidate who needs sponsorship says they will need it", () => {
    for (const options of [
      ["I do not require sponsorship", "I will require sponsorship"],
      ["I will require sponsorship", "I do not require sponsorship"],
    ]) {
      expect(matchQuestion(radio("Will you require visa sponsorship?", options), person()))
        .toMatchObject({ kind: "choose", option: "I will require sponsorship" });
    }
  });

  it("an authorised candidate says they are authorised", () => {
    expect(matchQuestion(radio("Are you legally authorized to work in the US?", ["I am not authorized", "I am authorized"]), person()))
      .toMatchObject({ kind: "choose", option: "I am authorized" });
  });

  it("a candidate willing to relocate says so", () => {
    expect(matchQuestion(radio("Are you willing to relocate?", ["I am not willing to relocate", "I am willing to relocate"]), person()))
      .toMatchObject({ kind: "choose", option: "I am willing to relocate" });
  });

  it("a consenting candidate consents, in either order", () => {
    for (const options of [["I do not consent", "I consent"], ["I consent", "I do not consent"]]) {
      expect(matchQuestion(radio("Do you consent to us processing your personal data?", options), person()))
        .toMatchObject({ kind: "choose", option: "I consent" });
    }
  });

  it("two options that both mean yes is a choice it does not make", () => {
    expect(matchQuestion(radio("Are you willing to relocate?", ["Yes", "Yes, with relocation support"]), person()))
      .toMatchObject({ kind: "unanswerable" });
  });

  it("the plain Yes/No form still answers both ways", () => {
    expect(matchQuestion(radio("Will you require visa sponsorship?", ["Yes", "No"]), person())).toMatchObject({ option: "Yes" });
    expect(matchQuestion(radio("Will you require visa sponsorship?", ["Yes", "No"]), person({ requiresSponsorship: false })))
      .toMatchObject({ option: "No" });
  });
});
