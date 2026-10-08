import { describe, expect, it } from "vitest";
import { matchQuestion, normaliseLabel, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { classifyQuestion } from "../../supabase/functions/_shared/application-questions";

/**
 * Sweep S8-044. The contact patterns are ordinary words and ran before the
 * prepared draft was consulted, so essay questions were answered with profile
 * fields: "How would you address a conflict" got the home address, "mobile app
 * development" the phone number, "portfolio management" the LinkedIn URL,
 * "target close rate" the salary expectation, "sponsorship and partnership
 * programs" a "No", and "Emergency contact" the candidate's own phone. The
 * server's IDENTITY tokens did the same, marking such labels ready from the
 * profile with no model call.
 */
const A: StandingAnswers = {
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "alex@example.com", phone: "+1 555 0100",
  city: "Denver", country: "United States", address: "1 Main St", postcode: "80202",
  linkedin: "https://linkedin.com/in/alex", website: "", coverNote: "", salaryExpectation: "$90,000",
  earliestStart: "", workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
};
const DRAFT = "A grounded answer from the résumé.";
const ask = (label: string, type: DomQuestion["type"] = "textarea"): DomQuestion => ({ name: "q", type, required: true, label, options: [] });
const withDraft = (label: string, type: DomQuestion["type"] = "textarea") =>
  matchQuestion(ask(label, type), A, undefined, new Map([[normaliseLabel(label), DRAFT]]));

const ESSAYS: Array<[string, DomQuestion["type"]]> = [
  ["How would you address a conflict with a coworker?", "textarea"],
  ["Do you have experience with mobile app development?", "text"],
  ["Describe your experience with cell culture", "textarea"],
  ["Do you have experience with phone-based support?", "text"],
  ["Do you have portfolio management experience?", "text"],
  ["What is your target close rate?", "text"],
  ["Describe your experience with sponsorship and partnership programs", "textarea"],
];

describe("an essay question gets its drafted answer, not a profile field", () => {
  it.each(ESSAYS)("%s", (label, type) => {
    expect(withDraft(label, type)).toMatchObject({ kind: "fill", value: DRAFT });
  });

  it("an emergency contact is somebody else, not the candidate's own phone", () => {
    const r = matchQuestion(ask("Emergency contact phone number", "text"), A);
    expect(r && r.kind === "fill" ? r.value : null).not.toBe(A.phone);
  });
});

describe("real contact fields are still filled from the profile", () => {
  it.each([
    ["Email Address", "email", A.email],
    ["Mobile Number", "phone", A.phone],
    ["What is your current residential address?", "address", A.address],
    ["LinkedIn Profile URL", "linkedin", A.linkedin],
    ["Please share your LinkedIn profile URL", "linkedin", A.linkedin],
  ])("%s", (label, category, value) => {
    expect(matchQuestion(ask(label, "text"), A)).toMatchObject({ kind: "fill", category, value });
  });

  it("a real sponsorship question is still one", () => {
    expect(matchQuestion({ ...ask("Will you require visa sponsorship?", "radio"), options: ["Yes", "No"] }, A))
      .toMatchObject({ kind: "choose", category: "sponsorship", option: "No" });
  });

  it("a stated expected rate is still pay", () => {
    expect(matchQuestion(ask("What is your expected hourly rate?", "text"), A)).toMatchObject({ category: "salary-expected" });
  });
});

describe("the server classifier draws the same line", () => {
  it.each([
    "Do you have experience with mobile app development?",
    "Do you have portfolio management experience?",
    "How would you handle an angry customer email?",
  ])("drafts %s", (label) => {
    expect(classifyQuestion(label, "")).toBe("draftable");
  });

  it("stops at someone else's contact details", () => {
    expect(classifyQuestion("Emergency contact phone number", "")).toBe("factual");
    expect(classifyQuestion("Manager's email address", "")).toBe("factual");
  });

  it.each(["Mobile Number", "Secondary contact number", "Email", "Your phone number", "LinkedIn Profile"])(
    "%s is still identity", (label) => {
      expect(classifyQuestion(label, "")).toBe("identity");
    },
  );
});
