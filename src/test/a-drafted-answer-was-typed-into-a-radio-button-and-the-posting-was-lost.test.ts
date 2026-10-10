import { describe, expect, it } from "vitest";
import { matchQuestion, normaliseLabel, planAnswers, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-047. fromPrepared returned {kind:"fill"} whatever the control was,
 * so a supported draft for a required yes/no radio ("Do you have a Bachelor's
 * degree?") was applied with locator.fill, which Playwright refuses for radio
 * inputs. apply.ts reported "could not answer", refusal.ts classified it as a
 * control refusal, and the learned-answer trigger lifts only
 * question-unanswerable, so the posting was lost for good and the candidate was
 * never shown the question.
 */
const A: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "", country: "United States", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
};
const LABEL = "Do you have a Bachelor's degree in a related field?";
const prepared = (draft: string) => new Map([[normaliseLabel(LABEL), draft]]);
const q = (type: string, options: string[] = []): DomQuestion => ({ name: "deg", type, required: true, label: LABEL, options });

describe("a drafted answer is applied the way the control takes it", () => {
  it("is never typed into a radio group", () => {
    const r = matchQuestion(q("radio", ["Yes", "No"]), A, undefined, prepared("Yes — BSc Computer Science, 2018."));
    expect(r).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("is never typed into a select", () => {
    const r = matchQuestion(q("select", ["Please select", "Yes", "No"]), A, undefined, prepared("No, but I hold an HND."));
    expect(r).toMatchObject({ kind: "choose", option: "No" });
  });

  it("a prose draft for a choice control goes to the candidate instead of being lost", () => {
    const r = matchQuestion(q("radio", ["Bachelor's", "Master's", "PhD"]), A, undefined, prepared("I studied Computer Science at Leeds."));
    expect(r).toMatchObject({ kind: "unanswerable", category: "unrecognised" });
    const plan = planAnswers([q("radio", ["Bachelor's", "Master's", "PhD"])], A, new Set(), undefined, prepared("I studied Computer Science at Leeds."));
    expect(plan.blocking).toHaveLength(1);
    expect(plan.answerable).toHaveLength(0);
  });

  it("still fills a text box with the draft", () => {
    expect(matchQuestion(q("textarea"), A, undefined, prepared("BSc Computer Science, 2018.")))
      .toMatchObject({ kind: "fill", value: "BSc Computer Science, 2018." });
  });
});
