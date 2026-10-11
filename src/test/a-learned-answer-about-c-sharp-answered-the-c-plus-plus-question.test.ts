import { describe, expect, it } from "vitest";
import { learnedFromRows, learnedKey } from "../../worker/src/questions/learned.js";
import { matchQuestion, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-048. learnedKey turned every character that is not a letter or a
 * digit into a space, so "C#", "C++" and "C" questions shared one key: a
 * candidate's learned "Yes" for commercial C# experience answered the C++
 * radio, and the second pending question merged into the first and was never
 * shown. ".NET" and "NET" collided the same way.
 */
const A: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "", country: "United States", address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
};
const radio = (label: string): DomQuestion => ({ name: "q", type: "radio", required: true, label, options: ["Yes", "No"] });

describe("C#, C++ and C are three questions", () => {
  it("each has its own key", () => {
    const keys = new Set([
      learnedKey("Do you have commercial experience with C#?"),
      learnedKey("Do you have commercial experience with C++?"),
      learnedKey("Do you have commercial experience with C?"),
    ]);
    expect(keys.size).toBe(3);
    expect(learnedKey("Have you shipped .NET services?")).not.toBe(learnedKey("Have you shipped NET services?"));
  });

  it("a learned Yes for C# does not answer the C++ question", () => {
    const learned = learnedFromRows([
      { key: learnedKey("Do you have commercial experience with C#?"), label: "Do you have commercial experience with C#?", kind: "choose", value: "Yes" },
    ]);
    expect(matchQuestion(radio("Do you have commercial experience with C++?"), A, learned))
      .toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(radio("Do you have commercial experience with C#?"), A, learned))
      .toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("a row stored under the old merged key is read by its own label", () => {
    const merged = "do you have commercial experience with c";
    const learned = learnedFromRows([
      { key: merged, label: "Do you have commercial experience with C#?", kind: "choose", value: "Yes" },
    ]);
    expect(matchQuestion(radio("Do you have commercial experience with C++?"), A, learned)).toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(radio("Do you have commercial experience with C#?"), A, learned)).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("an ordinary label keeps the key it always had", () => {
    expect(learnedKey("Are you available weekends?*Required")).toBe("are you available weekends");
    expect(learnedKey("Do you hold a Journeyman Electrician License?")).toBe("do you hold a journeyman electrician license");
  });
});
