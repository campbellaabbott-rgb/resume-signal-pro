// @vitest-environment node
/**
 * THE NAMES PEOPLE TYPE ARE SEARCHED AS THEIR CODES AND SAID BACK, A NAME
 * WITH TWO READINGS IS REFUSED NAMING BOTH, AND A COUNTRY NOBODY CAN READ IS
 * REFUSED BEFORE ANYTHING IS COUNTED (lane fix/1121-connector-errors, item 3).
 *
 * Live 2026-11-21: search_jobs {query: "Recruiter", country: "Ireland"}
 * answered Recruiter jobs in the US, Israel and Canada, total 3,805: the
 * board keeps only ISO alpha-2 codes, dropped "Ireland" and searched every
 * country, with ignoredFilters: ["country"] the only sign.
 *
 * THE JUDGE IS A HAND LIST, never Intl and never the table's own generator:
 * the prototype's READS, REFUSED_TWO_READINGS, REFUSED_NOT_A_COUNTRY, PARTS
 * and LISTS (datacircle-2026-11-21/country-names-check.mjs, run 2026-11-21
 * on Node 25.6.1 with ICU 78.2: 182 typed names, 0 wrong), copied as written.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { COUNTRY_CODES, alpha3Of, countryArg, countryNameTable, readCountry } from "../../supabase/functions/agent-mcp/country-names.ts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const READS: Record<string, string> = {
  Ireland: "IE", ireland: "IE", "IE": "IE", ie: "IE", IRL: "IE", Eire: "IE", "Republic of Ireland": "IE",
  UK: "GB", "U.K.": "GB", uk: "GB", GB: "GB", GBR: "GB", "United Kingdom": "GB", "Great Britain": "GB", Britain: "GB",
  USA: "US", "U.S.": "US", "U.S.A.": "US", US: "US", us: "US", "United States": "US", "United States of America": "US", America: "US", "the United States": "US",
  Deutschland: "DE", Germany: "DE", DEU: "DE", "España": "ES", Espana: "ES", Italia: "IT", Nederland: "NL", "The Netherlands": "NL", Netherlands: "NL", Holland: "NL",
  Schweiz: "CH", Suisse: "CH", "Österreich": "AT", Osterreich: "AT", Polska: "PL", Sverige: "SE", Danmark: "DK", Norge: "NO", Suomi: "FI", Brasil: "BR", "México": "MX", Mexico: "MX",
  "Hong Kong": "HK", "Hong Kong SAR": "HK", Macau: "MO", Macao: "MO", UAE: "AE", "United Arab Emirates": "AE", ARE: "AE",
  "Ivory Coast": "CI", "Cote d'Ivoire": "CI", "Côte d’Ivoire": "CI", "Côte d'Ivoire": "CI", "Czech Republic": "CZ", Czechia: "CZ",
  "South Korea": "KR", Korea: "KR", "Republic of Korea": "KR", "Korea, Republic of": "KR", "North Korea": "KP",
  Myanmar: "MM", Burma: "MM", "Bosnia and Herzegovina": "BA", "Bosnia & Herzegovina": "BA", Bosnia: "BA", "Trinidad and Tobago": "TT", "Trinidad & Tobago": "TT",
  "DR Congo": "CD", DRC: "CD", "Democratic Republic of the Congo": "CD", "Congo-Kinshasa": "CD", "Republic of the Congo": "CG", "Congo-Brazzaville": "CG", "Congo - Brazzaville": "CG",
  Palestine: "PS", "Palestinian Territories": "PS", Russia: "RU", "Russian Federation": "RU", Vietnam: "VN", "Viet Nam": "VN", Turkey: "TR", "Türkiye": "TR", Turkiye: "TR",
  Taiwan: "TW", China: "CN", Iran: "IR", Syria: "SY", Laos: "LA", Moldova: "MD", Tanzania: "TZ", Venezuela: "VE", Bolivia: "BO", Brunei: "BN",
  Macedonia: "MK", "North Macedonia": "MK", Swaziland: "SZ", Eswatini: "SZ", "Cape Verde": "CV", "Cabo Verde": "CV", "East Timor": "TL", "Timor-Leste": "TL", Vatican: "VA", "Vatican City": "VA",
  "St. Lucia": "LC", "Saint Lucia": "LC", "St Lucia": "LC", "St. Kitts and Nevis": "KN", "Saint Kitts & Nevis": "KN", "The Bahamas": "BS", Bahamas: "BS", "The Gambia": "GM", Philippines: "PH",
  Jersey: "JE", Guinea: "GN", "Guinea-Bissau": "GW", "Equatorial Guinea": "GQ", "Papua New Guinea": "PG", Niger: "NE", Nigeria: "NG", Sudan: "SD", "South Sudan": "SS",
  Dominica: "DM", "Dominican Republic": "DO", Samoa: "WS", "American Samoa": "AS", "British Virgin Islands": "VG", "U.S. Virgin Islands": "VI", "US Virgin Islands": "VI",
  CA: "CA", Canada: "CA", GE: "GE", ge: "GE", India: "IN", Japan: "JP", Singapore: "SG", Australia: "AU", "New Zealand": "NZ", "South Africa": "ZA", Kosovo: "XK", "Réunion": "RE", "Curaçao": "CW",
};
const REFUSED_TWO_READINGS = ["Georgia", "georgia", "GEORGIA", "Congo", "the Congo", "Virgin Islands"];
const REFUSED_NOT_A_COUNTRY = ["Atlantis", "EU", "Europe", "EMEA", "Scandinavia", "California", "London", "NY", "ZZ", "UAEE", "XXX", "Irland", "remote", "worldwide"];
const PARTS: Record<string, string> = { England: "GB", Scotland: "GB", Wales: "GB", "Northern Ireland": "GB" };
const LISTS: Array<[unknown, string[]]> = [
  ["ireland, de", ["IE", "DE"]], ["IE,GB", ["IE", "GB"]], ["UK, Ireland, USA", ["GB", "IE", "US"]], [["Ireland", "DE"], ["IE", "DE"]],
  ["Korea, Republic of", ["KR"]], ["Congo, Democratic Republic of the", ["CD"]], ["", []], [null, []], [undefined, []], [[], []], [" , ", []],
];

describe("the reader, judged by the hand list", () => {
  it.each(Object.entries(READS))("%s reads as %s", (typed, code) => {
    expect(readCountry(typed)).toEqual({ code });
  });
  it.each(REFUSED_TWO_READINGS)("%s is refused with both readings", (typed) => {
    expect(readCountry(typed)).toHaveProperty("ambiguous");
  });
  it.each(REFUSED_NOT_A_COUNTRY)("%s is no country", (typed) => {
    const r = readCountry(typed);
    expect(r).not.toHaveProperty("code");
    expect(r).not.toHaveProperty("ambiguous");
  });
  it.each(Object.entries(PARTS))("%s reads as %s with a note", (typed, code) => {
    const a = countryArg(typed);
    expect(a.codes).toEqual([code]);
    expect(a.notes.join(" ")).toMatch(new RegExp(`^${typed} was searched as the whole of GB: the country filter has no smaller unit\\.`));
  });
  it.each(LISTS)("%j is the codes %j", (value, codes) => {
    const a = countryArg(value);
    expect(a.errors).toEqual([]);
    expect(a.codes).toEqual(codes);
  });
  it("six countries are refused, never trimmed; Georgia's refusal names GE and US", () => {
    expect(countryArg("IE,GB,US,DE,FR,ES").errors.length).toBe(1);
    const g = countryArg("Georgia").errors.join(" ");
    expect(g).toMatch(/GE/);
    expect(g).toMatch(/country US with location Georgia/);
  });
});

describe("the table's structure", () => {
  const FILTERS = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/filters.ts"), "utf8");
  const literal = FILTERS.slice(FILTERS.indexOf("export const ISO_ALPHA2"), FILTERS.indexOf(".split(\" \")", FILTERS.indexOf("export const ISO_ALPHA2")));
  const iso = [...literal.matchAll(/"([A-Z ]+)"/g)].map((x) => x[1]).join("").trim().split(/\s+/);
  it("the code set equals the board's ISO_ALPHA2", () => {
    expect(iso.length).toBeGreaterThanOrEqual(249);
    expect([...COUNTRY_CODES].sort()).toEqual([...new Set(iso)].sort());
  });
  it("every code and its alpha-3 read back as the code", () => {
    for (const c of COUNTRY_CODES) {
      expect(readCountry(c), c).toEqual({ code: c });
      expect(readCountry(alpha3Of(c)), `${c} alpha-3`).toEqual({ code: c });
    }
  });
  it("no folded name belongs to two codes", () => {
    const seen = new Map<string, string>();
    for (const [name, code] of countryNameTable()) {
      if (seen.has(name)) expect(seen.get(name), name).toBe(code);
      seen.set(name, code);
    }
  });
});

describe("through the connector", () => {
  let m: KeylessMcp;
  beforeEach(async () => {
    m = await bootKeylessMcp();
    m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Recruiter", country: "IE" }], total: 1, hasMore: false }), { status: 200 });
  }, 120_000);
  const call = async (args: Record<string, unknown>) => {
    const r = await m.call(args);
    return { ...r, body: r.isError ? {} : JSON.parse(r.text) as Record<string, unknown> };
  };
  it("country Ireland sends IE to the board and says countryRead", async () => {
    const r = await call({ query: "Recruiter", country: "Ireland" });
    expect(m.boardCalls[0]).toMatchObject({ country: "IE" });
    expect(r.body.countryRead).toEqual({ Ireland: "IE" });
  });
  it("{location: Atlanta, country: Georgia} is refused naming GE and US, with no meter call and no board call", async () => {
    const r = await call({ query: "nurse", location: "Atlanta", country: "Georgia" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/GE/);
    expect(r.text).toMatch(/US/);
    expect(m.rpcs.filter((x) => x.name === "mcp_anon_check_v2")).toHaveLength(0);
    expect(m.boardCalls).toHaveLength(0);
  });
  it("Atlantis is refused by name before anything is counted", async () => {
    const r = await call({ query: "nurse", country: "Atlantis" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Atlantis/);
    expect(m.rpcs.filter((x) => x.name === "mcp_anon_check_v2")).toHaveLength(0);
  });
  it("a board answer that still could not apply the country is no rows with notSearched, never every country", async () => {
    m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Recruiter", country: "US" }], total: 3805, hasMore: true, ignoredFilters: ["country"] }), { status: 200 });
    const r = await call({ query: "Recruiter", country: "IE" });
    expect(r.body.jobs).toEqual([]);
    expect(r.body.notSearched).toBe(true);
  });
});
