/**
 * A STATE WRITTEN FIRST WITH A COMMA IS A STATE, NOT A CITY ABROAD (register S11-027).
 *
 * The state-first pattern wanted whitespace after the code and listed only 26
 * codes, so "SD, Aberdeen" fell through to the bare-city table and was filed
 * in Britain, "MN, Alexandria" in Egypt, "WV, Ghent" in Belgium and "OH,
 * Lima" in Peru. Sanford alone had 23 rows served as GB and 2 as EG; about
 * 1.8k "ST, City" rows carried no region_code, which the WARN filing gate
 * requires, and "US-TX-Houston" had none either. The Workday place reader
 * then nulled the vendor's own alpha-2 US as a "contradiction" with that
 * city-table guess.
 *
 * Run against the shipped normalize.ts.
 */
import { describe, expect, it } from "vitest";
import {
  COUNTRY_MAP_VERSION,
  REGION_MAP_VERSION,
  detectCountry,
  detectPlace,
  detectRegion,
  statedCountry,
  workdayDetailPlace,
} from "../../supabase/functions/job-board/normalize";

describe("the state-first form with its punctuation", () => {
  it("is the United States, with the state as its region", () => {
    for (const [loc, region] of [
      ["SD, Aberdeen", "US-SD"],
      ["MN, Alexandria", "US-MN"],
      ["WV, Ghent", "US-WV"],
      ["OH, Lima", "US-OH"],
      ["SD, Sioux Falls", "US-SD"],
      ["VA - Richmond", "US-VA"],
      ["PA, Ghent", "US-PA"],
      ["MA, Boston", "US-MA"],
      ["CA, Lima", "US-CA"],
    ] as const) {
      expect(detectPlace(loc), loc).toEqual({ country: "US", region });
    }
  });

  it("the structured US-XX-City form names its state, ahead of a state name inside the city", () => {
    expect(detectPlace("US-TX-Houston")).toEqual({ country: "US", region: "US-TX" });
    expect(detectPlace("US-CA-San Francisco")).toEqual({ country: "US", region: "US-CA" });
    expect(detectRegion("US-DC-Washington", "US")).toBe("US-DC");
  });

  it("an ISO country code first with that country's own city, or a country named in words, is that country", () => {
    expect(detectCountry("IN, Chennai")).toBe("IN");
    expect(detectCountry("DE, Berlin")).toBe("DE");
    expect(detectCountry("CA, Toronto")).toBe("CA");
    expect(detectCountry("SD, Jinan, China")).toBe("CN");
    expect(detectCountry("Shanghai, SD, China")).toBe("CN");
  });

  it("a leading code and a spelled-out state that disagree name no state", () => {
    expect(detectRegion("DC, Washington", "US")).toBe(null);
    expect(detectRegion("NY, New York", "US")).toBe("US-NY");
  });

  it("the earlier rules still hold", () => {
    expect(detectCountry("OR Tambo International Airport")).toBe(null);
    expect(detectPlace("TX Austin")).toEqual({ country: "US", region: "US-TX" });
    expect(detectPlace("Lima, OH")).toEqual({ country: "US", region: "US-OH" });
    expect(detectCountry("Lima")).toBe("PE");
    expect(detectCountry("Aberdeen")).toBe("GB");
  });
});

describe("a city-table guess never vetoes the employer's own country", () => {
  it("statedCountry reads what the string says and makes no city guess", () => {
    expect(statedCountry("Aberdeen")).toBe(null);
    expect(statedCountry("Germany - Munich")).toBe("DE");
    expect(statedCountry("SD, Aberdeen")).toBe("US");
  });

  it("Workday's alpha-2 US stands beside 'SD, Aberdeen' and beside a bare 'Aberdeen'", () => {
    const place = (location: string, alpha2: string) =>
      workdayDetailPlace({ jobPostingInfo: { location, jobRequisitionLocation: { country: { alpha2Code: alpha2 } } } });
    expect(place("SD, Aberdeen", "US").country).toBe("US");
    expect(place("Aberdeen", "US").country).toBe("US");
    expect(place("MN, Alexandria", "US").country).toBe("US");
    // A contradiction the location STATES still refuses.
    expect(place("Germany - Munich", "IE").country).toBe(null);
  });
});

describe("the rule versions move with the rules", () => {
  it("COUNTRY_MAP_VERSION 9 and REGION_MAP_VERSION 3", () => {
    expect(COUNTRY_MAP_VERSION).toBe(9);
    expect(REGION_MAP_VERSION).toBe(3);
  });
});
