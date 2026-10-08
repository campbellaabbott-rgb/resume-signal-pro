import { describe, expect, it } from "vitest";
import { matchQuestion, type StandingAnswers } from "../../worker/src/questions/match.js";
import type { DomQuestion } from "../../worker/src/vendors/enumerate-dom.js";

/**
 * Sweep S8-045. Role-location answers matched options by two-way substring
 * (option includes mine, or mine includes option): "UK" chose "Ukraine" even
 * with "United Kingdom" on offer, York chose "New York, NY", Atlanta chose
 * "LA", and the profile's own "US" chose "Australia". "Which country are you
 * based in?" was taken by the same rule instead of the identity country.
 */
const person = (city: string, country: string): StandingAnswers => ({
  fullName: "Alex Doe", firstName: "Alex", lastName: "Doe", email: "a@example.com", phone: "",
  city, country, address: "", postcode: "", linkedin: "", website: "",
  coverNote: "", salaryExpectation: "", earliestStart: "",
  workAuthorized: true, requiresSponsorship: false, willingToRelocate: null,
  workAuthorizedCountries: [], shareDemographics: false, consentToProcessing: false,
});
const select = (label: string, options: string[]): DomQuestion => ({ name: "loc", type: "select", required: true, label, options });

describe("a location is a whole place", () => {
  it("UK is the United Kingdom, never Ukraine", () => {
    expect(matchQuestion(select("Which country are you applying for?", ["Ukraine", "United Kingdom", "Germany"]), person("", "UK")))
      .toMatchObject({ kind: "choose", option: "United Kingdom" });
    expect(matchQuestion(select("Which country are you applying for?", ["Ukraine", "Germany"]), person("", "UK")))
      .toMatchObject({ kind: "unanswerable" });
  });

  it("York is not New York", () => {
    expect(matchQuestion(select("Which office are you applying for?", ["New York, NY", "Boston, MA"]), person("York", "")))
      .toMatchObject({ kind: "unanswerable" });
  });

  it("Atlanta is not LA, and Sunnyvale is not NY", () => {
    expect(matchQuestion(select("Which location are you interested in?", ["LA", "Chicago"]), person("Atlanta", "")))
      .toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(select("Which location are you interested in?", ["NY", "Chicago"]), person("Sunnyvale", "")))
      .toMatchObject({ kind: "unanswerable" });
  });

  it("US is not Australia", () => {
    expect(matchQuestion(select("Which country are you applying for?", ["Australia", "Canada"]), person("", "US")))
      .toMatchObject({ kind: "unanswerable" });
    expect(matchQuestion(select("Which country are you applying for?", ["Australia", "United States"]), person("", "US")))
      .toMatchObject({ kind: "choose", option: "United States" });
  });

  it("the candidate's city still picks its own office", () => {
    expect(matchQuestion(select("Which office are you applying for?", ["New York, NY", "Boston, MA"]), person("New York", "")))
      .toMatchObject({ kind: "choose", option: "New York, NY" });
    expect(matchQuestion(select("Which office are you applying for?", ["Leeds Office", "London, UK"]), person("Leeds", "")))
      .toMatchObject({ kind: "choose", option: "Leeds Office" });
  });

  it("a city that is not offered falls back to the country, as documented", () => {
    expect(matchQuestion(select("Which office are you applying for?", ["London, UK", "Berlin, Germany"]), person("Manchester", "United Kingdom")))
      .toMatchObject({ kind: "choose", option: "London, UK" });
  });
});

describe("where the candidate lives is the identity country", () => {
  it("a residence question picks the stated country, not an office", () => {
    expect(matchQuestion(select("Which country are you based in?", ["Ukraine", "United Kingdom"]), person("Leeds", "UK")))
      .toMatchObject({ kind: "choose", category: "country-of-residence", option: "United Kingdom" });
  });
});
