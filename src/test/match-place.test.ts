// @vitest-environment node
/**
 * PLACING A RETURNED ROW (resume-match/pipeline.ts placeRow, spec 6.4 and 6.7).
 *
 * Null-tolerant and never trusting one flag: a ring place counts only in its
 * own state; a null-country row is kept when it names the ring place AND its
 * state; a place the reader named without a region cannot conflict with one;
 * a remote row is valid for an on-site occupation only when it says remote in
 * words, and for a licensed occupation it names the reader's state (or a
 * compact state) or says "licence state not stated"; the region and country
 * lanes say where the reader said they would move.
 */
import { describe, expect, it } from "vitest";
import { placeRow, type PlaceContext, regionAliases, ringTerms } from "../../supabase/functions/resume-match/pipeline";
import { familyByKey } from "../../supabase/functions/_shared/title-families";
import { readResumeLicences } from "../../supabase/functions/_shared/licence-rules";

const COLUMBUS = [
  { name: "Columbus", region: "OH", regionName: "Ohio", country: "US" },
  { name: "Westerville", region: "OH", regionName: "Ohio", country: "US" },
];
const ctx = (over: Partial<PlaceContext> = {}): PlaceContext => ({
  ring: COLUMBUS, ringCity: "Columbus", radiusKm: 40, canWorkIn: ["US"], relocate: "none",
  family: familyByKey("cashier")!, licences: [], ...over,
});
const row = (location: string | null, over: Record<string, unknown> = {}) => ({
  id: "x", source: "greenhouse", company_token: "acme", company: "Acme", title: "Cashier", location, country: "US",
  remote: false, work_mode: null, employment_type: null, posted_at: null, salary: null, salary_min_annual: null, salary_max_annual: null,
  salary_period: null, salary_currency: null, experience_band: null, min_years: null, agency: false, lane: "ring", title_rank: null, siblings: 1,
  ...over,
}) as Parameters<typeof placeRow>[0];

describe("the ring", () => {
  it("a ring place counts in its own state; Columbus, GA is beyond the commute", () => {
    expect(placeRow(row("Westerville, OH"), ctx()).place).toMatchObject({ kind: "ring", label: "Westerville · in your Columbus commute area (40 km)" });
    expect(placeRow(row("Columbus, Ohio"), ctx()).place).toMatchObject({ kind: "ring", label: "in your Columbus commute area (40 km)" });
    expect(placeRow(row("Columbus, GA"), ctx()).place.kind).toBe("beyond_commute");
  });
  it("a null-country row naming the ring place and its state is kept; naming the place alone is not", () => {
    expect(placeRow(row("Westerville, OH", { country: null }), ctx()).place.kind).toBe("ring");
    expect(placeRow(row("Westerville", { country: null }), ctx()).place.kind).not.toBe("ring");
    expect(placeRow(row(null, { country: null }), ctx()).place.kind).toBe("place_not_stated");
  });
  it("a place the reader named without a region matches it in any state of that country", () => {
    const ring = [...COLUMBUS, { name: "New York", region: null, regionName: null, country: "US" }];
    expect(placeRow(row("New York, NY, US"), ctx({ ring })).place.kind).toBe("ring");
    expect(placeRow(row("Columbus, GA"), ctx({ ring })).place.kind).toBe("beyond_commute");
  });
  it("a row in a country the reader did not say they can work in is set aside as such", () => {
    expect(placeRow(row("Toronto, ON", { country: "CA" }), ctx()).place).toEqual({ kind: "outside_countries", country: "CA" });
  });
});

describe("the remote lane does not lean on one flag", () => {
  it("an on-site occupation counts a remote row only when its title or location says remote", () => {
    expect(placeRow(row("Columbus, GA", { work_mode: "remote", lane: "remote" }), ctx()).place.kind).toBe("beyond_commute");
    expect(placeRow(row("Remote - US", { lane: "remote" }), ctx()).place).toMatchObject({ kind: "remote", label: "Remote within the US" });
  });
  it("a desk occupation counts the flag, the mode or the words", () => {
    const fam = familyByKey("data_analyst")!;
    expect(placeRow(row("Denver, CO", { title: "Data Analyst", remote: true, lane: "remote" }), ctx({ family: fam })).place.kind).toBe("remote");
    expect(placeRow(row("Anywhere", { title: "Data Analyst", work_mode: "remote", country: null, lane: "remote" }), ctx({ family: fam })).place.kind).toBe("place_not_stated");
  });
  it("a licensed occupation names the reader's state, a compact state, or says the state is not stated", () => {
    const fam = familyByKey("rn")!;
    const az = [{ kind: "rn" as const, jurisdiction: "AZ", compact: true, grade: null, basis: "" }];
    const il = [{ kind: "rn" as const, jurisdiction: "IL", compact: false, grade: null, basis: "" }];
    const r = (loc: string) => row(loc, { title: "Registered Nurse - Remote Triage", lane: "remote", remote: true });
    expect(placeRow(r("Remote, TX"), ctx({ family: fam, licences: az })).place.kind).toBe("remote");
    expect(placeRow(r("Remote, CA"), ctx({ family: fam, licences: az })).place).toEqual({ kind: "licence_elsewhere", state: "CA" });
    expect(placeRow(r("Remote, IN"), ctx({ family: fam, licences: il })).place).toEqual({ kind: "licence_elsewhere", state: "IN" });
    const unstated = placeRow(r("Remote - United States"), ctx({ family: fam, licences: az }));
    expect(unstated.place.kind).toBe("remote");
    expect(unstated.licenceStateNotStated).toBe(true);
  });
});

describe("where the reader said they would move", () => {
  it("the region lane names the region; the country lane names the country", () => {
    expect(placeRow(row("Fort Worth, TX"), ctx({ relocate: ["TX"] })).place).toMatchObject({ kind: "region", label: "you said you'd move within Texas" });
    expect(placeRow(row("Fort Worth, TX"), ctx({ relocate: "country" })).place).toMatchObject({ kind: "country", label: "Elsewhere in the US" });
    expect(placeRow(row("Fort Worth, TX"), ctx()).place.kind).toBe("beyond_commute");
  });
});

// ---------------------------------------------------------------------------
// The fixer's round (review of rm/integration 7af55e52). Each block failed on
// that commit.
// ---------------------------------------------------------------------------
const one = (name: string, region: string | null, regionName: string | null, country: string) => [{ name, region, regionName, country }];
const analyst = familyByKey("data_analyst")!;

describe("a US state code is read only where the US is", () => {
  it.each([
    ["Pune, IN", "Pune", "MH", "Maharashtra", "IN"],
    ["Gurugram, IN", "Gurugram", "HR", "Haryana", "IN"],
    ["Chennai, TN, India", "Chennai", "25", "Tamil Nadu", "IN"],
    ["Munich, DE", "Munich", "BY", "Bavaria", "DE"],
    ["Toronto, CA", "Toronto", "ON", "Ontario", "CA"],
    ["CA - Toronto - Office", "Toronto", "ON", "Ontario", "CA"],
    ["Derby DE1 3AA", "Derby", "ENG", "England", "GB"],
  ])("%s is in the ring of %s", (loc, name, region, regionName, country) => {
    const c = ctx({ ring: one(name, region, regionName, country), ringCity: name, canWorkIn: [country], family: analyst });
    expect(placeRow(row(loc, { country, title: "Data Analyst" }), c).place.kind).toBe("ring");
  });
  it("a US ring still refuses another state's city of the same name", () => {
    expect(placeRow(row("Columbus, GA"), ctx()).place.kind).toBe("beyond_commute");
  });
});

describe("relocating anywhere in the country", () => {
  const c = ctx({ ring: one("Munich", "BY", "Bavaria", "DE"), ringCity: "Munich", canWorkIn: ["DE"], relocate: "country", family: analyst });
  it("a city named alone is in the country lane, as is one with the country after it", () => {
    for (const loc of ["Hamburg", "Berlin", "Frankfurt am Main", "Hamburg, Germany"]) {
      expect(placeRow(row(loc, { country: "DE", title: "Data Analyst" }), c).place.kind, loc).toBe("country");
    }
  });
  it("a location that names only the country, or nothing, is place not stated, never beyond the commute", () => {
    expect(placeRow(row("Germany", { country: "DE", title: "Data Analyst" }), c).place.kind).toBe("place_not_stated");
    expect(placeRow(row("", { country: "DE", title: "Data Analyst" }), c).place.kind).toBe("place_not_stated");
  });
});

describe("the remote lane's licence check follows the licence rules", () => {
  const rn = familyByKey("rn")!;
  const r = (loc: string) => row(loc, { title: "Remote Registered Nurse - Telehealth", lane: "remote", remote: true });
  it("a licence that names no state covers every state, as licenceVerdict says", () => {
    const lic = readResumeLicences("RN license, active");
    expect(lic[0].jurisdiction).toBeNull();
    expect(placeRow(r("Remote - Florida"), ctx({ family: rn, licences: lic })).place.kind).toBe("remote");
  });
  it("states after 'excluding' are not states the row needs", () => {
    const tx = [{ kind: "rn" as const, jurisdiction: "TX", compact: true, grade: null, basis: "" }];
    expect(placeRow(r("Remote, US (excluding CA, NY)"), ctx({ family: rn, licences: tx })).place.kind).toBe("remote");
  });
  it("a CPA is not a licence to practise in one state, so a remote accountant row is not checked against it", () => {
    const acc = familyByKey("accountant")!;
    const cpa = [{ kind: "cpa" as const, jurisdiction: "OH", compact: false, grade: null, basis: "" }];
    expect(placeRow(row("Remote - California", { title: "Staff Accountant", lane: "remote", remote: true }), ctx({ family: acc, licences: cpa })).place.kind).toBe("remote");
  });
  it("'licence state not stated' only for a reader who holds that licence", () => {
    expect(placeRow(r("Remote - United States"), ctx({ family: rn, licences: [] })).licenceStateNotStated).toBe(false);
  });
});

describe("place names fold accents, typed apostrophes and street names", () => {
  it("Montréal reaches Montreal, and St. John’s reaches St. John's", () => {
    const mtl = ctx({ ring: one("Montréal", "QC", "Quebec", "CA"), ringCity: "Montréal", canWorkIn: ["CA"], family: analyst });
    expect(placeRow(row("Montreal, QC", { country: "CA", title: "Data Analyst" }), mtl).place.kind).toBe("ring");
    const sj = ctx({ ring: one("St. John’s", "NL", "Newfoundland and Labrador", "CA"), ringCity: "St. John’s", canWorkIn: ["CA"], family: analyst });
    expect(placeRow(row("St. John's, NL", { country: "CA", title: "Data Analyst" }), sj).place.kind).toBe("ring");
  });
  it("the ring's arms carry both spellings", () => {
    expect(ringTerms([{ name: "Montréal", asciiName: "Montreal" }, { name: "St. John’s", asciiName: "St. John's" }, { name: "Laval", asciiName: "Laval" }]))
      .toEqual(["Montréal", "Montreal", "St. John's", "Laval"]);
  });
  it("a street named after a ring city is not that city", () => {
    const mke = ctx({ ring: one("Milwaukee", "WI", "Wisconsin", "US"), ringCity: "Milwaukee" });
    expect(placeRow(row("Advocate Condell Medical Center - 801 S Milwaukee Ave"), mke).place.kind).not.toBe("ring");
    expect(placeRow(row("Milwaukee, WI"), mke).place.kind).toBe("ring");
  });
});

describe("what a remote row says about where it is", () => {
  it("a remote row that lists a state other than the reader's says so and carries that state", () => {
    const p = placeRow(row("North Carolina (remote)", { title: "Data Analyst", remote: true, lane: "remote" }), ctx({ family: analyst, homeRegion: "OH" }));
    expect(p.place).toMatchObject({ kind: "remote", label: "Remote (lists North Carolina)" });
    expect(p.remoteListsRegion).toBe("North Carolina");
    const home = placeRow(row("Ohio (remote)", { title: "Data Analyst", remote: true, lane: "remote" }), ctx({ family: analyst, homeRegion: "OH" }));
    expect(home.remoteListsRegion).toBeNull();
  });
  it("country names take their article", () => {
    const remote = (loc: string, country: string) =>
      placeRow(row(loc, { title: "Data Analyst", remote: true, lane: "remote", country }), ctx({ family: analyst, canWorkIn: [country] })).place;
    expect(remote("Remote - US", "US")).toMatchObject({ label: "Remote within the US" });
    expect(remote("Remote - Canada", "CA")).toMatchObject({ label: "Remote within Canada" });
    expect(remote("Remote - Netherlands", "NL")).toMatchObject({ label: "Remote within the Netherlands" });
  });
});

describe("Australian regions for an Australian reader", () => {
  it("WA, SA and NT are Western Australia, South Australia and the Northern Territory", () => {
    expect(regionAliases(["WA"], "AU")).toEqual(["Western Australia", ", WA"]);
    expect(regionAliases(["SA"], "AU")).toEqual(["South Australia", ", SA"]);
    expect(regionAliases(["NT"], "AU")).toEqual(["Northern Territory", ", NT"]);
    expect(regionAliases(["WA"])).toEqual(["Washington", ", WA"]);
    const c = ctx({ ring: one("Brisbane", "QLD", "Queensland", "AU"), ringCity: "Brisbane", canWorkIn: ["AU"], relocate: ["WA", "SA"], family: familyByKey("electrician")! });
    const sparky = (loc: string) => placeRow(row(loc, { country: "AU", title: "Electrician" }), c).place;
    expect(sparky("Perth, WA, Australia")).toMatchObject({ kind: "region", label: "you said you'd move within Western Australia" });
    expect(sparky("Perth, Western Australia").kind).toBe("region");
    expect(sparky("Adelaide, SA, Australia").kind).toBe("region");
  });
});
