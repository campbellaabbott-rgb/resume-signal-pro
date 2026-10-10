/**
 * THE PREMIUM CONTACT GUARD DELETED THE BUYER'S OWN PHONE AND PROFILES
 * (sweep S8-033).
 *
 * The $12 Premium Package strips any phone or URL the original résumé does
 * not contain, so an invented linkedin.com/in/... cannot ship. It compared
 * literal substrings: when the model normalised "555-010-0199" to
 * "(555) 010-0199", or wrote the candidate's LinkedIn and GitHub with
 * https://www. or a trailing slash, the buyer's own details were removed from
 * the résumé that was emailed and saved.
 */
import { describe, expect, it } from "vitest";
import { stripInventedContact } from "../../supabase/functions/generate-premium-package/contact-guard";

const ORIGINAL = `Jane Smith
555-010-0199 | jane.smith@gmail.com | linkedin.com/in/janesmith | github.com/jsmith
Senior engineer.`;

describe("the contact guard compares contact details in canonical form", () => {
  it("keeps the buyer's phone, LinkedIn and GitHub when the model only reformats them", () => {
    const draft = "Jane Smith\n(555) 010-0199 | jane.smith@gmail.com | https://www.linkedin.com/in/janesmith/ | https://github.com/jsmith\nSenior engineer.";
    const r = stripInventedContact(draft, ORIGINAL);
    expect(r.removed).toEqual([]);
    expect(r.text).toBe(draft);
  });

  it("keeps a phone written with the country code", () => {
    const r = stripInventedContact("Call +1 555.010.0199", ORIGINAL);
    expect(r.removed).toEqual([]);
  });

  // Text extracted from a PDF loses the separator icons, so the phone sits
  // next to a ZIP, a unit number or a year with only a space between them.
  for (const source of [
    "Jane Smith\nBrooklyn, NY 11215 555-010-0199\nSenior engineer.",
    "Jane Smith\n10001 555.010.0199\nSenior engineer.",
    "Jane Smith\nApt 12 555-010-0199\nSenior engineer.",
    "Jane Smith\n555-010-0199 2015 - 2020 Acme\nSenior engineer.",
  ]) {
    it(`keeps the buyer's phone when the source has a number beside it: ${JSON.stringify(source.split("\n")[1])}`, () => {
      const phone = source.match(/555[.-]010[.-]0199/)![0];
      for (const written of [phone, "(555) 010-0199"]) {
        const r = stripInventedContact(`Jane Smith\n${written} | Brooklyn, NY\nSenior engineer.`, source);
        expect(r.removed).toEqual([]);
        expect(r.text).toContain(written);
      }
    });
  }

  it("still strips an invented profile URL and phone", () => {
    const draft = "Jane Smith\n555-010-0199 | jane.smith@gmail.com | linkedin.com/in/jane-smith-pro | 555-777-1234\nSenior engineer.";
    const r = stripInventedContact(draft, ORIGINAL);
    expect(r.removed).toEqual(["linkedin.com/in/jane-smith-pro", "555-777-1234"]);
    expect(r.text).toContain("555-010-0199 | jane.smith@gmail.com");
    expect(r.text).not.toMatch(/jane-smith-pro|777-1234/);
  });

  it("still strips an invented email", () => {
    const r = stripInventedContact("Write to jane@janesmith.dev", ORIGINAL);
    expect(r.removed).toEqual(["jane@janesmith.dev"]);
  });
});
