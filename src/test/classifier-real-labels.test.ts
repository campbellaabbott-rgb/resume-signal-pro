/**
 * The question classifier, measured against REAL employer wording.
 *
 * Every label below was harvested from a live Breezy or Pinpoint apply form on
 * 2026-08-01 — the first day the agent could see real questions on those
 * vendors at all. Until then it only ever saw four generic ones (name, email,
 * phone, résumé), so every pattern in the classifier had been written against
 * phrasings we imagined. Employers do not use them.
 *
 * BOTH DIRECTIONS ARE HERE ON PURPOSE, and the second list matters more.
 * Routing a question to `factual` means the agent refuses it unless a standing
 * answer covers it. Over-widening the patterns would block most of a form, the
 * agent would refuse nearly everything, and the symptom would be an absence of
 * applications — which is indistinguishable from a quiet job market.
 */
import { describe, it, expect } from "vitest";
import { classifyQuestion } from "../../supabase/functions/_shared/application-questions";

/** Real labels an LLM must NEVER write an answer to. */
const MUST_NOT_DRAFT: Array<[string, string]> = [
  // The candidate already answered this in their apply profile. Drafting it is
  // not merely a guess — it overrides a fact they stated.
  ["If offered the position, what is the earliest date you could start?", "factual"],
  ["What days are you available to work?", "factual"],
  ["Are you over 18 years old?", "factual"],
  ["Are you Willing to travel to different centers?", "factual"],
  ["Are you willing to work in another location? If yes, where?", "factual"],
  // Credentials. Claiming one the candidate lacks is not a small error.
  ["Do you hold a full and valid UK driving licence?", "factual"],
  ["What category is your HGV/LGV licence?", "factual"],
  ["Do you have a current Washington medical assistant registered or certified license?", "factual"],
  ["Do you have any unspent criminal convictions that may affect your application?", "factual"],
  // A THIRD PARTY's name. A model asked to fill this invents a person.
  ["If a current skipper referred you, please list their name.", "factual"],
  ["Please provide the name and department of the dnata colleague that referred you", "factual"],
  ["Do you have a close relative who is a current MCA/MCC staff or contractor?", "factual"],
  // Immigration status, phrased the way employers actually phrase it.
  ["If yes, kindly specify what kind of legal authorization you possess", "factual"],
  // The agent knows the true answer (our board) but must not assert it.
  ["How did you learn about this job opportunity? Please select or specify", "factual"],
  // Contact details come from the profile, never from prose generation.
  ["Secondary contact number", "identity"],
];

/**
 * Real labels that MUST stay draftable. These are answerable from a résumé,
 * and a classifier that swallowed them would turn the feature off silently.
 */
const MUST_STAY_DRAFTABLE = [
  "Walk me through your last role where you were directly responsible for managing closers",
  "What was your average close rate across your team, and what specific actions did you take?",
  "Describe customer service experience you have and how it is transferrable to this role",
  "Do you have 1+ years experience in a medical setting preferred?",
  "Do you have Medical Terminology knowledge?",
  "Do you have EMR experience?, if yes which ones?",
  "Please describe your proficiency in the French language",
  "Which of the following Microsoft Office programs do you have direct experience with?",
  "How many years of professional experience do you have in a related field?",
  "Why do you want to join Reiss?",
  "In three words, describe how you deliver exceptional service to your customers",
  "Describe a time you coordinated with government stakeholders, donors, or country partners",
  "What does providing a great experience for the dogs in our care mean to you?",
];

describe("classifier vs real employer wording — refusals", () => {
  it.each(MUST_NOT_DRAFT)("never drafts %s", (label, expected) => {
    expect(classifyQuestion(label, "")).toBe(expected);
  });
});

describe("classifier vs real employer wording — must stay answerable", () => {
  it.each(MUST_STAY_DRAFTABLE)("still drafts: %s", (label) => {
    expect(classifyQuestion(label, "")).toBe("draftable");
  });

  it("keeps most of a real form draftable", () => {
    // Guards the whole direction rather than individual strings: if a future
    // pattern swallows the corpus, the agent stops applying and nothing else
    // here would notice.
    const drafted = MUST_STAY_DRAFTABLE.filter((l) => classifyQuestion(l, "") === "draftable");
    expect(drafted.length).toBe(MUST_STAY_DRAFTABLE.length);
  });
});

describe("the distinction the patterns rest on", () => {
  it("separates holding a credential from having experience", () => {
    // "licence" is the signal; "experience"/"knowledge" must not be.
    expect(classifyQuestion("Do you hold a valid driving licence?", "")).toBe("factual");
    expect(classifyQuestion("Do you have driving experience?", "")).toBe("draftable");
  });

  it("separates a third party's name from the candidate's own", () => {
    expect(classifyQuestion("Who referred you to this role?", "")).toBe("factual");
    expect(classifyQuestion("Full name", "")).toBe("identity");
  });

  it("does not let 'name a project' become a name field", () => {
    // Pre-existing guard, kept under test because the new patterns sit near it.
    expect(classifyQuestion("Name a project you're proud of", "")).toBe("draftable");
  });
});
