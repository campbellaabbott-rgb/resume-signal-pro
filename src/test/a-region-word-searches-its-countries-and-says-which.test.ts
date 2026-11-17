// @vitest-environment node
/**
 * A REGION WORD SEARCHES ITS COUNTRIES AND SAYS WHICH (MCP upgrade 3, W1 lane
 * L2: U3-05 as revised by F1, M8 and M9).
 *
 * WHAT WAS WRONG (live keyless probe, 2026-11-16):
 *   - c22, "remote senior data engineer jobs in Europe": "Europe" stayed in
 *     the title words, total was 0, and the rows came from Austin, Mumbai,
 *     Vancouver and Argentina;
 *   - c26, country "EU": the board named country in ignoredFilters and served
 *     265 rows from the US, Argentina, China and Canada, with nothing saying
 *     what to send instead;
 *   - c07: the search worked only once the AI knew ISO-2 codes and the board's
 *     cap of 5 countries a search.
 * Nothing read a region word, and "near Austin" searched three spellings of
 * Austin with no word that nearby towns were left out.
 *
 * WHAT IS TRUE NOW (agent-mcp/regions.ts, query-place.ts, and search-notes.ts,
 * where readRegionArgs reads a region sent as `location` or `country`):
 *   - a region word right after "in", "across", "within" or "throughout" in
 *     the query, or as the whole of `location` or `country`, is read. The
 *     query reader lifts it to `location` as its own word, never to
 *     `country` (S13-041's named-place cases, "engineer in North America",
 *     judge that reading), and readRegionArgs reads that location as it
 *     reads one the caller sent; the search is judged here as the two run;
 *   - with no remote asked, a region of 5 countries or fewer becomes the
 *     country filter, and a larger one (EU, EEA, Europe) searches the 5 of its
 *     members with the most postings this connector serves, in the order the
 *     A/B script measured and dated; regionNote names what was searched and
 *     lists the rest, to send as country;
 *   - EMEA, APAC, LatAm, worldwide, global and international name no fixed
 *     list, so no country is guessed: a word that still names a part of the
 *     world (EMEA, APAC, LatAm) is matched as location text, one that names
 *     none (worldwide, global) is never moved into a search, and the note
 *     asks for the countries;
 *   - "near X" searches X, and the note says nearby towns are not included;
 *   - a place the caller already set, a negated place, and RC-S9-002's
 *     whole-country location note are left exactly as they were.
 * Every country list here is one the board's own filter normaliser applies
 * whole, with nothing in ignoredFilters.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ISO_ALPHA2, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { locationAsField, readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { readRegionArgs } from "../../supabase/functions/agent-mcp/search-notes";
import { COUNTRIES_PER_SEARCH, EUROPE_BY_POSTINGS, REGIONS, membersToSearch, regionNamed } from "../../supabase/functions/agent-mcp/regions";

/**
 * What the server searches once lane L5 wires this lane: readQuery on the
 * query, then readRegionArgs on the arguments that leaves (search-notes.ts).
 */
function searched(q: string, input: Record<string, unknown> = {}) {
  const r = readQuery(q, { remote: input.remote === true, workMode: typeof input.workMode === "string" ? input.workMode : null });
  const args: Record<string, unknown> = { ...input, query: r.query, ...(r.location ? { location: r.location } : {}), ...(r.country ? { country: r.country } : {}), ...(r.remote ? { remote: true } : {}) };
  const g = readRegionArgs(args);
  return { reading: r, args: g ? { ...args, ...g.args } : args, region: g?.region ?? r.region, regionNote: g?.regionNote ?? r.regionNote };
}

const EU27 = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const sorted = (xs: readonly string[]) => [...xs].sort();

describe("each region is an explicit list of countries", () => {
  it("the small regions hold exactly their members", () => {
    expect(sorted(REGIONS.dach.members)).toEqual(sorted(["DE", "AT", "CH"]));
    expect(sorted(REGIONS.nordics.members)).toEqual(sorted(["DK", "FI", "IS", "NO", "SE"]));
    expect(sorted(REGIONS.benelux.members)).toEqual(sorted(["BE", "NL", "LU"]));
    expect(sorted(REGIONS.uk_ireland.members)).toEqual(sorted(["GB", "IE"]));
    expect(sorted(REGIONS.iberia.members)).toEqual(sorted(["ES", "PT"]));
    expect(sorted(REGIONS.baltics.members)).toEqual(sorted(["EE", "LV", "LT"]));
    expect(sorted(REGIONS.anz.members)).toEqual(sorted(["AU", "NZ"]));
    expect(sorted(REGIONS.north_america.members)).toEqual(sorted(["US", "CA", "MX"]));
  });

  it("the EU is its 27, the EEA adds Iceland, Liechtenstein and Norway, and Europe adds the UK and Switzerland", () => {
    expect(sorted(REGIONS.eu.members)).toEqual(sorted(EU27));
    expect(sorted(REGIONS.eea.members)).toEqual(sorted([...EU27, "IS", "LI", "NO"]));
    expect(sorted(REGIONS.europe.members)).toEqual(sorted([...EU27, "IS", "LI", "NO", "GB", "CH"]));
  });

  it("the EU list agrees with the work-rights bloc in _shared/work-countries.ts (EU plus Norway and Iceland there)", () => {
    // That set is not exported and _shared is not this lane's to edit, so its
    // literal is read: if the bloc there changes, this list must too.
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/work-countries.ts"), "utf8");
    const at = src.indexOf("const EU_EEA = new Set([");
    expect(at, "EU_EEA moved: point this test at it").toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("]);", at));
    const bloc = [...body.matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]);
    expect(sorted(bloc)).toEqual(sorted([...REGIONS.eu.members, "NO", "IS"]));
  });

  it("every member is a code the board's country filter accepts", () => {
    for (const r of Object.values(REGIONS)) for (const c of r.members) expect(ISO_ALPHA2.has(c), `${r.name}: ${c}`).toBe(true);
  });

  it("the large regions' order is measured, dated and holds each of Europe's members once", () => {
    expect(EUROPE_BY_POSTINGS, "run scripts/measure-region-search-ab.mjs and store its order").not.toBeNull();
    const m = EUROPE_BY_POSTINGS!;
    expect(m.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.basis).toMatch(/scripts\/measure-region-search-ab\.mjs/);
    expect(sorted(m.order)).toEqual(sorted(REGIONS.europe.members));
    expect(new Set(m.order).size).toBe(m.order.length);
  });
});

describe("a region names itself in the ways people type it", () => {
  it.each([
    ["DACH", "dach"], ["the Nordics", "nordics"], ["Nordic countries", "nordics"], ["Benelux", "benelux"],
    ["UK & Ireland", "uk_ireland"], ["the UK and Ireland", "uk_ireland"], ["UK&I", "uk_ireland"], ["Iberia", "iberia"],
    ["the Baltics", "baltics"], ["Baltic states", "baltics"], ["ANZ", "anz"], ["Australia and New Zealand", "anz"],
    ["North America", "north_america"], ["EU", "eu"], ["the E.U.", "eu"], ["European Union", "eu"], ["EEA", "eea"],
    ["European Economic Area", "eea"], ["Europe", "europe"], ["europe", "europe"],
  ])("%s is %s", (typed, key) => {
    const r = regionNamed(typed);
    expect(r && "region" in r ? r.region.key : null).toBe(key);
  });

  it.each(["EMEA", "APAC", "LatAm", "LATAM", "Latin America", "Asia Pacific", "Asia-Pacific", "worldwide", "global", "international"])(
    "%s names no fixed list of countries, so none is guessed",
    (typed) => {
      const r = regionNamed(typed);
      expect(r && "neverGuessed" in r).toBe(true);
    },
  );

  it.each(["Germany", "Texas", "London", "Western Europe", "Europe & Middle East", "EU)", "Sales", "Remote", ""])(
    "%s is no region",
    (typed) => expect(regionNamed(typed)).toBeNull(),
  );
});

describe("in the query, a region after in, across, within or throughout leaves the title words", () => {
  it.each([
    ["data engineer jobs in DACH", "data engineer", "DE,AT,CH"],
    ["nurse jobs in the Nordics", "nurse", null],
    ["accountant in Benelux", "accountant", null],
    ["sales jobs in the UK and Ireland", "sales", "GB,IE"],
    ["developer jobs across Iberia", "developer", null],
    ["QA engineer within the Baltics", "QA engineer", null],
    ["teacher jobs in ANZ", "teacher", "AU,NZ"],
    ["truck driver jobs throughout North America", "truck driver", null],
  ])("%s searches %s in the region's countries", (q, query, country) => {
    const r = readQuery(q);
    expect(r.query).toBe(query);
    expect(r.country).toBeUndefined();
    expect(r.location).toBe(REGIONS[r.region!.key!].word);
    const f = searched(q);
    expect(f.args.location).toBeNull();
    const members = f.region?.members ?? [];
    expect(members.length).toBeGreaterThan(0);
    expect(members.length).toBeLessThanOrEqual(COUNTRIES_PER_SEARCH);
    expect(sorted(String(f.args.country).split(","))).toEqual(sorted(members));
    if (country) expect(f.args.country).toBe(country);
    expect(f.regionNote).toContain(`country ${f.args.country}`);
  });

  it("S13-041's named-place cases are read as location text by the query reader, never as a country", () => {
    expect(readQuery("engineer in North America")).toMatchObject({ query: "engineer", location: "North America" });
    expect(readQuery("customer service in Europe")).toMatchObject({ query: "customer service", location: "Europe" });
    expect(readQuery("engineer in North America").country).toBeUndefined();
    expect(readQuery("customer service in Europe").country).toBeUndefined();
  });

  it("a large region searches its 5 members with the most postings, in the measured order, and lists the rest", () => {
    for (const [q, key] of [["data engineer jobs in Europe", "europe"], ["nurse jobs within the EU", "eu"], ["analyst jobs across the EEA", "eea"]] as const) {
      const f = searched(q);
      const r = { country: f.args.country, region: f.region, regionNote: f.regionNote };
      const members = REGIONS[key].members;
      const order = EUROPE_BY_POSTINGS!.order.filter((c) => members.includes(c));
      const head = order.slice(0, COUNTRIES_PER_SEARCH);
      expect(r.country, q).toBe(head.join(","));
      expect(r.region?.searched).toEqual(head);
      expect(sorted([...(r.region?.searched ?? []), ...(r.region?.rest ?? [])])).toEqual(sorted(members));
      expect(r.regionNote).toContain(`country ${head.join(",")}`);
      expect(r.regionNote).toContain(EUROPE_BY_POSTINGS!.measuredAt);
      expect(r.regionNote).toMatch(/send them as country to search them/);
      for (const c of r.region?.rest ?? []) expect(r.regionNote).toContain(c);
    }
  });

  it("membersToSearch gives a small region whole and a large one its measured head", () => {
    expect(membersToSearch(REGIONS.dach)).toEqual({ searched: ["DE", "AT", "CH"], rest: [] });
    const eu = membersToSearch(REGIONS.eu)!;
    expect(eu.searched).toHaveLength(5);
    expect(eu.rest).toHaveLength(22);
    expect(eu.measuredAt).toBe(EUROPE_BY_POSTINGS!.measuredAt);
  });

  it("the board's own filter applies every list whole, with nothing ignored", () => {
    for (const q of ["data engineer jobs in DACH", "nurse jobs in the Nordics", "data engineer jobs in Europe", "sales jobs in the UK and Ireland"]) {
      const country = searched(q).args.country;
      const f = normalizeFilters({ country }, 25);
      expect(f.ignored, q).not.toContain("country");
      expect(f.applied.country, q).toBe(country);
    }
  });

  it.each(["data engineer jobs in EMEA", "account executive in APAC", "developer jobs in LatAm", "designer jobs in Latin America"])(
    "%s guesses no country: the word is searched as location text and the note asks for the countries",
    (q) => {
      const r = searched(q);
      expect(r.args.country).toBeUndefined();
      expect(typeof r.args.location).toBe("string");
      expect(q.toLowerCase()).toContain(String(r.args.location).toLowerCase());
      expect(r.args.query).not.toMatch(/emea|apac|latam|latin america/i);
      expect(r.regionNote).toMatch(/names no fixed list of countries, so none was guessed/);
      expect(r.regionNote).toMatch(/[Nn]ame the countries/);
    },
  );

  it("a word that names no part of the world stays in the title words", () => {
    for (const q of ["consultant jobs in global", "analyst in international", "sales jobs across worldwide"]) {
      const r = readQuery(q);
      expect(r.region, q).toBeUndefined();
      expect(r.country, q).toBeUndefined();
    }
  });

  it("a region the caller already scoped, or one after a negation, is left exactly as main read it", () => {
    expect(readQuery("data engineer jobs in Europe", { country: true })).toEqual(readQuery("data engineer jobs in Europe", { country: true, location: true }));
    expect(readQuery("data engineer jobs in Europe", { location: true }).query).toBe("data engineer jobs in Europe");
    expect(readQuery("data engineer jobs in Europe", { country: true }).query).toBe("data engineer jobs in Europe");
    expect(readQuery("data engineer not in Europe")).toEqual({ query: "data engineer not in Europe" });
    expect(readQuery("nurse jobs outside the EU")).toEqual({ query: "nurse jobs outside the EU" });
  });

  it("a remote the person refused is no remote: the region goes to the country filter", () => {
    const r = searched("data engineer not remote in the EU");
    expect(r.reading.remote).toBeUndefined();
    expect(r.region?.how).toBe("country");
    expect(String(r.args.country).split(",")).toHaveLength(5);
  });
});

describe("a region sent as location or country is always read", () => {
  it("c26: country EU searches the EU's 5 members with the most postings, never the whole board", () => {
    const r = readRegionArgs({ query: "data engineer", country: "EU" })!;
    const order = EUROPE_BY_POSTINGS!.order.filter((c) => REGIONS.eu.members.includes(c));
    expect(r.args).toEqual({ country: order.slice(0, 5).join(",") });
    expect(r.regionNote).toContain(`country ${order.slice(0, 5).join(",")}`);
    for (const c of order.slice(5)) expect(r.regionNote).toContain(c);
  });

  it("location DACH with no remote becomes the country filter, and the location is taken away", () => {
    expect(readRegionArgs({ query: "sales manager", location: "DACH" })!.args).toEqual({ location: null, country: "DE,AT,CH" });
    expect(readRegionArgs({ query: "sales manager", location: "the Nordics" })!.args).toEqual({ location: null, country: "DK,FI,IS,NO,SE" });
  });

  it("country worldwide or global moves nothing, and says no country was searched", () => {
    for (const c of ["worldwide", "Global", "International"]) {
      const r = readRegionArgs({ query: "sales manager", country: c })!;
      expect(r.args, c).toEqual({});
      expect(r.regionNote, c).toMatch(/none was guessed and no country was searched/);
    }
  });

  it("country EMEA guesses nothing: it is matched as location text when no location was sent", () => {
    const r = readRegionArgs({ query: "sales manager", country: "EMEA" })!;
    expect(r.args).toEqual({ country: null, location: "EMEA" });
    expect(r.regionNote).toMatch(/none was guessed/);
    const kept = readRegionArgs({ query: "sales manager", country: "EMEA", location: "London" })!;
    expect(kept.args).toEqual({});
    expect(kept.regionNote).toMatch(/no country was searched/);
  });

  it("location EMEA is sent as typed, with the note", () => {
    const r = readRegionArgs({ query: "sales manager", location: "EMEA" })!;
    expect(r.args).toEqual({});
    expect(r.regionNote).toMatch(/none was guessed/);
  });

  it("anything that is not a region is not read here", () => {
    for (const a of [{ location: "Berlin" }, { country: "DE" }, { country: "DE,AT" }, { location: "Texas" }, { location: "London, UK" }, {}, { query: "nurse in Europe" }]) {
      expect(readRegionArgs(a), JSON.stringify(a)).toBeNull();
    }
  });

  it("a location and a country the caller both set are left alone", () => {
    expect(readRegionArgs({ location: "Europe", country: "DE" })).toBeNull();
  });
});

describe("RC-S9-002 is kept as built", () => {
  it.each([
    ["United States", { country: "US" }], ["Germany", { country: "DE" }], ["remote", { remote: true }],
    ["anywhere", { remote: true }], ["Remote US", { remote: true, country: "US" }],
  ])("location %s still reads as RC-S9-002 reads it, and the region reader leaves it alone", (loc, want) => {
    expect(locationAsField(loc)).toEqual(want);
    expect(readRegionArgs({ query: "nurse", location: loc })).toBeNull();
  });

  it("a region is no whole-country location, so RC-S9-002 says nothing about one", () => {
    for (const loc of ["Europe", "EU", "DACH", "Remote - Europe", "EMEA", "the Nordics", "UK & Ireland", "North America", "Benelux", "ANZ", "Iberia", "the Baltics", "EEA", "Global", "Worldwide", "International", "APAC", "LATAM"]) {
      expect(locationAsField(loc), loc).toBeNull();
    }
  });
});

describe('"near X" searches X and says nearby towns are not included', () => {
  it.each([
    ["nurse jobs near Austin, TX", "Austin, TX"],
    ["part-time jobs near Manchester UK", "Manchester"],
    ["barista near Seattle", "Seattle"],
  ])("%s", (q, place) => {
    const r = readQuery(q);
    expect(r.location).toBe(place);
    expect(r.note).toMatch(/nearby towns are not included; name them to search them/);
  });

  it("a place after in says nothing about nearby towns, and neither does a whole state or a metro the board expands", () => {
    expect(readQuery("nurse jobs in Austin, TX").note ?? "").not.toMatch(/nearby towns/);
    expect(readQuery("nurse jobs near Texas").note ?? "").not.toMatch(/nearby towns/);
    expect(readQuery("engineer jobs near the Bay Area").note ?? "").not.toMatch(/nearby towns/);
  });
});
