// Experience-band detection: cite explicit years when stated, else infer from
// title seniority, else null (unspecified). Locks the honest behavior.
import { describe, it, expect } from "vitest";
import {
  detectExperience,
  parseMinYears,
  bandFromYears,
  bandFromTitle,
  EXPERIENCE_BANDS,
} from "../../supabase/functions/job-board/experience";

describe("bandFromYears boundaries", () => {
  it("maps year counts to the right band", () => {
    expect([0, 1, 2].map(bandFromYears)).toEqual(["entry", "entry", "entry"]);
    expect([3, 4, 5].map(bandFromYears)).toEqual(["mid", "mid", "mid"]);
    expect([6, 8, 9].map(bandFromYears)).toEqual(["senior", "senior", "senior"]);
    expect([10, 15, 20].map(bandFromYears)).toEqual(["expert", "expert", "expert"]);
  });
});

describe("parseMinYears (explicit, experience-gated)", () => {
  it("reads common phrasings", () => {
    expect(parseMinYears("5+ years of experience required")).toBe(5);
    expect(parseMinYears("3-5 years experience in marketing")).toBe(3); // range → lower bound
    expect(parseMinYears("Minimum 8 years of professional experience")).toBe(8);
    expect(parseMinYears("At least 2 years work experience")).toBe(2);
    expect(parseMinYears("requires 10 years experience")).toBe(10);
  });

  it("takes the binding (highest) floor when several are stated", () => {
    expect(parseMinYears("2 years of Python and 8 years of leadership experience")).toBe(8);
  });

  it("ignores year figures NOT tied to experience", () => {
    expect(parseMinYears("Founded 10 years ago. Great culture.")).toBeNull();
    expect(parseMinYears("401k vesting after 1 year of tenure")).toBeNull();
    expect(parseMinYears("Software Engineer")).toBeNull();
  });

  it("ignores absurd values", () => {
    expect(parseMinYears("99 years of experience")).toBeNull();
  });
});

describe("bandFromTitle (seniority inference)", () => {
  it("classifies clear seniority signals", () => {
    expect(bandFromTitle("Senior Software Engineer")).toBe("senior");
    expect(bandFromTitle("Staff Data Scientist")).toBe("senior");
    expect(bandFromTitle("VP of Engineering")).toBe("expert");
    expect(bandFromTitle("Director, Product")).toBe("expert");
    expect(bandFromTitle("Chief Financial Officer")).toBe("expert");
    expect(bandFromTitle("Marketing Intern")).toBe("entry");
    expect(bandFromTitle("Junior Accountant")).toBe("entry");
    expect(bandFromTitle("New Grad Software Engineer")).toBe("entry");
  });

  it("returns null for titles with no seniority signal (honest unspecified)", () => {
    expect(bandFromTitle("Software Engineer")).toBeNull();
    expect(bandFromTitle("Registered Nurse")).toBeNull();
    expect(bandFromTitle("Account Executive")).toBeNull();
  });
});

describe("detectExperience priority: explicit years beat title", () => {
  it("prefers a cited year requirement over the title", () => {
    // Title reads senior, but the text says 3 years → mid, with the number cited.
    expect(detectExperience("Senior Analyst", "We need 3 years of experience.")).toEqual({ band: "mid", minYears: 3 });
  });

  it("falls back to title seniority when no years are stated", () => {
    expect(detectExperience("Senior Engineer", "Join our team.")).toEqual({ band: "senior", minYears: null });
  });

  it("is unspecified when neither signal exists", () => {
    expect(detectExperience("Engineer", "Build cool things.")).toEqual({ band: null, minYears: null });
  });

  it("only ever returns known bands or null", () => {
    const { band } = detectExperience("Principal Engineer", "12 years of experience");
    expect(band === null || (EXPERIENCE_BANDS as readonly string[]).includes(band)).toBe(true);
  });
});
