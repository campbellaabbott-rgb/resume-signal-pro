/**
 * AN AGE SENTENCE WAS READ AS EXPERIENCE, AND REAL REQUIREMENTS WERE DROPPED
 * (review of register L8-15 and L7-09, 2026-10-10).
 *
 * L8-15 stayed open for the commonest wording on hourly postings. The forward
 * pattern's 30-character gap crossed "or older and able to" and bound the age
 * to the word "work"; the age check only looked after the whole match and
 * 24 characters before the number. "Must be 18 years or older and able to
 * work weekends." read as 18 years, and a cashier was filed expert.
 *
 * The L7-09 guards dropped genuine requirements on every new posting: any
 * number after "over", "nearly" or "almost" was taken for a company's age,
 * and no digit was allowed between "years" and "experience", so "Over 10
 * years of experience", "3+ years of Python 3 experience" and "2+ years of
 * Office 365 experience" all read as no requirement at all.
 */
import { describe, expect, it } from "vitest";
import { detectExperience, parseMinYears } from "../../supabase/functions/job-board/experience";

describe("a minimum age is not experience", () => {
  it("in the wordings hourly postings use", () => {
    for (const s of [
      "Must be 18 years or older and able to work weekends.",
      "Must be at least 18 years old, able to work flexible hours",
      "Must be 18 years of age or older and able to work nights",
    ]) {
      expect(parseMinYears(s), s).toBeNull();
    }
    expect(detectExperience("Cashier", "Must be 18 years or older and able to work weekends.").band, "an entry cashier was filed expert").toBeNull();
  });
});

describe("a stated requirement reads, whatever words sit around the number", () => {
  it("after over, with or nearly", () => {
    expect(parseMinYears("Over 10 years of experience in software engineering")).toBe(10);
    expect(parseMinYears("With over 7 years of industry experience")).toBe(7);
    expect(parseMinYears("Nearly 8 years of hands-on experience with AWS")).toBe(8);
  });
  it("with a version number between the years and the experience", () => {
    expect(parseMinYears("3+ years of Python 3 experience")).toBe(3);
    expect(parseMinYears("5 years of HTML5/CSS3 experience")).toBe(5);
    expect(parseMinYears("2+ years of Office 365 experience")).toBe(2);
  });
  it("positive control: a company's age and a second count are still not this one's requirement", () => {
    expect(parseMinYears("For over 15 years, Acme has been the industry's work partner.")).toBeNull();
    expect(parseMinYears("We've been helping clients for nearly 10 years with professional services.")).toBeNull();
    expect(parseMinYears("2 years Python, 8 years leadership experience")).toBe(8);
    expect(parseMinYears("Must have worked for over 5 years in a professional kitchen.")).toBe(5);
  });
});
