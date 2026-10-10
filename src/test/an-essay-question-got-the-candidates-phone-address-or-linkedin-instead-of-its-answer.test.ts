import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contactLabelIsAField as workerRule, matchQuestion, normaliseLabel, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { classifyQuestion, contactLabelIsAField as sheetRule } from "../../supabase/functions/_shared/application-questions";

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

/**
 * Review of the gate above: the worker took a label without "your" as a field
 * only at five words or fewer and the sheet's classifier at six, counted
 * differently. So an ordinary field with a hint was refused by the worker
 * (a required one blocked the send) while the sheet filled it from the
 * profile, and past six words the sheet asked the model to write the
 * candidate's phone or email. One rule now, the same block in both files.
 */
const HINTED_FIELDS: Array<[string, string, string]> = [
  ["Mobile phone number (including country code)", "phone", A.phone],
  ["Home Address (Street, City, State, Zip)", "address", A.address],
  ["Phone number (mobile preferred, include area code)", "phone", A.phone],
  ["Phone number where we can reach you during business hours", "phone", A.phone],
  ["Email address (we will send your interview invite here)", "email", A.email],
  ["Quel est votre numéro de téléphone ?", "phone", A.phone],
];

describe("a contact field with a hint is still a contact field, in both runtimes", () => {
  it.each(HINTED_FIELDS)("the worker fills %s", (label, category, value) => {
    expect(matchQuestion(ask(label, "text"), A)).toMatchObject({ kind: "fill", category, value });
  });

  it.each(HINTED_FIELDS)("the sheet calls %s identity, never a draft", (label) => {
    expect(classifyQuestion(label, "input_text")).toBe("identity");
  });

  it.each([
    "Email marketing tools you have used (list them)",
    "Experience with mobile development frameworks such as React Native or Flutter",
    "Portfolio management experience",
    "Phone-based support experience",
  ])("neither runtime takes %s for a contact field", (label) => {
    const r = matchQuestion(ask(label, "text"), A);
    expect(r && r.kind === "fill" ? r.value : null).not.toBeOneOf([A.phone, A.email, A.address, A.linkedin]);
    expect(classifyQuestion(label, "input_text")).not.toBe("identity");
  });
});

/**
 * Review of the rule above: it called every textarea and Ashby LongText a
 * prose box, so a bare "Phone", "Email" or "LinkedIn" on one (Greenhouse and
 * Ashby both render plain fields that way) became `draftable` and the model
 * was asked to write the candidate's contact details; the worker refused the
 * box as a contact field and then filled the model's draft into it. The label
 * says what the box is; the control type does not make a field prose.
 */
const BARE_CONTACT = ["LinkedIn", "Phone", "Phone number", "Email", "Portfolio", "GitHub", "Twitter", "Mobile", "Zip", "Postal code", "URL", "Address", "Street", "Address Line 1"];
const FROM_PROFILE: Array<[string, string, string]> = [
  ["Phone", "phone", A.phone], ["Phone number", "phone", A.phone], ["Mobile", "phone", A.phone],
  ["Email", "email", A.email], ["LinkedIn", "linkedin", A.linkedin], ["Zip", "postcode", A.postcode],
  ["Postal code", "postcode", A.postcode], ["Address", "address", A.address], ["Home address", "address", A.address],
  ["Mailing address", "address", A.address],
];

describe("a bare contact label on a long-text control is still a contact field", () => {
  for (const type of ["textarea", "LongText", "longtext"]) {
    it.each(BARE_CONTACT)(`the sheet never sends %s on a ${type} to the model`, (label) => {
      expect(classifyQuestion(label, type)).toBe("identity");
    });
  }

  it.each(BARE_CONTACT)("the worker never fills a drafted answer into %s on a textarea", (label) => {
    const r = withDraft(label, "textarea");
    expect(r && r.kind === "fill" ? r.value : null).not.toBe(DRAFT);
  });

  it.each(FROM_PROFILE)("the worker fills %s on a textarea from the profile", (label, category, value) => {
    expect(withDraft(label, "textarea")).toMatchObject({ kind: "fill", category, value });
  });

  it("an address split over lines takes the address on line 1 and never repeats it on line 2", () => {
    expect(matchQuestion(ask("Address Line 1", "text"), A)).toMatchObject({ kind: "fill", category: "address", value: A.address });
    const second = matchQuestion(ask("Address Line 2", "text"), A);
    expect(second && second.kind === "fill" ? second.value : null).not.toBe(A.address);
  });
});

describe("the worker and the sheet decide a contact field with one rule", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const START = "// ── CONTACT FIELD OR ESSAY:";
  const END = "// ── end of the contact-field rule ──";
  const blockOf = (src: string) => {
    const at = src.indexOf(START);
    const to = src.indexOf(END);
    if (at < 0 || to < at) throw new Error("the contact-field block is gone — RE-ANCHOR this guard");
    return src.slice(at, to);
  };

  it("the block is byte-identical in the two files", () => {
    const worker = blockOf(read("worker/src/questions/match.ts"));
    expect(worker.length).toBeGreaterThan(1000);
    expect(blockOf(read("supabase/functions/_shared/application-questions.ts"))).toBe(worker);
  });

  it("and both exports answer every label the same way", () => {
    const labels = [
      ...HINTED_FIELDS.map(([l]) => l), ...ESSAYS.map(([l]) => l),
      "Email Address", "Mobile Number", "Secondary contact number", "LinkedIn Profile URL", "Your phone number",
      "Emergency contact phone number", "Email marketing tools you have used (list them)",
      ...BARE_CONTACT, "Address Line 2", "Portfolio management experience",
    ];
    for (const type of ["text", "textarea", "LongText"]) {
      for (const l of labels) expect(workerRule(l, type), `${type}: ${l}`).toBe(sheetRule(l, type));
    }
  });
});
