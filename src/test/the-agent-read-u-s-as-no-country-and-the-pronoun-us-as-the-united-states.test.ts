import { describe, expect, it } from "vitest";
import { matchQuestion, type StandingAnswers } from "../../worker/src/questions/match.js";
import { countriesIn, toCode } from "../../worker/src/questions/countries.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-007. The work-authorisation country check turned every "." into a
 * space before matching, so "U.S.", "U.S.A." and "U.K." could never match an
 * alias: the question read as naming no country and was answered from the
 * candidate's home-country boolean. A UK candidate who never claimed US work
 * rights answered "Yes" to "authorized to work in the U.S.?". The bare alias
 * "us" also matched the pronoun, and one covered country was enough for a Yes
 * to a question naming two.
 */
const person = (country: string, extra: string[] = []): StandingAnswers => ({
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city: "", country, address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: extra, shareDemographics: false, consentToProcessing: false,
});
const ask = (label: string): DomQuestion => ({ name: "auth", type: "radio", required: true, label, options: ["Yes", "No"] });

describe("a dotted country name is a country", () => {
  it.each([
    "Are you legally authorized to work in the U.S.?",
    "Are you legally authorized to work in the U.S.A.?",
    "Are you legally authorized to work in the U.S?",
  ])("a UK candidate is not made to claim US work rights: %s", (label) => {
    expect(countriesIn(label)).toEqual(["US"]);
    expect(matchQuestion(ask(label), person("United Kingdom"))).toMatchObject({ kind: "unanswerable", category: "work-authorization" });
  });

  it("a US candidate is not made to claim UK work rights", () => {
    const label = "Do you have the right to work in the U.K.?";
    expect(countriesIn(label)).toEqual(["GB"]);
    expect(matchQuestion(ask(label), person("United States"))).toMatchObject({ kind: "unanswerable" });
  });

  it("the candidate's own dotted country still answers", () => {
    expect(toCode("U.S.")).toBe("US");
    expect(matchQuestion(ask("Are you legally authorized to work in the U.S.?"), person("U.S.")))
      .toMatchObject({ kind: "choose", option: "Yes" });
    expect(matchQuestion(ask("Are you legally authorized to work in the U.S.?"), person("United Kingdom", ["US"])))
      .toMatchObject({ kind: "choose", option: "Yes" });
  });
});

describe("the pronoun us is not the United States", () => {
  it("work for us in Germany is a question about Germany only", () => {
    const label = "Are you legally authorized to work for us in Germany?";
    expect(countriesIn(label)).toEqual(["DE"]);
    expect(matchQuestion(ask(label), person("United States"))).toMatchObject({ kind: "unanswerable" });
  });

  it.each([
    ["Allow us to process your personal information", []],
    ["Why do you want to join us?", []],
    ["Tell us whether you are authorised to work in Canada", ["CA"]],
  ])("%s names %j", (label, codes) => {
    expect(countriesIn(label)).toEqual(codes);
  });

  it.each([
    "Are you authorized to work in the US?",
    "Are you authorized to work in the us?",
    "ARE YOU AUTHORIZED TO WORK IN THE US?",
    "Will you require US visa sponsorship?",
  ])("the country is still read where the label means it: %s", (label) => {
    expect(countriesIn(label)).toContain("US");
  });
});

describe("a question naming two countries needs both", () => {
  it("a candidate authorised only in the US cannot answer Yes for the US and Canada", () => {
    const label = "Are you legally authorized to work in the US and Canada?";
    expect(matchQuestion(ask(label), person("United States"))).toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(ask(label), person("United States", ["CA"]))).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("Latin America is not the United States", () => {
    expect(countriesIn("Are you authorized to work in Latin America?")).not.toContain("US");
  });
});

/**
 * Review of the fix above: taking "America" out of "Latin America" left those
 * labels naming NO country, so they were answered from the home-country
 * boolean and a UK candidate claimed North and Latin American work rights.
 * And requiring every named country turned a true Yes to "the UK or the EU"
 * into a refusal.
 */
describe("a named region is asked, never absent", () => {
  it.each([
    ["Are you legally authorized to work in North America?", "work-authorization"],
    ["Are you authorized to work in Latin America?", "work-authorization"],
    ["Are you legally authorized to work in South America without sponsorship?", "sponsorship"],
    ["Do you require sponsorship to work in North America?", "sponsorship"],
    ["Are you authorized to work in Central America or LATAM?", "work-authorization"],
  ])("a UK candidate refuses: %s", (label, category) => {
    expect(countriesIn(label).length).toBeGreaterThan(0);
    expect(matchQuestion(ask(label), person("United Kingdom"))).toMatchObject({ kind: "unanswerable", category });
  });

  it("North America is the US, Canada and Mexico, each one stated", () => {
    const label = "Are you legally authorized to work in North America?";
    expect(matchQuestion(ask(label), person("United States"))).toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(ask(label), person("United States", ["CA", "MX"]))).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it("Latin America is answered by no single stated country", () => {
    expect(matchQuestion(ask("Are you authorized to work in Latin America?"), person("Brazil", ["MX", "AR", "CL", "CO"])))
      .toMatchObject({ kind: "unanswerable" });
  });
});

describe("places joined by 'or' are met by one, 'and' by all", () => {
  it.each([
    "Do you have the right to work in the UK or EU?",
    "Are you authorised to work in the UK or Ireland?",
    "Are you authorised to work in either the UK or the EU?",
  ])("a UK candidate says a true Yes: %s", (label) => {
    expect(matchQuestion(ask(label), person("United Kingdom"))).toMatchObject({ kind: "choose", option: "Yes" });
  });

  it.each([
    "Are you authorised to work in the UK and Ireland?",
    "Are you authorized to work in the UK or do you need a visa for Ireland?",
  ])("anything but 'or' between them needs every place: %s", (label) => {
    expect(matchQuestion(ask(label), person("United Kingdom"))).toMatchObject({ kind: "unanswerable" });
  });

  it("a sponsorship No would speak for every place, so 'or' is not enough there", () => {
    expect(matchQuestion(ask("Do you require sponsorship to work in the UK or EU?"), person("United Kingdom")))
      .toMatchObject({ kind: "unanswerable", category: "sponsorship" });
  });

  it("a candidate with neither place still refuses", () => {
    expect(matchQuestion(ask("Are you authorized to work in the US or Canada?"), person("Germany")))
      .toMatchObject({ kind: "unanswerable" });
  });
});
