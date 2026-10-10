// Shortlist's redactor still sent common real headers to the model with the
// name in them. A trailing "Ma" or "Do" was stripped as a degree, so "Jack Ma"
// and "Anh Do" were never found. ", MD" and ", MS" after a name on line two
// read as a US state, so "Jane Doe, MD" was taken for a place. A two-word city
// heading the page ("New York, NY | phone | email", the Word page header) was
// taken for the name: the city was masked, the real name went through, and
// the audit still logged candidate_name. "GONZALEZ, Maria" and "J. R. Smith"
// were never found. Bare Indian and US phone numbers, "Ph:" and "M:" labels,
// a ZIP after a full state name, "34th St" addresses and name-bearing
// handles all passed. And a given name that is a month ("June Lee") erased
// "June 2012" from the employment history.

import { describe, it, expect } from "vitest";
import { redactForScoring } from "../../supabase/functions/_shared/redaction";

const feature = (r: ReturnType<typeof redactForScoring>, f: string) =>
  r.exclusionsApplied.find((e) => e.feature === f)?.count ?? 0;

describe("the candidate's name is found in these header shapes", () => {
  const shapes: Array<{ label: string; text: string; mustNotSurvive: RegExp; keeps?: string[] }> = [
    { label: "a surname that is also a degree abbreviation (Ma)", text: "Jack Ma\nSoftware Engineer\n\nJack Ma led the team.", mustNotSurvive: /\bJack\b|\bMa\b/ },
    { label: "a hyphenated given name before Ma", text: "Yo-Yo Ma\nCellist\n\nYo-Yo Ma performed.", mustNotSurvive: /Yo-Yo|\bMa\b/ },
    { label: "a surname that is also a degree abbreviation (Do)", text: "Anh Do\nAnalyst\n\nAnh Do built it.", mustNotSurvive: /\bAnh\b|Anh Do/ },
    { label: "an ALL-CAPS two-word name ending in MA", text: "JACK MA\nEngineer\n\nJack Ma shipped.", mustNotSurvive: /jack|\bma\b/i },
    { label: "a name with ', MD' on the second line above a city", text: "CURRICULUM VITAE\nJane Doe, MD\nBoston, MA\n\nDoe led the unit.", mustNotSurvive: /\bDoe\b|\bJane\b/, keeps: ["Boston, MA", ", MD"] },
    { label: "a name with ', MS' under a RESUME heading", text: "RESUME\nPriya Sharma, MS\n\nPriya Sharma built models", mustNotSurvive: /priya|sharma/i },
    { label: "a city, state, phone and email page header above the name", text: "New York, NY | 718-555-0199 | mg@gmail.com\nMaria Gonzalez\n\nMaria Gonzalez led", mustNotSurvive: /maria|gonzalez/i, keeps: ["New York, NY"] },
    { label: "a city and state with a middle dot above the name", text: "Los Angeles, CA · maria@x.com\nMaria Gonzalez\n\nMaria Gonzalez led", mustNotSurvive: /maria|gonzalez/i, keeps: ["Los Angeles, CA"] },
    { label: "a city and country above the name", text: "Rio de Janeiro, Brazil | +55 21 99876 5432\nAna Souza\n\nAna Souza led", mustNotSurvive: /\bAna\b|souza/i, keeps: ["Rio de Janeiro, Brazil"] },
    { label: "a town in a state whose code is also a degree, above the name", text: "Silver Spring, MD | 301-555-0100\nJane Doe\n\nJane Doe led", mustNotSurvive: /\bJane\b|\bDoe\b/, keeps: ["Silver Spring, MD"] },
    { label: "a surname-first ALL-CAPS surname", text: "GONZALEZ, Maria\nEngineer\n\nGonzalez led the rollout.", mustNotSurvive: /gonzalez|maria/i },
    { label: "two initials and a surname", text: "J. R. Smith\nEngineer\n\nSmith led the rollout.", mustNotSurvive: /smith/i },
  ];
  for (const s of shapes) {
    it(`masks ${s.label}`, () => {
      const r = redactForScoring(s.text);
      expect(r.redacted).not.toMatch(s.mustNotSurvive);
      expect(feature(r, "candidate_name")).toBeGreaterThan(0);
      for (const k of s.keeps ?? []) expect(r.redacted).toContain(k);
    });
  }

  it("takes a doctor's name line over a hospital on the next line", () => {
    const r = redactForScoring("Jane Doe, MD\nJohns Hopkins Hospital\nBaltimore, MD 21287\n\nDoe ran the cardiology unit.");
    expect(r.redacted).not.toMatch(/\bDoe\b|\bJane\b/);
    expect(r.redacted).toContain("Johns Hopkins Hospital");
  });

  it("does not log a name when the only name-shaped line is a city", () => {
    const r = redactForScoring("San Francisco, CA | 415-555-0100\nSENIOR SOFTWARE ENGINEER\n\nBuilt payment systems at three startups.");
    expect(r.redacted).toContain("San Francisco, CA");
    expect(feature(r, "candidate_name")).toBe(0);
  });
});

describe("these contact shapes do not reach the model", () => {
  it("strips Indian-style labels and a bare ten-digit number in the header", () => {
    const r = redactForScoring("Priya Sharma\nContact No: 9876543210\nPh: 9876543211\nM: 9876543212\n9876543213\n\nData engineer.");
    expect(r.redacted).not.toMatch(/987654321\d/);
    expect(feature(r, "phone")).toBe(4);
    expect(r.redacted).toContain("Data engineer.");
  });

  it("strips an unseparated US number, a 5-5 split number and a dotted one in the header", () => {
    const r = redactForScoring("Maria Gonzalez\nmaria@x.com | 7185550199 | Brooklyn, NY 11215\n98765 43210 | 555.0100.199\n\nMarketing manager.");
    expect(r.redacted).not.toMatch(/7185550199|98765|43210|555\.0100|11215/);
    expect(r.redacted).toContain("Brooklyn, NY");
  });

  it("strips a ZIP after a full state name and an address on an ordinal street", () => {
    const r = redactForScoring("Maria Gonzalez\nAustin, Texas 78701\n45 W 34th St, New York\n\nMarketing manager.");
    expect(r.redacted).not.toMatch(/78701|34th/);
    expect(r.redacted).toContain("Austin, Texas");
    expect(feature(r, "street_address")).toBe(1);
  });

  it("strips a personal site on a hosting subdomain and an @handle in the header", () => {
    const r = redactForScoring("Maria Gonzalez\nmariag.vercel.app | portfolio.netlify.app | @mgonz_designs\n\nDesigner.");
    expect(r.redacted).not.toMatch(/vercel|netlify|mgonz/);
  });

  it("masks a handle built from the name anywhere in the body", () => {
    const body = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of experience.`).join("\n");
    const r = redactForScoring(`Maria Gonzalez\nDesigner\n${body}\nFollow @mariagonzalez and see maria_gonzalez.dev or mgonzalez on Dribbble.`);
    expect(r.redacted).not.toMatch(/mariagonzalez|maria_gonzalez|mgonzalez/i);
  });

  it("keeps a header line of years, which is not a phone number", () => {
    const r = redactForScoring("Maria Gonzalez\nDean's List 2015 2016 2017\n\nDesigner.");
    expect(r.redacted).toContain("2015 2016 2017");
  });
});

describe("a given name that is a month keeps the employment dates", () => {
  const history = "Senior Engineer, Acme Corp, Jan 2018 – Present\nEngineer, Initech, May 2015 – Dec 2017\nAnalyst, Globex, June 2012 – April 2015\nIntern, Hooli, Jan–Jun 2011";
  for (const name of ["Jan Kowalski", "May Chen", "June Lee", "April Smith"]) {
    it(`keeps every date for ${name}, and masks the name`, () => {
      const given = name.split(" ")[0];
      const r = redactForScoring(`${name}\nEngineer\n\n${history}\n${given} led the migration.`);
      for (const line of history.split("\n")) expect(r.redacted).toContain(line);
      expect(r.redacted).toContain("[CANDIDATE] led the migration.");
      expect(r.redacted).not.toContain(name.split(" ")[1]);
    });
  }
});
