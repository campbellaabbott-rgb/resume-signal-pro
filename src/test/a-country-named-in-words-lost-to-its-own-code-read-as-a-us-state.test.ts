/**
 * A COUNTRY NAMED IN WORDS LOST TO ITS OWN CODE, READ AS A US STATE (review of
 * register L7-14, 2026-10-10).
 *
 * The L7-14 trailing-code rule returned US for any trailing state code before
 * the country words were consulted. A location that names a country in words
 * and ends in that same country's ISO code, whose first segment the city table
 * does not know, was filed US: "Remote (Canada), CA", "India, IN",
 * "Frankfurt am Main, Germany, DE", "Medellín, Colombia, CO".
 */
import { describe, expect, it } from "vitest";
import { detectCountry } from "../../supabase/functions/job-board/normalize";

describe("a trailing code that repeats the country the location names", () => {
  it("is that country, not a US state", () => {
    const cases: Array<[string, string]> = [
      ["Remote (Canada), CA", "CA"],
      ["Canada, CA", "CA"],
      ["India, IN", "IN"],
      ["Remote, India, IN", "IN"],
      ["Frankfurt am Main, Germany, DE", "DE"],
      ["Medellín, Colombia, CO", "CO"],
      ["Casablanca, Morocco, MA", "MA"],
    ];
    for (const [loc, want] of cases) expect(detectCountry(loc), loc).toBe(want);
  });
  it("positive control: a state code after a country word that is a US town stays US", () => {
    expect(detectCountry("Mexico, MO")).toBe("US");
    expect(detectCountry("Lake Wales, FL")).toBe("US");
    expect(detectCountry("Bangalore, IN")).toBe("IN");
    expect(detectCountry("Austin, TX")).toBe("US");
  });
});
