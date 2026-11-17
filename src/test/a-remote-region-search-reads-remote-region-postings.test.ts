// @vitest-environment node
/**
 * A REMOTE REGION SEARCH READS REMOTE REGION POSTINGS (MCP upgrade 3, W1 lane
 * L2: F1 part 1, M9).
 *
 * WHAT WAS WRONG: the design turned "Europe" into a 5-country filter whatever
 * was asked. The live probe (c06, 2026-11-16: location "Europe" with remote
 * true) shows what that loses: 8 of its 10 rows name no country ("Remote -
 * Europe", "Europe (remote)", "Remote, Europe"), so a country filter drops
 * every one of them, and the design's own hint ("search location Europe")
 * could never run, because the same rule converted that location too (M9).
 * Today the query form is worse still: c22 kept "Europe" in the title words.
 *
 * WHAT IS TRUE NOW: when remote is asked (remote true, workMode remote, or a
 * "remote" the person did not refuse in the query), the region goes to
 * `location` (as typed when it was sent as the location, else the region's
 * own word), which the board matches as text inside each posting's
 * location, and regionNote offers the country search as a
 * stated second call ("for postings that name a country, also search country
 * ..."). It never converts silently. Judged with the board's own location
 * terms and its own row-filter check on c06's real rows, and, for the query,
 * as the server runs it once lane L5 wires it: readQuery, then readRegionArgs
 * on the arguments that leaves.
 */
import { describe, expect, it } from "vitest";
import { filterViolations, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { placeTerms } from "../../supabase/functions/job-board/query-place";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { readRegionArgs } from "../../supabase/functions/agent-mcp/search-notes";
import { EUROPE_BY_POSTINGS, REGIONS } from "../../supabase/functions/agent-mcp/regions";

/** c06's ten rows as served live (title, location, country), keyless probe 2026-11-16. */
const C06 = [
  { title: "Senior Fullstack Engineer", location: "Remote - Europe; Amsterdam, Netherlands; Germany; Israel; Prague, Czech Republic; United Kingdom", country: "GB" },
  { title: "Senior Security Engineer", location: "Europe - Remote", country: null },
  { title: "Senior Backend Engineer (Python) - AI", location: "Remote - Europe Time Zones", country: null },
  { title: "Senior Product Analyst / Data Scientist", location: "Remote - Europe; Amsterdam, Netherlands", country: "NL" },
  { title: "Senior PHP/Symfony Engineer — Integrations & Automation", location: "Remote, Europe", country: null },
  { title: "Senior Product Designer", location: "Remote Europe", country: null },
  { title: "Staff Security Engineer", location: "Europe, Remote", country: null },
  { title: "Senior SRE", location: "Europe", country: null },
  { title: "Staff Data Analyst", location: "Europe (remote)", country: null },
  { title: "Senior Product Designer - Core", location: "Remote - Europe Time Zones", country: null },
];
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

const EUROPE_TOP5 = () => EUROPE_BY_POSTINGS!.order.slice(0, 5).join(",");

/** The board's location match: any of its terms inside the posting's location, case aside. */
const locationMatches = (location: string, row: { location: string }) =>
  placeTerms(location).terms.some((t) => row.location.toLowerCase().includes(t.toLowerCase()));

describe("why remote goes to location text: the board's own checks on c06's rows", () => {
  it("location Europe matches all ten", () => {
    expect(C06.filter((row) => locationMatches("Europe", row))).toHaveLength(10);
  });

  it("a 5-country filter would drop the eight that name no country", () => {
    const { applied } = normalizeFilters({ country: EUROPE_TOP5() }, 25);
    const dropped = filterViolations(C06, applied).filter((v) => v.field === "country" && v.got === "null");
    expect(dropped).toHaveLength(8);
  });
});

describe("in the query", () => {
  it("W1-7: senior data engineer jobs in Europe, remote true", () => {
    const r = readQuery("senior data engineer jobs in Europe", { remote: true });
    expect(r.query).toBe("senior data engineer");
    expect(r.location).toBe("Europe");
    expect(r.country).toBeUndefined();
    expect(r.region).toMatchObject({ key: "europe", how: "location", remote: true });
    expect(r.regionNote).toContain(`For postings that name a country, also search country ${EUROPE_TOP5()}`);
  });

  it("c22: a remote in the query asks for remote, and Europe leaves the title words", () => {
    const r = readQuery("remote senior data engineer jobs in Europe");
    expect(r.location).toBe("Europe");
    expect(r.country).toBeUndefined();
    expect(r.query.toLowerCase()).not.toContain("europe");
    expect(r.query.toLowerCase()).toContain("senior data engineer");
  });

  it("a trailing remote is lifted and the region still goes to location", () => {
    expect(readQuery("data engineer jobs in Europe remote")).toMatchObject({ query: "data engineer", location: "Europe", remote: true });
  });

  it("workMode remote asks for remote too", () => {
    const r = searched("data engineer jobs in the Nordics", { workMode: "remote" });
    expect(r.args).toMatchObject({ query: "data engineer", location: "Nordics" });
    expect(r.args.country).toBeUndefined();
    expect(r.regionNote).toContain("also search country DK,FI,IS,NO,SE");
  });

  it("with remote asked, the search stays location text once the region reader has read it", () => {
    for (const [q, input] of [["senior data engineer jobs in Europe", { remote: true }], ["remote senior data engineer jobs in Europe", {}], ["data engineer jobs in Europe remote", {}]] as const) {
      const r = searched(q, input);
      expect(r.args.location, q).toBe("Europe");
      expect(r.args.country, q).toBeUndefined();
      expect(r.region?.how, q).toBe("location");
    }
  });

  it("the same query with no remote asked is a country search instead", () => {
    expect(searched("data engineer jobs in the Nordics").args).toMatchObject({ location: null, country: "DK,FI,IS,NO,SE" });
    expect(searched("data engineer jobs in Europe").args).toMatchObject({ location: null, country: EUROPE_TOP5() });
  });

  it("a remote word the person minused is not a remote asked", () => {
    expect(searched("data engineer -remote in DACH").args.country).toBe("DE,AT,CH");
  });
});

describe("as arguments", () => {
  it("c06: location Europe with remote true is sent as typed, and the country search is offered", () => {
    const r = readRegionArgs({ query: "senior data engineer", location: "Europe", remote: true })!;
    expect(r.args).toEqual({});
    expect(r.region).toMatchObject({ key: "europe", how: "location" });
    expect(r.regionNote).toContain(`For postings that name a country, also search country ${EUROPE_TOP5()}`);
  });

  it('"Remote - Europe" as the location is remote asked, sent as typed', () => {
    const r = readRegionArgs({ query: "designer", location: "Remote - Europe" })!;
    expect(r.args).toEqual({});
    expect(r.region.how).toBe("location");
    expect(r.regionNote).toContain("also search country");
  });

  it("country EU with remote true becomes location text, with the country search offered", () => {
    const r = readRegionArgs({ query: "data engineer", country: "EU", remote: true })!;
    expect(r.args).toEqual({ country: null, location: "EU" });
    const eu = EUROPE_BY_POSTINGS!.order.filter((c) => REGIONS.eu.members.includes(c)).slice(0, 5).join(",");
    expect(r.regionNote).toContain(`also search country ${eu}`);
  });

  it("country DACH with workMode remote becomes location text", () => {
    expect(readRegionArgs({ query: "sales", country: "DACH", workMode: "remote" })!.args).toEqual({ country: null, location: "DACH" });
  });

  it("the note says what was matched, and claims no count and no first try", () => {
    const r = readRegionArgs({ query: "senior data engineer", location: "Europe", remote: true })!;
    // The board matches location as text inside each posting's location (an ILIKE), so the note says text.
    expect(r.regionNote).toMatch(/matched as text in each posting's location/);
    expect(r.regionNote).not.toMatch(/first try|all (?:remote )?postings|every posting|\d+%/i);
  });
});
