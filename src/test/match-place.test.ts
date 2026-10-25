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
import { placeRow, type PlaceContext } from "../../supabase/functions/resume-match/pipeline";
import { familyByKey } from "../../supabase/functions/_shared/title-families";

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
    expect(placeRow(row("Fort Worth, TX"), ctx({ relocate: "country" })).place).toMatchObject({ kind: "country", label: "Elsewhere in US" });
    expect(placeRow(row("Fort Worth, TX"), ctx()).place.kind).toBe("beyond_commute");
  });
});
