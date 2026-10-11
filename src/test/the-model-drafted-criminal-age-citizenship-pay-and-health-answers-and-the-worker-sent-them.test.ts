import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABOUT_WORK_DONE,
  classifyQuestion,
  OWN_STATUS,
  PROTECTED_DEMOGRAPHIC,
  PROTECTED_FACTUAL,
  RESUME_PROMPT,
  SENTENCE_BREAK,
  shapeModelAnswers,
} from "../../supabase/functions/_shared/application-questions";
import { matchQuestion, normaliseLabel, type StandingAnswers } from "../../worker/src/questions/match.js";
import { buildPacket } from "../../supabase/functions/_shared/submission-packet";
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
  // A résumé prompt that asks about the candidate's own status is still that.
  "Describe your experience with any criminal convictions you have",
  "Explain your criminal record",
  "Describe any medical conditions that may affect your work",
  // Review of S8-044: a sponsorship word with no immigration word beside it
  // fell to `unrecognised`, and the worker sent the model's draft.
  "Are you currently sponsored?",
  "Are you currently sponsored by your employer?",
  // Review of the work-done exemption: a résumé prompt with a second clause
  // about the candidate's own status or pay is that status question too.
  "What experience do you have and what is your hourly rate?",
  "Describe your experience, and confirm you are a U.S. citizen",
  "Tell us about your experience. Do you need a reasonable accommodation?",
  "How many years of experience do you have and do you hold a green card?",
  "Describe your experience and whether you hold a US passport",
  "Describe your experience with payroll, including your hourly rate",
  "Tell us about your experience. Green card holder?",
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
  // Review of the widening: work done in a protected topic's words was made
  // `factual`, never drafted, and a required one blocked the send.
  "Describe your experience with immigration law and visa petitions",
  "Describe your experience administering vaccinations to children",
  "Tell us about your experience processing payroll and wages",
  "Describe your experience with drug screening assays in a GLP lab",
  "What is your experience caring for pregnant patients?",
  "Describe your experience handling reasonable accommodation requests as an HR partner",
  // A sponsor word in a résumé prompt about work done stays draftable.
  "Describe your experience sponsoring H-1B visas for employees as an HR partner",
  // The compound-clause rule must not swallow a one-clause résumé question.
  "What experience do you have with immigration law?",
  // A dotted initialism or "e.g." does not end a sentence.
  "Describe your experience with U.S. immigration law (e.g. H-1B petitions)",
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

describe("a years question in a protected topic's words is a résumé question", () => {
  // The worker refuses every "how many years" label from the profile, drafted
  // or not; what matters here is that neither runtime calls it protected.
  it("the sheet drafts it and the worker does not hold it as protected", () => {
    const label = "How many years of experience do you have with the US tax code?";
    expect(classifyQuestion(label, "textarea")).toBe("draftable");
    expect(workerProtected.isProtectedQuestion(label)).toBe(false);
  });
});

describe("a sponsorship question with no immigration word is still the candidate's", () => {
  // "Will we have to sponsor you?" is "Will you require sponsorship?" asked
  // the other way round. The context gate turned it away, the server called it
  // draftable, and the worker filled the model's "No" for a candidate who
  // needs sponsorship.
  const label = "Will we have to sponsor you?";
  const radio: DomQuestion = { name: "q", type: "radio", required: true, label, options: ["Yes", "No"] };
  const needs: StandingAnswers = { ...FULL, requiresSponsorship: true };

  it("the worker answers it from what the candidate stated, never from the draft", () => {
    expect(matchQuestion(radio, needs, undefined, new Map([[normaliseLabel(label), "No, MODEL-WRITTEN"]])))
      .toMatchObject({ kind: "choose", category: "sponsorship", option: "Yes" });
  });

  it("the server never asks the model, and the sheet says the same", () => {
    expect(classifyQuestion(label, "radio")).toBe("factual");
    const p = buildPacket({
      questions: [{ label, required: true, fieldType: "radio" }],
      profile: { fullName: "Alex Doe", country: "United States" },
      standing: { workAuthorized: true, requiresSponsorship: true },
      drafted: [{ label, answer: "No, MODEL-WRITTEN", supported: true }],
      automationTier: "auto",
    });
    expect(p.fields.find((f) => f.key === label)).toMatchObject({ value: "Yes", source: "standing" });
  });
});

describe("the two runtimes hold one list", () => {
  it("the worker's protected patterns are the server's, character for character", () => {
    expect(workerProtected.PROTECTED_FACTUAL.source).toBe(PROTECTED_FACTUAL.source);
    expect(workerProtected.PROTECTED_DEMOGRAPHIC.source).toBe(PROTECTED_DEMOGRAPHIC.source);
    expect(workerProtected.RESUME_PROMPT.source).toBe(RESUME_PROMPT.source);
    expect(workerProtected.ABOUT_WORK_DONE.source).toBe(ABOUT_WORK_DONE.source);
    expect(workerProtected.OWN_STATUS.source).toBe(OWN_STATUS.source);
    expect(workerProtected.SENTENCE_BREAK.source).toBe(SENTENCE_BREAK.source);
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

/**
 * Sweeps S11-012 and S11-060, in the same corpus. Both runtimes are fed the
 * same label and must give the ANSWER written here, not merely agree.
 *
 * S11-012: an authorisation question carrying the employer's notice ("Please
 * note we are unable to sponsor visas") was read as a sponsorship question and
 * answered from requiresSponsorship, so a citizen said No and a visa-needer
 * said Yes. Sponsorship had or held now is history the profile does not state.
 *
 * S11-060: "this country" / "where this role is based" is the POSTING's
 * country; it was answered from the home-country boolean whatever the posting.
 */
type Person = { country: string; workAuthorized: boolean; requiresSponsorship: boolean };
const US_CITIZEN: Person = { country: "United States", workAuthorized: true, requiresSponsorship: false };
const US_NEEDS_VISA: Person = { country: "United States", workAuthorized: false, requiresSponsorship: true };
const UK_CITIZEN: Person = { country: "United Kingdom", workAuthorized: true, requiresSponsorship: false };
const DE_CITIZEN: Person = { country: "Germany", workAuthorized: true, requiresSponsorship: false };

const yesNo = (label: string): DomQuestion => ({ name: "q", type: "radio", required: true, label, options: ["Yes", "No"] });
function bothRuntimes(label: string, who: Person, postingCountry: string | null = null) {
  const r = matchQuestion(yesNo(label), { ...FULL, ...who, workAuthorizedCountries: [], postingCountry });
  const p = buildPacket({
    questions: [{ label, required: true, fieldType: "radio" }],
    profile: { fullName: "Alex Doe", country: who.country },
    standing: { workAuthorized: who.workAuthorized, requiresSponsorship: who.requiresSponsorship },
    drafted: [],
    automationTier: "auto",
    postingCountry,
  });
  return {
    worker: r && r.kind === "choose" ? r.option : r?.kind,
    sheet: p.fields.find((f) => f.key === label)?.value,
  };
}

describe("S11-012: the employer's sponsorship notice is not the question", () => {
  const WITH_NOTICE: Array<[string, Person, string]> = [
    ["Are you legally authorized to work in the United States? Please note we are unable to sponsor visas.", US_CITIZEN, "Yes"],
    ["Are you legally authorized to work in the United States? Please note we are unable to sponsor visas.", US_NEEDS_VISA, "No"],
    ["Are you legally authorised to work in the UK? We are unable to offer visa sponsorship for this role.", UK_CITIZEN, "Yes"],
    ["Are you eligible to work in Germany? Unfortunately, we cannot provide visa sponsorship.", DE_CITIZEN, "Yes"],
    ["Are you authorized to work in the US, as we are unable to sponsor visas?", US_CITIZEN, "Yes"],
    ["Are you authorized to work in the US, as we are unable to sponsor visas?", US_NEEDS_VISA, "No"],
    ["Visa sponsorship is not available for this position. Are you legally authorized to work in the United States?", US_CITIZEN, "Yes"],
    ["Are you legally authorized to work in the U.S.? (We do not sponsor work visas.)", US_NEEDS_VISA, "No"],
    // A sponsorship question with the same notice is still a sponsorship question.
    ["Will you now or in the future require visa sponsorship? Please note we are unable to sponsor.", US_CITIZEN, "No"],
    ["Will you now or in the future require visa sponsorship? Please note we are unable to sponsor.", US_NEEDS_VISA, "Yes"],
    // The plain questions, unchanged.
    ["Are you legally authorized to work in the United States?", US_CITIZEN, "Yes"],
    ["Do you require visa sponsorship to work in the US?", US_NEEDS_VISA, "Yes"],
    ["Are you able to work in the US without requiring visa sponsorship?", US_NEEDS_VISA, "No"],
  ];
  it.each(WITH_NOTICE)("%s (%j) -> %s in both runtimes", (label, who, want) => {
    expect(bothRuntimes(label, who)).toEqual({ worker: want, sheet: want });
  });

  it("the notice does not stand in for the question's own country", () => {
    const label = "Are you legally authorised to work in the UK? We are unable to offer visa sponsorship for this role.";
    expect(bothRuntimes(label, US_CITIZEN)).toEqual({ worker: "unanswerable", sheet: undefined });
  });

  it.each([
    "Have you ever been sponsored for an H-1B visa?",
    "Are you currently being sponsored for a work visa by your employer?",
    "Has a previous employer sponsored your work visa?",
    "Have you previously been sponsored for employment visa status?",
  ])("sponsorship history goes to the candidate in both runtimes: %s", (label) => {
    for (const who of [US_CITIZEN, US_NEEDS_VISA]) {
      expect(bothRuntimes(label, who)).toEqual({ worker: "unanswerable", sheet: undefined });
    }
  });
});

describe("S11-060: 'this country' is the posting's country", () => {
  const DEICTIC = [
    "Are you authorized to work in the country in which this job is located?",
    "Do you have the right to work in this country?",
    "Are you legally authorized to work where this role is based?",
  ];
  it.each(DEICTIC)("a UK candidate on a US posting is not answered from home: %s", (label) => {
    expect(bothRuntimes(label, UK_CITIZEN, "US")).toEqual({ worker: "unanswerable", sheet: undefined });
  });
  it.each(DEICTIC)("a UK candidate on a UK posting says Yes: %s", (label) => {
    expect(bothRuntimes(label, UK_CITIZEN, "GB")).toEqual({ worker: "Yes", sheet: "Yes" });
  });
  it.each(DEICTIC)("an unknown posting country is refused: %s", (label) => {
    expect(bothRuntimes(label, UK_CITIZEN, null)).toEqual({ worker: "unanswerable", sheet: undefined });
  });

  it("a sponsorship question about the role's country reads it too", () => {
    const label = "Will you require visa sponsorship to work in the country where this role is based?";
    expect(bothRuntimes(label, UK_CITIZEN, "US")).toEqual({ worker: "unanswerable", sheet: undefined });
    expect(bothRuntimes(label, UK_CITIZEN, "United Kingdom")).toEqual({ worker: "No", sheet: "No" });
  });

  it("the posting's country reaches both runtimes from the board row", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const agent = read("supabase/functions/apply-agent/index.ts");
    expect(agent).toMatch(/from\("job_board_postings"\)\s*\.select\("country"\)\.eq\("id", q\.posting_id\)/);
    expect(agent).toMatch(/buildPacket\(\{[^}]*postingCountry,?\s*\}\)/);
    const broker = read("supabase/functions/apply-broker/index.ts");
    expect(broker).toMatch(/from\("job_board_postings"\)\s*\.select\("country"\)\.eq\("id", row\.posting_id\)/);
    expect(broker).toMatch(/posting_country: postingCountry,/);
    expect(read("worker/src/index.ts")).toMatch(/postingCountry: claimed\.packet\?\.posting_country \?\? null,/);
  });
});
