// @vitest-environment node
/**
 * A POSTING NAMES THE TOWN ITS EMPLOYER STATED (B07; SEO/GEO audit
 * 2026-11-07, SD-03).
 *
 * The audit found about a quarter of posting pages giving the country alone
 * for a location that names a town ("India, Hyderabad", "Shanghai China",
 * "Mumbai-Maharashtra-India", "SD, Watertown", "Singapore", "Kansas City MO"),
 * and a store or a site as the town ("West Edmonton Mall", "Toronto II",
 * "Lady Nomada Central Park", "Darwill McCook"). A wrong town in Google for
 * Jobs is worse than none, so the reading is held to a corpus of real strings
 * rather than to the audit's spellings: fixtures/posting-locations.json
 * carries every live sitemap posting page read on 2026-11-08 and every row of
 * the 2026-10-25 country corpus where this reading and main's differ, each
 * reviewed by hand, with main's own reading recorded beside it.
 *
 * `expected` states only what is right, so a field it leaves out is a refusal.
 * An `open` case is wrong on main and still wrong here, and is held to main's
 * reading: never worse than main, on any case.
 */
import { describe, expect, it } from "vitest";
import corpus from "./fixtures/posting-locations.json";
import { localityProblem, postingPostalAddress, type PostingRow } from "@/components/jobs/posting-page";

type Reading = { locality: string | null; region: string | null; postalCode: string | null };
type Case = {
  location: string;
  country: string;
  company: string | null;
  token: string | null;
  from: string;
  expected: Reading;
  main: Reading;
  sd03?: boolean;
  open?: string;
};

const cases = corpus.cases as Case[];

function read(c: Pick<Case, "location" | "country" | "company" | "token">): Reading {
  const row = { id: `x:${c.token ?? "t"}:1`, token: c.token, company: c.company, location: c.location, country: c.country } as unknown as PostingRow;
  const a = postingPostalAddress(row) ?? {};
  return {
    locality: (a.addressLocality as string | undefined) ?? null,
    region: (a.addressRegion as string | undefined) ?? null,
    postalCode: (a.postalCode as string | undefined) ?? null,
  };
}
const same = (a: Reading, b: Reading) => a.locality === b.locality && a.region === b.region && a.postalCode === b.postalCode;
const show = (c: Case, got: Reading) => `${c.country} | ${c.location} => ${JSON.stringify(got)} want ${JSON.stringify(c.expected)} (${c.from})`;

/** The strings the audit and its skeptic named (SD-03), each a case in the corpus. */
const NAMED = [
  "India, Hyderabad", "Israel, Tel Aviv", "Shanghai China", "Malaysia, Penang", "Spain, Lugo", "Mumbai-Maharashtra-India",
  "Vancouver-British Columbia-Canada", "SD, Watertown", "Singapore", "West Edmonton Mall, AB", "Lady Nomada Central Park",
  "Toronto II, Canada Retail", "Sungai Pikan Plasma", "Kansas City MO", "Pune-Maharashtra-India", "India, Pune",
  "Petaling Jaya-Selangor-Malaysia", "Harrogate United Kingdom", "Baltimore - Maryland",
  "Store 1357-Citadel Mall-ANN-Charleston, SC 29407", "FALAFILL WFM - Woodfield Mall Location", "Grand Z Casino Hotel",
  "Darwill McCook", "River Stone Chophouse", "Eberhard Strongsville", "Switzerland-Remote Location-Basel​",
];

describe("the corpus of real posting locations", () => {
  it("holds at least 300 real strings, every one the audit named among them", () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
    const missing = NAMED.filter((s) => !cases.some((c) => c.location === s && c.sd03));
    expect(missing).toEqual([]);
  });

  it("records main reading many of them wrong or short, so the corpus can tell the two apart", () => {
    expect(cases.filter((c) => !same(c.main, c.expected)).length).toBeGreaterThan(300);
  });
});

describe("postingPostalAddress reads each string as reviewed", () => {
  it("gives the reviewed address for every case that is not open", () => {
    const wrong = cases.filter((c) => !c.open).map((c) => [c, read(c)] as const).filter(([c, got]) => !same(got, c.expected));
    expect(wrong.map(([c, got]) => show(c, got))).toEqual([]);
  });

  it("is never worse than main: an open case keeps main's reading, and no case main read right is read otherwise", () => {
    const worse = cases.filter((c) => (c.open ? !same(read(c), c.main) : same(c.main, c.expected) && !same(read(c), c.expected)));
    expect(worse.map((c) => show(c, read(c)))).toEqual([]);
  });

  it("publishes no town the bake's own markup check would refuse", () => {
    const problem = (c: Case, got: Reading) => localityProblem(got.locality!, { addressCountry: c.country, addressRegion: got.region });
    const refused = cases.map((c) => [c, read(c)] as const).filter(([c, got]) => got.locality !== null && problem(c, got) !== null);
    expect(refused.map(([c, got]) => `${show(c, got)}: ${problem(c, got)}`)).toEqual([]);
  });
});

describe("the audit's own strings", () => {
  const at = (location: string, country: string, company: string | null = null, token: string | null = null) => read({ location, country, company, token });

  it("names the town in a country-first, a town-and-country, a town-region-country and a state-first string", () => {
    expect(at("India, Hyderabad", "IN")).toEqual({ locality: "Hyderabad", region: null, postalCode: null });
    expect(at("Shanghai China", "CN").locality).toBe("Shanghai");
    expect(at("Mumbai-Maharashtra-India", "IN").locality).toBe("Mumbai");
    expect(at("Vancouver-British Columbia-Canada", "CA")).toEqual({ locality: "Vancouver", region: "BC", postalCode: null });
    expect(at("SD, Watertown", "US")).toEqual({ locality: "Watertown", region: "SD", postalCode: null });
    expect(at("Kansas City MO", "US")).toEqual({ locality: "Kansas City", region: "MO", postalCode: null });
  });

  it("names a city-state's one town", () => {
    expect(at("Singapore", "SG").locality).toBe("Singapore");
    expect(at("Singapore, One Raffles Quay", "SG").locality).toBe("Singapore");
    expect(at("HK, HKSAR", "HK").locality).toBe("Hong Kong");
  });

  it("gives no store, site or employer name as the town, and keeps the region beside it", () => {
    expect(at("West Edmonton Mall, AB", "CA")).toEqual({ locality: null, region: "AB", postalCode: null });
    expect(at("Toronto II, Canada Retail", "CA").locality).toBeNull();
    expect(at("Sungai Pikan Plasma", "ID").locality).toBeNull();
    expect(at("Lady Nomada Central Park", "US", "Lady Nomada/Perdida", "3d6402aa-0ba0-4b6b-87d3-7c65bc8d81ea").locality).toBeNull();
    expect(at("Darwill McCook", "US", "Darwill, Inc.", "bcbb4a77-b701-4d7f-8e5d-aac3d55d4f85").locality).toBeNull();
    expect(at("Store 1357-Citadel Mall-ANN-Charleston, SC 29407", "US")).toEqual({ locality: "Charleston", region: "SC", postalCode: "29407" });
  });

  it("reads a region written as a label ('Location-Basel') as the place, never the label", () => {
    expect(at("Switzerland-Remote Location-Basel​", "CH")).toEqual({ locality: null, region: "Basel", postalCode: null });
  });

  it("takes the place in the row's own country out of a list, and none when the list has none there", () => {
    expect(at("Munich, Germany; London, United Kingdom", "GB").locality).toBe("London");
    expect(at("Toronto, Canada; Denver, Colorado", "US")).toEqual({ locality: "Denver", region: "CO", postalCode: null });
    expect(at("Amsterdam, North Holland, Netherlands; United Kingdom", "GB").locality).toBeNull();
  });

  it("lets the bake's markup check pass a city-state's town and a town beside its state, and nothing else with a country's name", () => {
    expect(localityProblem("Singapore", { addressCountry: "SG" })).toBeNull();
    expect(localityProblem("Lebanon", { addressCountry: "US", addressRegion: "PA" })).toBeNull();
    expect(localityProblem("South Jordan", { addressCountry: "US", addressRegion: "UT" })).toBeNull();
    expect(localityProblem("Lebanon", { addressCountry: "US" })).toBe("a country's name");
    expect(localityProblem("Singapore", { addressCountry: "MY" })).toBe("a country's name");
    expect(localityProblem("Movie Park Germany", { addressCountry: "DE", addressRegion: "NW" })).toBe("a country's name");
    expect(localityProblem("West Edmonton Mall", { addressCountry: "CA", addressRegion: "AB" })).toBe("a store or site word");
  });

  it("reads a US town that shares a country's name only beside its state", () => {
    expect(at("Lebanon, PA", "US")).toEqual({ locality: "Lebanon", region: "PA", postalCode: null });
    expect(at("Peru, IL 61354", "US")).toEqual({ locality: "Peru", region: "IL", postalCode: "61354" });
    expect(at("IRIS United States of America", "US").locality).toBeNull();
    expect(at("The Netherlands", "NL").locality).toBeNull();
    expect(at("Korea, Republic of", "KR").locality).toBeNull();
  });
});
