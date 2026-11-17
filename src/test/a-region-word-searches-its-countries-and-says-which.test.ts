// @vitest-environment node
/**
 * A REGION WORD SEARCHES ITS COUNTRIES AND SAYS WHICH (MCP upgrade 3, W1 lane
 * L2: U3-05 as revised by F1, M8 and M9, and by the lane review).
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
 * AND IN THE LANE'S FIRST BUILD (review, 2026-11-17):
 *   - a city sent beside a large region as country was searched only in the
 *     region's top 5, which left out the city's own country: location Warsaw
 *     with country EU fell from 2,028 rows (main, where the board ignored EU)
 *     to 2;
 *   - the query reader's own reading said location "Europe", "matched as
 *     text", and listed 5 countries as `searched`, though the server sent a
 *     country list and no location once the region reader ran; nothing gave
 *     the wiring lane one call that made the two agree;
 *   - "analyst in UK & I" read as country GB on main, and as location text
 *     "UK & Ireland" (which no posting location holds) from the query reader;
 *   - "near" also fired after German "bei", which is "at" an employer;
 *   - a country sent as a list (["DE"]) read as no country, so a region
 *     location overwrote it.
 *
 * WHAT IS TRUE NOW (agent-mcp/regions.ts, query-place.ts, and search-notes.ts,
 * where readRegionArgs reads a region sent as `location` or `country`, and
 * withRegionArgs and withRegion apply what it found):
 *   - a region word right after "in", "across", "within" or "throughout" in
 *     the query, or as the whole of `location` or `country`, is read. The
 *     query reader lifts it to `location` as its own word and says nothing
 *     more (S13-041's named-place cases, "engineer in North America", judge
 *     that reading); readRegionArgs reads that location as it reads one the
 *     caller sent, and withRegion writes what was sent back into the reading,
 *     so locationInterpreted and the arguments agree. Judged here as the
 *     server runs them once lane L5 wires them;
 *   - a region of 5 countries or fewer becomes the country filter, and a
 *     larger one (EU, EEA, Europe) searches the 5 of its members with the most
 *     postings this connector serves, in the order the A/B script measured
 *     and dated; regionNote names what was searched and lists the rest, to
 *     send as country. `searched` holds only countries that were sent;
 *   - beside the caller's own location, a small region is searched with it,
 *     and a large one is taken out of `country`, said, so the place the caller
 *     named is searched whole, as on main;
 *   - EMEA, APAC, LatAm, worldwide, global and international name no fixed
 *     list, so no country is guessed: a word that still names a part of the
 *     world (EMEA, APAC, LatAm) is matched as location text as the person
 *     spelt it, with a note that the text also matches other place names
 *     holding those letters; one that names none (worldwide, global) is never
 *     moved into a search; the note asks for the countries;
 *   - "near X" searches X, and the note says nearby towns are not included;
 *   - a place the caller already set, a negated place, and RC-S9-002's
 *     whole-country location note are left exactly as they were;
 *   - on the corpus, composed, every S13-041 case scores no worse than main
 *     except the two named-place rows that name a region ("engineer in North
 *     America", "customer service in Europe"), which the spec's region rule
 *     now searches as the region's countries: an owner call on those rows'
 *     want, named here so nothing else can slip in beside them.
 * Every country list here is one the board's own filter normaliser applies
 * whole, with nothing in ignoredFilters.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ISO_ALPHA2, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { locationAsField, readQuery, type QueryReading } from "../../supabase/functions/agent-mcp/query-place";
import { readRegionArgs, withRegion, withRegionArgs, type RegionFound } from "../../supabase/functions/agent-mcp/search-notes";
import { COUNTRIES_PER_SEARCH, EUROPE_BY_POSTINGS, REGIONS, membersToSearch, regionNamed } from "../../supabase/functions/agent-mcp/regions";

/**
 * What the server searches once lane L5 wires this lane, as search-notes.ts's
 * header gives it: readQuery on the query, its reading merged into the
 * arguments, then readRegionArgs on those, applied to both.
 */
function searched(q: string, input: Record<string, unknown> = {}) {
  const set = (v: unknown) => v !== undefined && v !== null && v !== "";
  const r = readQuery(q, { remote: input.remote === true, location: set(input.location), country: set(input.country) });
  let args: Record<string, unknown> = { ...input, query: r.query, ...(r.location ? { location: r.location } : {}), ...(r.country ? { country: r.country } : {}), ...(r.remote ? { remote: true } : {}) };
  let reading: QueryReading | null = r.from ? r : null;
  const found = readRegionArgs(args);
  if (found) {
    args = withRegionArgs(args, found.args);
    reading = withRegion(reading ?? { query: String(args.query ?? "") }, found);
  }
  return { first: r, reading, args, found, region: found?.region, regionNote: found?.regionNote };
}

const EU27 = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
const sorted = (xs: readonly string[]) => [...xs].sort();
const headOf = (key: keyof typeof REGIONS) => EUROPE_BY_POSTINGS!.order.filter((c) => REGIONS[key].members.includes(c)).slice(0, COUNTRIES_PER_SEARCH);

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

  it("the large regions' order is measured, dated, holds each of Europe's members once, and keeps its printed head margins", () => {
    expect(EUROPE_BY_POSTINGS, "run scripts/measure-region-search-ab.mjs and store its order").not.toBeNull();
    const m = EUROPE_BY_POSTINGS!;
    expect(m.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.basis).toMatch(/scripts\/measure-region-search-ab\.mjs/);
    expect(sorted(m.order)).toEqual(sorted(REGIONS.europe.members));
    expect(new Set(m.order).size).toBe(m.order.length);
    // Each stored head was settled when it ran: the 5th at least the most any later member could have.
    for (const [k, h] of Object.entries(m.heads)) expect(h.fifth, k).toBeGreaterThanOrEqual(h.nextAtMost);
  });
});

describe("a region names itself in the ways people type it", () => {
  it.each([
    ["DACH", "dach"], ["the Nordics", "nordics"], ["Nordic countries", "nordics"], ["Benelux", "benelux"],
    ["UK & Ireland", "uk_ireland"], ["the UK and Ireland", "uk_ireland"], ["UK&I", "uk_ireland"], ["UK & I", "uk_ireland"], ["Iberia", "iberia"],
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
    ["analyst in UK & I", "analyst", "GB,IE"],
    ["developer jobs across Iberia", "developer", null],
    ["QA engineer within the Baltics", "QA engineer", null],
    ["teacher jobs in ANZ", "teacher", "AU,NZ"],
    ["truck driver jobs throughout North America", "truck driver", null],
  ])("%s searches %s in the region's countries", (q, query, country) => {
    const f = searched(q);
    expect(f.first.query).toBe(query);
    expect(f.first.country).toBeUndefined();
    // The query reader's location is the region's own word, which the region reader names again.
    const named = regionNamed(f.first.location ?? "");
    expect(named !== null && "region" in named && named.region.word === f.first.location, String(f.first.location)).toBe(true);
    expect(f.args.location).toBeUndefined();
    const members = f.region?.members ?? [];
    expect(members.length).toBeGreaterThan(0);
    expect(members.length).toBeLessThanOrEqual(COUNTRIES_PER_SEARCH);
    expect(sorted(String(f.args.country).split(","))).toEqual(sorted(members));
    if (country) expect(f.args.country).toBe(country);
    expect(f.regionNote).toContain(`country ${f.args.country}`);
  });

  it("S13-041's named-place cases are read as location text by the query reader alone, never as a country", () => {
    expect(readQuery("engineer in North America")).toMatchObject({ query: "engineer", location: "North America" });
    expect(readQuery("customer service in Europe")).toMatchObject({ query: "customer service", location: "Europe" });
    expect(readQuery("engineer in North America").country).toBeUndefined();
    expect(readQuery("customer service in Europe").country).toBeUndefined();
  });

  it("the query reader says nothing about a region on its own: no region, no regionNote, until the search is final", () => {
    for (const q of ["customer service in Europe", "nurse jobs in the EU", "engineer in EMEA", "analyst in UK & I"]) {
      const r = readQuery(q);
      expect(r.region, q).toBeUndefined();
      expect(r.regionNote, q).toBeUndefined();
    }
  });

  it("a large region searches its 5 members with the most postings, in the measured order, and lists the rest", () => {
    for (const [q, key] of [["data engineer jobs in Europe", "europe"], ["nurse jobs within the EU", "eu"], ["analyst jobs across the EEA", "eea"]] as const) {
      const f = searched(q);
      const members = REGIONS[key].members;
      const head = headOf(key);
      expect(f.args.country, q).toBe(head.join(","));
      expect(f.region?.searched).toEqual(head);
      expect(sorted([...(f.region?.searched ?? []), ...(f.region?.rest ?? [])])).toEqual(sorted(members));
      expect(f.regionNote).toContain(`country ${head.join(",")}`);
      expect(f.regionNote).toContain(EUROPE_BY_POSTINGS!.measuredAt);
      expect(f.regionNote).toMatch(/send them as country to search them/);
      for (const c of f.region?.rest ?? []) expect(f.regionNote).toContain(c);
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
    for (const q of ["data engineer jobs in DACH", "nurse jobs in the Nordics", "data engineer jobs in Europe", "sales jobs in the UK and Ireland", "nurse jobs in the EU"]) {
      const country = searched(q).args.country;
      const f = normalizeFilters({ country }, 25);
      expect(f.ignored, q).not.toContain("country");
      expect(f.applied.country, q).toBe(country);
    }
  });

  it.each(["data engineer jobs in EMEA", "account executive in APAC", "developer jobs in LatAm", "designer jobs in Latin America", "engineer jobs in the Asia-Pacific"])(
    "%s guesses no country: the words are searched as location text as typed, and the note asks for the countries",
    (q) => {
      const r = searched(q);
      expect(r.args.country).toBeUndefined();
      expect(typeof r.args.location).toBe("string");
      expect(q).toContain(String(r.args.location));
      expect(r.args.query).not.toMatch(/emea|apac|latam|latin america|asia/i);
      expect(r.regionNote).toMatch(/names no fixed list of countries, so none was guessed/);
      expect(r.regionNote).toMatch(/also matches any place whose name holds those letters/);
      expect(r.regionNote).toMatch(/[Nn]ame the countries/);
    },
  );

  it("a word that names no part of the world stays in the title words", () => {
    for (const q of ["consultant jobs in global", "analyst in international", "sales jobs across worldwide"]) {
      const r = searched(q);
      expect(r.found, q).toBeNull();
      expect(r.first.location, q).toBeUndefined();
      expect(r.args.country, q).toBeUndefined();
    }
  });

  it("a region the caller already scoped, or one after a negation, is left exactly as main read it", () => {
    expect(readQuery("data engineer jobs in Europe", { country: true })).toEqual(readQuery("data engineer jobs in Europe", { country: true, location: true }));
    expect(readQuery("data engineer jobs in Europe", { location: true }).query).toBe("data engineer jobs in Europe");
    expect(readQuery("data engineer jobs in Europe", { country: true }).query).toBe("data engineer jobs in Europe");
    expect(readQuery("data engineer not in Europe")).toEqual({ query: "data engineer not in Europe" });
    expect(readQuery("nurse jobs outside the EU")).toEqual({ query: "nurse jobs outside the EU" });
  });

  it("a remote the person refused is no remote: the region is its country list, with no second search", () => {
    const r = searched("data engineer not remote in the EU");
    expect(r.first.remote).toBeUndefined();
    expect(r.region?.how).toBe("country");
    expect(String(r.args.country).split(",")).toHaveLength(5);
    expect(r.found?.alsoSearch).toBeUndefined();
  });
});

describe("what the server says it searched is what it sent", () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ["customer service in Europe", {}], ["nurse jobs in the EU", {}], ["analyst in UK & I", {}], ["engineer in EMEA", {}],
    ["senior data engineer jobs in Europe", { remote: true }], ["remote data engineer in the Nordics", {}], ["engineer", { location: "Europe" }],
    ["engineer", { location: "Remote - Europe" }], ["engineer", { country: "EU" }], ["engineer", { country: "EU", location: "Warsaw" }],
    ["engineer", { country: "DACH", location: "Berlin" }], ["engineer", { country: "EMEA" }], ["engineer", { country: "worldwide" }],
    ["engineer", { location: "Europe (remote)", workMode: "remote" }], ["engineer", { country: "ANZ", remote: true }],
  ];

  it.each(CASES)("%s %j: locationInterpreted's place keys are the arguments sent", (q, input) => {
    const f = searched(q, input);
    expect(f.found, `${q} ${JSON.stringify(input)}`).not.toBeNull();
    const reading = f.reading as Record<string, unknown>;
    for (const k of Object.keys(f.found!.args)) expect(reading[k] ?? null, k).toEqual(f.args[k] ?? null);
    expect(reading.regionNote).toBe(f.found!.regionNote);
    expect(reading.region).toEqual(f.found!.region);
  });

  it.each(CASES)("%s %j: `searched` names only countries sent as country", (q, input) => {
    const f = searched(q, input);
    const region = f.found!.region;
    if (region.searched.length) expect(region.searched.join(",")).toBe(f.args.country);
    else expect(region.how).not.toBe("country");
    if (region.how === "country") expect(typeof f.args.country).toBe("string");
  });

  it("withRegionArgs takes out a key set to null and leaves the rest", () => {
    expect(withRegionArgs({ query: "x", location: "Europe", remote: true }, { location: null, country: "DE,AT,CH" })).toEqual({ query: "x", remote: true, country: "DE,AT,CH" });
    const found = readRegionArgs({ query: "x", location: "DACH" }) as RegionFound;
    expect(withRegion({ query: "x", location: "DACH" }, found)).toEqual({ query: "x", country: "DE,AT,CH", region: found.region, regionNote: found.regionNote });
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

  it("location DACH becomes the country filter, and the location is taken away", () => {
    expect(readRegionArgs({ query: "sales manager", location: "DACH" })!.args).toEqual({ location: null, country: "DE,AT,CH" });
    expect(readRegionArgs({ query: "sales manager", location: "the Nordics" })!.args).toEqual({ location: null, country: "DK,FI,IS,NO,SE" });
  });

  it.each([
    ["Warsaw", "EU", "PL"], ["Lisbon", "EU", "PT"], ["Stockholm", "EEA", "SE"], ["Oslo", "EEA", "NO"], ["Dublin", "Europe", "IE"], ["Zurich", "Europe", "CH"],
  ])("location %s beside country %s: the region is taken out of country, so %s is searched, as on main", (loc, region, own) => {
    const r = readRegionArgs({ query: "engineer", location: loc, country: region })!;
    expect(r.args).toEqual({ country: null });
    expect(r.region.how).toBe("none");
    expect(r.region.searched).toEqual([]);
    expect(r.region.members).toContain(own);
    expect(r.regionNote).toBe(`country "${region}" is read here as ${(Object.values(REGIONS).find((g) => g.word === region)!).says}, more than one search takes (5), so no country was sent: location "${loc}" was searched on its own.`);
    expect(r.regionNote).not.toMatch(/send them as country/);
  });

  it("a small region beside the caller's location is searched with it", () => {
    const r = readRegionArgs({ query: "engineer", location: "Berlin", country: "DACH" })!;
    expect(r.args).toEqual({ country: "DE,AT,CH" });
    expect(r.regionNote).toBe('country "DACH" is read here as country DE,AT,CH.');
  });

  it("a country sent as a list is read as that list: a region in it is read, a country in it stands", () => {
    expect(readRegionArgs({ query: "engineer", country: ["DE"], location: "Europe" })).toBeNull();
    expect(readRegionArgs({ query: "engineer", country: ["DE", "AT"], location: "the Nordics" })).toBeNull();
    expect(readRegionArgs({ query: "engineer", country: ["EU"] })!.args).toEqual({ country: headOf("eu").join(",") });
  });

  it("country worldwide or global moves nothing, and says no country was searched", () => {
    for (const c of ["worldwide", "Global", "International"]) {
      const r = readRegionArgs({ query: "sales manager", country: c })!;
      expect(r.args, c).toEqual({});
      expect(r.region.how, c).toBe("none");
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

  it("small regions say what they are read as, never a fact about the map", () => {
    expect(readRegionArgs({ query: "x", location: "North America" })!.regionNote).toBe('"North America" is read here as country US,CA,MX.');
    expect(readRegionArgs({ query: "x", country: "UK & Ireland" })!.regionNote).toBe('country "UK & Ireland" is read here as country GB,IE.');
  });
});

describe("judged on the real corpus as the server will run it", () => {
  type CountryCase = { q: string; place: string; want: string | null; group: string; mainScore: 0 | 1 | 2 };
  type TitleRow = { title: string; company: string; location: string | null; country: string | null; mainRight: boolean };
  const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/model-queries-2026-11.json"), "utf8")) as { country: CountryCase[]; titles: TitleRow[] };
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // The query-reader corpus test's own scorer: 0 right, 1 nothing read, 2 a wrong country.
  function countryScore(r: Record<string, unknown>, c: CountryCase): 0 | 1 | 2 {
    if (r.country && r.country !== c.want) return 2;
    if (r.country === c.want && c.want) return 0;
    if (typeof r.location === "string" && fold(c.place).includes(fold(r.location).replace(/,\s*/g, ", "))) return 0;
    if (typeof r.location === "string" && fold(c.place).replace(/,\s*/g, " ").includes(fold(r.location).replace(/,\s*/g, " "))) return 0;
    return c.want ? 1 : (r.location || r.country ? 2 : 0);
  }

  it("every S13-041 case scores no worse composed than main, but the two named-place rows a region rule now searches as its countries", () => {
    const worse = CORPUS.country.flatMap((c) => {
      const f = searched(c.q);
      return countryScore(f.args, c) > c.mainScore ? [{ q: c.q, country: f.args.country, regionCountries: f.region?.searched.join(",") }] : [];
    });
    // Each is the region's own members, sent as country and said in regionNote; the rows' want (null) predates regions.
    expect(worse).toEqual([
      { q: "engineer in North America", country: "US,CA,MX", regionCountries: "US,CA,MX" },
      { q: "customer service in Europe", country: headOf("europe").join(","), regionCountries: headOf("europe").join(",") },
    ]);
  });

  it("no board title typed as a query is read as a region, so the composed search leaves every title as the corpus test judged it", () => {
    expect(CORPUS.titles.filter((t) => searched(t.title).found !== null).map((t) => t.title)).toEqual([]);
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

  it('German "bei" is "at" an employer, never "near": no nearby-towns note after it', () => {
    expect(readQuery("Sommerpraktikum 2027 bei CGM in Österreich", { country: true }).note ?? "").not.toMatch(/nearby towns/);
    expect(readQuery("nurse jobs bei Berlin").note ?? "").not.toMatch(/nearby towns/);
  });
});
