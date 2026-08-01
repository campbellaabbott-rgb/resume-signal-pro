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
  city: "Leeds", country: "United Kingdom", address: "12 Example Street", postcode: "LS1 4AP",
  linkedin: "https://linkedin.com/in/example", website: "",
  coverNote: "A short note.", salaryExpectation: "£55,000",
  earliestStart: "4 weeks",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: true,
  // A UK-based candidate who has ALSO explicitly stated US authorisation. The
  // sample contains US postings, and without this the fixture would represent
  // somebody answering questions about a country they never claimed — which is
  // now correctly refused, and is covered by its own describe block below.
  workAuthorizedCountries: ["US"],
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
    // A real label from the harvested corpus, and one nothing on a standing
    // profile can honestly answer. The old label here was "How did you hear
    // about this role?", which the matcher now DOES answer — so it stopped
    // testing the thing it was named after.
    const optional = q({ required: false, label: "Do you have a Journeyman Electrician License?" });
    expect(matchQuestion(optional, FULL)).toBeNull();
    const required = q({ required: true, label: "Do you have a Journeyman Electrician License?" });
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
    // WRITTEN OUT IN FULL, not `...FULL` with a few keys blanked. The spread
    // version silently kept an email, a phone, an address and a cover note, so
    // "a candidate who has filled in nothing" was nothing of the sort and the
    // test only passed because the matcher could not yet read those labels.
    // Spelled out, a new field on StandingAnswers fails to compile here until
    // somebody decides what empty means for it.
    const EMPTY: StandingAnswers = {
      fullName: "", firstName: "", lastName: "", email: "", phone: "",
      city: "", country: "", address: "", postcode: "", linkedin: "", website: "",
      coverNote: "", salaryExpectation: "", earliestStart: "",
      workAuthorized: null, requiresSponsorship: null, willingToRelocate: null,
      workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
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

describe("work authorisation is country-specific, and a boolean is not", () => {
  /**
   * FOUND 2026-08-01 IN SHIPPED CODE. `workAuthorized` was one global boolean
   * answering every authorisation question, so a UK-authorised candidate
   * answered "Yes" to "Are you legally authorized to work in the US?".
   *
   * That is a false claim about someone's immigration status, made to an
   * employer under their real name, on the question employers filter hardest
   * on. Worse than not applying.
   */
  const uk = (countries: string[] = []): StandingAnswers => ({
    ...FULL, country: "United Kingdom", workAuthorized: true,
    requiresSponsorship: false, workAuthorizedCountries: countries,
  });
  const ask = (label: string) =>
    q({ type: "radio", label, options: ["Yes", "No"] });

  it("refuses a country the candidate never claimed", () => {
    for (const label of [
      "Are you legally authorized to work in the US?",
      "Work authorization in Germany:",
      "Are you legally authorised to work in Australia?",
      "Do you have the right to work in Canada?",
    ]) {
      expect(matchQuestion(ask(label), uk()), label)
        .toMatchObject({ kind: "unanswerable", category: "work-authorization" });
    }
  });

  it("answers for the country the candidate actually stated", () => {
    expect(matchQuestion(ask("Do you have the right to work in the United Kingdom?"), uk()))
      .toMatchObject({ kind: "choose", option: "Yes" });
    // And for one they explicitly added.
    expect(matchQuestion(ask("Are you legally authorized to work in the US?"), uk(["US"])))
      .toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("does not treat the UK as covering an EU/EEA question", () => {
    // The reason this is a list and not a guess. "Europe" and "the UK" stopped
    // being interchangeable in 2020, and an adapter that assumes otherwise
    // states a right to work that does not exist.
    expect(matchQuestion(ask("Do you have the right to work in the EU/EEA?"), uk()))
      .toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(ask("Do you have the right to work in the EU/EEA?"), uk(["IE"])))
      .toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("applies the same rule to sponsorship", () => {
    // "Will you require sponsorship to work in the US?" is as country-specific
    // as the authorisation question, and was answered from the same global flag.
    expect(matchQuestion(ask("Will you now or in the future require sponsorship to work in the US?"), uk()))
      .toMatchObject({ kind: "unanswerable", category: "sponsorship" });
    expect(matchQuestion(ask("Will you require UK visa sponsorship?"), uk()))
      .toMatchObject({ kind: "choose", option: "No" });
  });

  it("does not attach a country to a question that names none", async () => {
    // "us" must not match inside "industry", "discuss" or "customer" — a
    // substring match would silently make unrelated questions country-specific.
    const { countriesIn } = await import("../../worker/src/questions/countries.js");
    expect(countriesIn("How many years in the industry do you have?")).toEqual([]);
    expect(countriesIn("Discuss your customer service experience")).toEqual([]);
    expect(countriesIn("Are you authorized to work in the US?")).toContain("US");
  });
});

/**
 * The account UI offers a fixed list of countries. The matcher has its own.
 * Two hand-maintained lists that must agree is exactly the shape that has gone
 * wrong here before — so this asserts agreement rather than assuming it.
 */
describe("the countries the UI offers are countries the matcher understands", () => {
  it("offers no country the matcher cannot resolve", async () => {
    const { WORK_COUNTRIES } = await import("../components/account/ApplyProfilePanel");
    const { KNOWN_COUNTRY_CODES } = await import("../../worker/src/questions/countries.js");
    const known = new Set(KNOWN_COUNTRY_CODES);
    const orphans = WORK_COUNTRIES.filter((c) => !known.has(c.code)).map((c) => c.code);
    // An orphan is not a cosmetic mismatch: the candidate ticks it, believing
    // they have stated authorisation, and every question about that country is
    // then refused as though they had said nothing.
    expect(orphans).toEqual([]);
  });

  it("a ticked country actually unlocks that country's question", async () => {
    const { WORK_COUNTRIES } = await import("../components/account/ApplyProfilePanel");
    // End-to-end through the real matcher, for every chip on the panel — the
    // subset check above proves the codes line up, this proves they DO
    // something. A code can be known to `countriesIn` and still never be
    // reached by a question, which the set comparison alone would not catch.
    for (const c of WORK_COUNTRIES) {
      const q = { name: "auth", type: "radio", required: true,
        label: `Are you legally authorised to work in ${c.name}?`, options: ["Yes", "No"] };
      const withIt = matchQuestion(q, { ...FULL, country: "Atlantis",
        workAuthorizedCountries: [c.code] });
      expect(withIt?.kind, `${c.code} should be answerable once ticked`).toBe("choose");
    }
  });
});

/**
 * Everything in this block came from measuring 29 live forms, not from
 * guessing. The labels are verbatim from the harvest.
 */
describe("the question types the corpus actually contains", () => {
  it("recognises a consent tickbox that says information rather than data", () => {
    // The single most common unrecognised REQUIRED question in the corpus, 5
    // occurrences, and one the matcher already knew how to answer — it missed
    // only because the pattern demanded the word "data".
    const r = matchQuestion(q({ type: "checkbox", required: true,
      label: "Allow us to process your personal information." }), FULL);
    expect(r?.category).toBe("consent-processing");
    expect(r?.kind).toBe("check");
  });

  it("fills contact details the adapter did not map, by label", () => {
    // One live Breezy form carried 27 required custom fields, every one of them
    // an answer already on file and every one of them refused.
    const cases: Array<[string, string, string]> = [
      ["Email Address", "email", FULL.email],
      ["Mobile Number", "phone", FULL.phone],
      ["Your Complete Legal Name", "full-name", FULL.fullName],
      ["What is your current residential address?", "address", FULL.address],
      ["Zipcode", "postcode", FULL.postcode],
      ["City", "city", FULL.city],
      // FULL has no website, so this exercises the LinkedIn fallback — both
      // are honest answers to "your online presence", and the explicit
      // preference is asserted separately below.
      ["Your Online Portfolio", "portfolio", FULL.linkedin],
    ];
    for (const [label, category, value] of cases) {
      const r = matchQuestion(q({ required: true, label }), FULL);
      expect(r, label).toMatchObject({ kind: "fill", category, value });
    }
  });

  it("prefers a personal website over LinkedIn when both are on file", () => {
    const withSite = { ...FULL, website: "https://alex.example" };
    expect(matchQuestion(q({ required: true, label: "Your Online Portfolio" }), withSite))
      .toMatchObject({ category: "portfolio", value: "https://alex.example" });
  });

  it("does not read \"Email Address\" as a street address", () => {
    // Order-dependent and easy to break: both labels contain "address", and a
    // street address in an email field is an application nobody can reply to.
    expect(matchQuestion(q({ required: true, label: "Email Address" }), FULL))
      .toMatchObject({ category: "email", value: FULL.email });
  });

  it("never invents a postcode out of the address line", () => {
    const noPostcode = { ...FULL, postcode: "" };
    const r = matchQuestion(q({ required: true, label: "Zipcode" }), noPostcode);
    // FULL.address is "12 Example Street, LS1 4AP"-shaped in real life, and a
    // parser would happily produce something. A wrong postcode on someone's
    // application is worse than an admitted blank.
    expect(r).toMatchObject({ kind: "unanswerable", category: "postcode" });
  });

  it("refuses date of birth and referees outright", () => {
    expect(matchQuestion(q({ required: true, label: "When is your birthday?" }), FULL))
      .toMatchObject({ kind: "unanswerable", category: "date-of-birth" });
    // Another person's contact details are that person's to give.
    expect(matchQuestion(q({ required: true, label: "Character Reference #1" }), FULL))
      .toMatchObject({ kind: "unanswerable", category: "referee" });
  });

  it("refuses years-of-experience rather than answering it from a career total", () => {
    // The obvious build was a yearsExperience number. Every real example shows
    // why that would be the country bug again — one global value answering a
    // specific question.
    for (const label of [
      "How many years' experience in commercial and/or industrial electrical work do you have?",
      "How many years of experience do you have in a GMP-regulated pharmaceutical manufacturing environment?",
    ]) {
      expect(matchQuestion(q({ required: true, label }), FULL), label)
        .toMatchObject({ kind: "unanswerable", category: "years-experience" });
    }
  });

  it("answers where-did-you-hear truthfully, and refuses when the truth is not on the list", () => {
    const free = matchQuestion(q({ required: true, label: "Where did you hear about this job opportunity?" }), FULL);
    expect(free).toMatchObject({ kind: "fill", category: "heard-about", value: "Job board" });

    const listed = matchQuestion(q({ required: true, type: "select",
      label: "How did you get to know about this role?",
      options: ["Referral", "Job board", "Careers fair"] }), FULL);
    expect(listed).toMatchObject({ kind: "choose", option: "Job board" });

    // No honest option: refuse rather than pick whichever sounds best.
    const noneFit = matchQuestion(q({ required: true, type: "select",
      label: "How did you get to know about this role?",
      options: ["A friend who works here", "A recruiter contacted me"] }), FULL);
    expect(noneFit).toMatchObject({ kind: "unanswerable", category: "heard-about" });
  });

  it("treats \"do you need a work permit\" as the sponsorship question it is", () => {
    // Verbatim from a Maltese Teamtailor posting. The candidate has not stated
    // Malta, so this must refuse rather than answer from a UK boolean.
    const r = matchQuestion(q({ required: true, type: "radio",
      label: "Do you need a work permit to work in Malta?", options: ["Yes", "No"] }), FULL);
    expect(r).toMatchObject({ kind: "unanswerable", category: "sponsorship" });
    expect((r as { why: string }).why).toContain("MT");
  });

  it("refuses an extra document slot rather than putting the résumé in it", () => {
    // The Personio near-miss: attaching the CV to whichever file input happened
    // to be present would file it under "employment reference" and leave the CV
    // slot empty, while looking to us like it worked.
    expect(matchQuestion(q({ required: true, type: "file", label: "Qualifications Attachment" }), FULL))
      .toMatchObject({ kind: "unanswerable", category: "extra-document" });
  });
});
