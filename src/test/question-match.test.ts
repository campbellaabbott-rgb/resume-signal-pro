import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  matchQuestion,
  planAnswers,
  type StandingAnswers,
} from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";
import { breezy } from "../../worker/src/vendors/breezy.js";

/**
 * The screening-question matcher, tested against questions REAL forms asked.
 *
 * The fixture is a harvest of all 105 control groups across the 8 live Breezy
 * postings sampled on 2026-07-31 — the same 8 that produced the "3 of 8
 * completable" measurement. Nothing here is invented question text, because
 * invented question text is how you build a matcher that passes its own tests
 * and refuses every real form.
 */
const forms: Array<{ host: string; url: string; questions: DomQuestion[] }> = JSON.parse(
  readFileSync(resolve(__dirname, "../../worker/src/vendors/__fixtures__/breezy-questions.json"), "utf8"),
);

/**
 * Taken from the ADAPTER, never hand-typed.
 *
 * A hand-written copy is what produced this file's first wrong answer: it
 * listed cFirstName/cLastName/cPhone, the adapter targets cName/cPhoneNumber,
 * and the mismatch reported "Full Name" as the single largest blocker on forms
 * where the adapter had been filling it all along.
 */
const BREEZY_MAPPED = breezy.mappedNames;

const FULL: StandingAnswers = {
  fullName: "Alex Fairweather", firstName: "Alex", lastName: "Fairweather",
  email: "alex@example.com", phone: "+44 7700 900123",
  city: "Leeds", country: "United Kingdom", address: "12 Example Street",
  linkedin: "https://linkedin.com/in/example", website: "",
  coverNote: "A short note.", salaryExpectation: "£55,000",
  earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  shareDemographics: false, consentToProcessing: true,
};
const q = (over: Partial<DomQuestion> = {}): DomQuestion => ({
  name: "x", type: "text", required: true, label: "", options: [], ...over,
});

describe("what the matcher does with questions real forms actually asked", () => {
  it("resolves every required question to an answer or an explicit refusal — never silence", () => {
    for (const f of forms) {
      for (const dq of f.questions) {
        if (!dq.required || BREEZY_MAPPED.has(dq.name)) continue;
        const r = matchQuestion(dq, FULL);
        expect(r, `${f.host}: required "${dq.label || dq.name}" fell through to null`).not.toBeNull();
      }
    }
  });

  it("leaves the adapter's own fields alone instead of re-answering them", () => {
    // Breezy renders name, email, phone and address with placeholders and no
    // labels, all inside one wrapper. An enumerator that let a label leak
    // across siblings reported every one of them as "Full Name" — and a
    // matcher fed that types the candidate's name into their phone box.
    // The leak signature is one label claimed by several controls — a label
    // identifies exactly one thing, or it identifies nothing. (cSummary really
    // does carry its own "Work History" label, which is why this checks for
    // sharing rather than for absence.)
    for (const f of forms) {
      const seen = new Map<string, string>();
      for (const dq of f.questions) {
        if (!dq.label) continue;
        const prior = seen.get(dq.label);
        expect(prior, `${f.host}: "${dq.label}" labels both ${prior} and ${dq.name}`).toBeUndefined();
        seen.set(dq.label, dq.name);
      }
    }
    // And planAnswers must skip them entirely rather than resolve them.
    for (const f of forms) {
      const { answerable } = planAnswers(f.questions, FULL, BREEZY_MAPPED);
      for (const { q: dq } of answerable) {
        expect(BREEZY_MAPPED.has(dq.name), `${dq.name} is adapter-mapped and must not be re-answered`).toBe(false);
      }
    }
  });

  it("never returns an option the form does not offer", () => {
    // The failure this prevents is quiet: typing "Yes" into a <select> that
    // offers "Y"/"N" sets nothing, and the submission still looks fine to us.
    for (const f of forms) {
      for (const dq of f.questions) {
        const r = matchQuestion(dq, FULL);
        if (r?.kind !== "choose") continue;
        expect(dq.options, `${f.host}: "${r.option}" is not on the form`).toContain(r.option);
      }
    }
  });
});

describe("the refusals that keep a false statement out of an application", () => {
  it("refuses CURRENT salary while answering EXPECTED salary — on the same form", () => {
    // Both appeared on bidvestbank's form, sharing almost all their wording:
    //   "What is your current Total Cost To Company per annum"
    //   "What is your salary expectation Total Cost To Company per annum"
    // We hold an expectation and no current salary. Answering the first with
    // the second states a stranger's pay to their prospective employer.
    const all = forms.flatMap((f) => f.questions);
    const current = all.find((x) => /current Total Cost/i.test(x.label));
    const expected = all.find((x) => /salary expectation Total Cost/i.test(x.label));
    expect(current, "fixture must still hold the current-salary question").toBeTruthy();
    expect(expected, "fixture must still hold the expectation question").toBeTruthy();

    expect(matchQuestion(current!, FULL)).toMatchObject({ kind: "unanswerable", category: "salary-current" });
    expect(matchQuestion(expected!, FULL)).toMatchObject({ kind: "fill", value: "£55,000" });
  });

  it("refuses a required question it cannot read the label of", () => {
    // Two required yes/no <select>s in the sample had no reachable label.
    // Guessing from the name attribute or from position would be answering a
    // question we cannot see; there is no safe default for that.
    const blind = forms.flatMap((f) => f.questions).filter((x) => x.required && !x.label.trim());
    expect(blind.length, "fixture should still contain the unlabelled required controls").toBeGreaterThan(0);
    for (const dq of blind) {
      expect(matchQuestion(dq, FULL)).toMatchObject({ kind: "unanswerable", category: "unlabelled" });
    }
  });

  it("declines demographics when a decline option exists, and refuses when it does not", () => {
    // We store no race or gender, so declining is the ONLY answer available.
    const gender = q({ type: "radio", label: "Male", options: ["Male", "Female", "I don't wish to answer"] });
    expect(matchQuestion(gender, FULL)).toEqual({
      kind: "choose", category: "demographic-declined", option: "I don't wish to answer",
    });

    // The South African race question offered no decline. A genuine dead end.
    const race = q({ type: "radio", label: "Race", options: ["African", "Coloured", "Indian", "White", "Other"] });
    expect(matchQuestion(race, FULL)).toMatchObject({ kind: "unanswerable", category: "demographic" });

    // Opting in to sharing does NOT manufacture an answer — we still hold none.
    expect(matchQuestion(race, { ...FULL, shareDemographics: true }))
      .toMatchObject({ kind: "unanswerable", category: "demographic" });
  });

  it("identifies an EEO question from its options when the label is an option", () => {
    // Both race questions and one gender question rendered with the first
    // option's text where a legend should be. A label-only matcher reads
    // "White (not Hispanic or Latino)" as the question and can match it to
    // nothing — or worse, to something. Options are the reliable signal.
    const dq = q({
      type: "radio", label: "White (not Hispanic or Latino)",
      options: ["White (not Hispanic or Latino)", "Black or African-American (not Hispanic or Latino)",
                "Asian (not Hispanic or Latino)", "I don't wish to answer"],
    });
    expect(matchQuestion(dq, FULL)).toMatchObject({ kind: "choose", category: "demographic-declined" });
  });

  it("never fills an identity-document number", () => {
    const dq = q({ label: "ID Number" });
    expect(matchQuestion(dq, FULL)).toMatchObject({ kind: "unanswerable", category: "identity-document" });
    for (const label of ["Passport Number", "Social Security Number", "National Insurance No."]) {
      expect(matchQuestion(q({ label }), FULL)).toMatchObject({ kind: "unanswerable" });
    }
  });

  it("treats a never-stated boolean as unanswerable, not as 'No'", () => {
    // The trinary matters most here. Defaulting to false would have the agent
    // tell an employer a candidate is not authorised to work when they simply
    // never answered — a false statement, and one that ends the application.
    const auth = q({ type: "radio", label: "Are you legally authorized to work in the US?", options: ["Yes", "No"] });
    expect(matchQuestion(auth, { ...FULL, workAuthorized: null }))
      .toMatchObject({ kind: "unanswerable", category: "work-authorization" });
    expect(matchQuestion(auth, FULL)).toEqual({ kind: "choose", category: "work-authorization", option: "Yes" });
  });

  it("does not invert sponsorship, in either direction", () => {
    // Marex asked: "Will you now or in the future require Marex to commence an
    // immigration case…". Answering that as if it were an authorisation
    // question states the opposite of the truth on a question employers filter
    // hard on.
    const asks = q({ type: "radio", label: "Will you now or in the future require sponsorship for an employment visa?", options: ["Yes", "No"] });
    expect(matchQuestion(asks, FULL)).toMatchObject({ option: "No", category: "sponsorship" });

    // And the mirror phrasing, which means the same thing inverted.
    const inverted = q({ type: "radio", label: "Are you able to work without visa sponsorship?", options: ["Yes", "No"] });
    expect(matchQuestion(inverted, FULL)).toMatchObject({ option: "Yes", category: "sponsorship" });

    const needsIt = { ...FULL, requiresSponsorship: true };
    expect(matchQuestion(asks, needsIt)).toMatchObject({ option: "Yes" });
    expect(matchQuestion(inverted, needsIt)).toMatchObject({ option: "No" });
  });

  it("will not accept a privacy notice without an explicit opt-in", () => {
    const dq = q({ type: "checkbox", label: "I've read the Privacy Notice below and consent the processing of my data" });
    expect(matchQuestion(dq, { ...FULL, consentToProcessing: false }))
      .toMatchObject({ kind: "unanswerable", category: "consent-processing" });
    expect(matchQuestion(dq, FULL)).toEqual({ kind: "check", category: "consent-processing" });
  });

  it("leaves an unrecognised OPTIONAL question blank instead of refusing the packet", () => {
    const optional = q({ required: false, label: "How did you hear about this role?" });
    expect(matchQuestion(optional, FULL)).toBeNull();
    const required = q({ required: true, label: "How did you hear about this role?" });
    expect(matchQuestion(required, FULL)).toMatchObject({ kind: "unanswerable", category: "unrecognised" });
  });
});

describe("what this actually changes, measured on the same 8 postings", () => {
  it("lifts completable postings from 3 of 8 to 7 of 8", () => {
    // The number that justified the work, pinned exactly. Recorded here so a
    // regression shows up as the product getting worse rather than as a vague
    // test failure — and so a change that "improves" it has to explain which
    // extra posting it now answers, and with what.
    const completable = forms.filter(
      (f) => planAnswers(f.questions, FULL, BREEZY_MAPPED).blocking.length === 0,
    );
    expect(completable.length).toBe(7);
  });

  it("still blocks the postings that ask something we genuinely cannot answer", () => {
    // Not every form should pass. A matcher that clears all 8 has stopped
    // refusing, and the whole point is that it refuses correctly.
    const blocked = forms.filter(
      (f) => planAnswers(f.questions, FULL, BREEZY_MAPPED).blocking.length > 0,
    );
    expect(blocked.length, "if nothing blocks, the honesty fence has been removed").toBeGreaterThan(0);
  });

  it("a candidate who has filled in nothing gets fewer answers, not invented ones", () => {
    const EMPTY: StandingAnswers = {
      ...FULL, fullName: "", firstName: "", lastName: "", salaryExpectation: "",
      earliestStart: "", workAuthorized: null, requiresSponsorship: null,
      willingToRelocate: null, consentToProcessing: false,
    };
    for (const f of forms) {
      const { answerable } = planAnswers(f.questions, EMPTY, BREEZY_MAPPED);
      for (const { r } of answerable) {
        // Only two things are answerable with no profile at all, and neither
        // asserts anything about the candidate: declining a self-ID question,
        // and confirming the single location of the posting they already chose.
        expect(["demographic-declined", "role-location"], `answered "${r.category}" from an empty profile`)
          .toContain(r.category);
      }
    }
  });
});
