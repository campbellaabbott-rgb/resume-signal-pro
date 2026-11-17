// @vitest-environment node
/**
 * A REMOTE REGION SEARCH READS REMOTE REGION POSTINGS (MCP upgrade 3, W1 lane
 * L2: F1 part 1, M9, and spec risk 2 as the A/B decided it).
 *
 * WHAT WAS WRONG: the design turned "Europe" into a 5-country filter whatever
 * was asked. The live probe (c06, 2026-11-16: location "Europe" with remote
 * true) shows what that loses: 8 of its 10 rows name no country ("Remote -
 * Europe", "Europe (remote)", "Remote, Europe"), so a country filter drops
 * every one of them. The lane's first build went the other way, location
 * text first, and the review found:
 *   - the lane's own A/B (scripts/measure-region-search-ab.mjs, 2026-11-17,
 *     remote on, titles holding every query word) favoured the country
 *     filter: location "Europe" 0 of 31, 9 of 50 and 5 of 50; country
 *     GB,DE,FR,NL,ES 9 of 50, 50 of 50 and 50 of 50, with at most one row in
 *     both. Spec risk 2 had named the flip in advance ("the remote rule flips
 *     to both, stated"), and it was not applied, so W1-7's first search still
 *     found 0 matching titles;
 *   - short region words went to location text, which the board matches as a
 *     case-blind substring: live, "ANZ" returned 11 rows and none in Australia
 *     or New Zealand ("Dodoma, Tanzania"), "Iberia" 2 rows in Liberia, Costa
 *     Rica, and "EU" Eugene, OR;
 *   - a location in a remote shape ("Europe (remote)") was sent as typed,
 *     which matches 1 of c06's 10 rows, under a note promising "Remote -
 *     Europe" postings it could not match;
 *   - "remote" was asked whenever the word appeared, unlike the board's own
 *     lift ("Remote Sensing Analyst" is no remote; "wfh" is), and the check
 *     was quadratic: 800 ms on a 132,000-character query.
 *
 * WHAT IS TRUE NOW: a region with a list is searched first as its countries
 * whether remote is asked or not. When remote is asked (remote true, workMode
 * remote, a remote the board will lift from the query, or a location such as
 * "Remote - Europe", read as remote: true and said), the second search is
 * stated beside it (`alsoSearch`, and regionNote's sentence): the same search
 * with location text and no country, which reads c06's rows that name no
 * country. That text is only ever a word whose substring hits are the region
 * ("Europe" for the EU and the EEA, said to be wider); DACH, Iberia and ANZ
 * get none, and the note says why. Each note's example is matched by the text
 * it offers, under the board's own location terms. Whether remote is asked
 * mirrors the board's lift, from its own regexes, in one pass.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filterViolations, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { placeTerms } from "../../supabase/functions/job-board/query-place";
import { partMatchesTerm } from "../../supabase/functions/job-board/location-match";
import { NEGATED_REMOTE_SOURCE } from "../../supabase/functions/job-board/normalize";
import { locationTerms } from "../../supabase/functions/_shared/location-terms";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { BOARD_NEGATED_REMOTE_SOURCE, BOARD_REMOTE_LIFTS, readRegionArgs, remoteWordAsked, withRegion, withRegionArgs } from "../../supabase/functions/agent-mcp/search-notes";
import { EUROPE_BY_POSTINGS, REGIONS, SPELLINGS } from "../../supabase/functions/agent-mcp/regions";

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

/** What the server searches once lane L5 wires this lane (search-notes.ts's header): readQuery, then readRegionArgs, applied to both. */
function searched(q: string, input: Record<string, unknown> = {}) {
  const r = readQuery(q, { remote: input.remote === true, location: !!input.location, country: !!input.country });
  let args: Record<string, unknown> = { ...input, query: r.query, ...(r.location ? { location: r.location } : {}), ...(r.country ? { country: r.country } : {}), ...(r.remote ? { remote: true } : {}) };
  const found = readRegionArgs(args);
  const reading = found ? withRegion(r, found) : r;
  if (found) args = withRegionArgs(args, found.args);
  return { first: r, reading, args, found, also: found?.alsoSearch ? withRegionArgs(args, found.alsoSearch) : null };
}

const EUROPE_TOP5 = () => EUROPE_BY_POSTINGS!.order.slice(0, 5).join(",");

/** The board's location match: any of its terms inside the posting's location, case aside. */
const locationMatches = (location: string, row: { location: string }) =>
  placeTerms(location).terms.some((t) => row.location.toLowerCase().includes(t.toLowerCase()));
/** The board's own term match (location-match.ts) of a place against the text sent as location. */
const boardMatches = (place: string, sent: string) => locationTerms(sent).terms.some((t) => partMatchesTerm(place, t));

describe("why both arms: the board's own checks on c06's rows, and the A/B", () => {
  it("location Europe matches all ten", () => {
    expect(C06.filter((row) => locationMatches("Europe", row))).toHaveLength(10);
  });

  it("a 5-country filter drops the eight that name no country, so the second arm is stated", () => {
    const { applied } = normalizeFilters({ country: EUROPE_TOP5() }, 25);
    const dropped = filterViolations(C06, applied).filter((v) => v.field === "country" && v.got === "null");
    expect(dropped).toHaveLength(8);
  });

  it("the A/B printout the order came from is the one that decided the flip (its date is the stored order's)", () => {
    expect(EUROPE_BY_POSTINGS!.measuredAt).toBe("2026-11-17");
  });
});

describe("in the query", () => {
  it("W1-7: senior data engineer jobs in Europe, remote true: the country arm first, the location arm stated", () => {
    const f = searched("senior data engineer jobs in Europe", { remote: true });
    expect(f.args).toEqual({ query: "senior data engineer", remote: true, country: EUROPE_TOP5() });
    expect(f.found!.alsoSearch).toEqual({ location: "Europe", country: null });
    expect(f.also).toEqual({ query: "senior data engineer", remote: true, location: "Europe" });
    expect(C06.filter((row) => locationMatches(String(f.also!.location), row))).toHaveLength(10);
    expect(f.found!.regionNote).toContain(`country ${EUROPE_TOP5()}`);
    expect(f.found!.regionNote).toContain('run the same search again with location "Europe" and no country');
    expect(f.reading).toMatchObject({ country: EUROPE_TOP5(), region: { key: "europe", how: "country", alsoSearch: { location: "Europe" } } });
    expect((f.reading as Record<string, unknown>).location).toBeUndefined();
  });

  it("c22: a remote in the query is a remote the board lifts, and Europe leaves the title words", () => {
    const f = searched("remote senior data engineer jobs in Europe");
    expect(f.first.location).toBe("Europe");
    expect(f.args.query).toBe("remote senior data engineer");
    expect(f.args.country).toBe(EUROPE_TOP5());
    expect(f.found!.alsoSearch?.location).toBe("Europe");
  });

  it("a trailing remote is lifted and the region still goes to its countries", () => {
    expect(readQuery("data engineer jobs in Europe remote")).toMatchObject({ query: "data engineer", location: "Europe", remote: true });
    const f = searched("data engineer jobs in Europe remote");
    expect(f.args).toEqual({ query: "data engineer", remote: true, country: EUROPE_TOP5() });
    expect(f.found!.alsoSearch).toEqual({ location: "Europe", country: null });
  });

  it("workMode remote asks for remote too", () => {
    const f = searched("data engineer jobs in the Nordics", { workMode: "remote" });
    expect(f.args).toEqual({ workMode: "remote", query: "data engineer", country: "DK,FI,IS,NO,SE" });
    expect(f.found!.alsoSearch).toEqual({ location: "Nordic", country: null });
  });

  it("no remote asked: the same country search, and no second arm", () => {
    expect(searched("data engineer jobs in the Nordics").args).toEqual({ query: "data engineer", country: "DK,FI,IS,NO,SE" });
    expect(searched("data engineer jobs in Europe").found!.alsoSearch).toBeUndefined();
    expect(searched("data engineer jobs in Europe").found!.regionNote).not.toMatch(/remote/i);
  });

  it("a remote word the person minused is not a remote asked", () => {
    const f = searched("data engineer -remote in DACH");
    expect(f.args.country).toBe("DE,AT,CH");
    expect(f.found!.alsoSearch).toBeUndefined();
  });
});

describe("as arguments", () => {
  it("c06: location Europe with remote true is searched as country first, and the location arm is stated", () => {
    const r = readRegionArgs({ query: "senior data engineer", location: "Europe", remote: true })!;
    expect(r.args).toEqual({ location: null, country: EUROPE_TOP5() });
    expect(r.alsoSearch).toEqual({ location: "Europe", country: null });
    expect(r.region).toMatchObject({ key: "europe", how: "country", searched: EUROPE_TOP5().split(",") });
  });

  it.each(["Remote - Europe", "Europe (remote)", "Remote, Europe", "Europe remote", "Europe - Remote", "remote, EU", "EU remote", "Remote: Nordics", "Remote - ANZ"])(
    '%s as the location is read as remote: true and the region, and said',
    (loc) => {
      const r = readRegionArgs({ query: "designer", location: loc })!;
      expect(r.args.remote).toBe(true);
      expect(r.args.location).toBeNull();
      expect(typeof r.args.country).toBe("string");
      expect(r.regionNote.startsWith(`location "${loc}" was read as remote: true and "`)).toBe(true);
      if (r.alsoSearch) expect(r.alsoSearch).toMatchObject({ remote: true, country: null });
    },
  );

  it("country EU with remote true is the EU's head as country, and Europe as the stated location arm", () => {
    const r = readRegionArgs({ query: "data engineer", country: "EU", remote: true })!;
    const eu = EUROPE_BY_POSTINGS!.order.filter((c) => REGIONS.eu.members.includes(c)).slice(0, 5).join(",");
    expect(r.args).toEqual({ country: eu });
    expect(r.alsoSearch).toEqual({ location: "Europe", country: null });
    expect(r.regionNote).toContain("Europe is wider than the EU");
  });

  it("country DACH with workMode remote is its countries, with no text arm, and the note says why", () => {
    const r = readRegionArgs({ query: "sales", country: "DACH", workMode: "remote" })!;
    expect(r.args).toEqual({ country: "DE,AT,CH" });
    expect(r.alsoSearch).toBeUndefined();
    expect(r.regionNote).toMatch(/"DACH" is not searched as text, because other place names hold those letters/);
  });

  it("a work mode the caller sent wins over the remote in a location", () => {
    const r = readRegionArgs({ query: "nurse", location: "Remote - Europe", workMode: "hybrid" })!;
    expect(r.args.remote).toBeUndefined();
    expect(r.alsoSearch).toBeUndefined();
    expect(r.regionNote).toMatch(/the remote in it was not applied, because a work mode was sent/);
  });

  it("the note says what was matched, and claims no count and no first try", () => {
    const r = readRegionArgs({ query: "senior data engineer", location: "Europe", remote: true })!;
    expect(r.regionNote).not.toMatch(/first try|all (?:remote )?postings|every posting|\d+%/i);
  });
});

describe("no location text is a word whose letters sit inside other place names", () => {
  // Live board locations the review's read-only probes returned for these words (x-rb-budget: probe, 2026-11-17).
  it.each([
    ["Remote - Eugene, OR", "EU"], ["Berlin, Deutschland", "EU"], ["Neuquén, Argentina", "EU"], ["Dodoma, Tanzania", "ANZ"], ["Lanzhou, Gansu, China", "ANZ"],
    ["Liberia, Costa Rica", "Iberia"], ["New Iberia, LA, United States", "Iberia"], ["Dachau, Bavaria", "DACH"],
  ])("the board matches %s for location %s", (place, word) => {
    expect(boardMatches(place, word)).toBe(true);
  });

  const SHORT = new Set(["eu", "eea", "anz", "dach", "iberia"]);
  const ARGS: Array<Record<string, unknown>> = [];
  for (const [, spellings] of SPELLINGS) {
    for (const s of spellings) {
      ARGS.push({ location: s }, { location: s, remote: true }, { country: s }, { country: s, remote: true }, { location: `Remote - ${s}` }, { location: `${s} (remote)` });
    }
  }

  it("neither arm, for any spelling, as location or country, remote or not, sends one as location text", () => {
    const sent: string[] = [];
    for (const a of ARGS) {
      const r = readRegionArgs({ query: "engineer", ...a });
      expect(r, JSON.stringify(a)).not.toBeNull();
      for (const loc of [r!.args.location, r!.alsoSearch?.location]) if (typeof loc === "string") sent.push(loc.toLowerCase());
    }
    expect(sent.filter((s) => SHORT.has(s))).toEqual([]);
    expect([...new Set(sent)].sort()).toEqual(["baltics", "benelux", "europe", "ireland", "nordic", "north america"]);
  });

  it("each region's text, across the corpus's real board locations, matches only where a place starts with it, in the region", () => {
    const corpus = JSON.parse(readFileSync(resolve(__dirname, "fixtures/model-queries-2026-11.json"), "utf8")) as { titles: Array<{ location: string | null; country: string | null }> };
    let hits = 0;
    for (const reg of Object.values(REGIONS)) {
      if (!reg.text) continue;
      // The wider region a text names: Europe's text for the EU and the EEA is Europe.
      const home = reg.text === "Europe" ? REGIONS.europe.members : reg.members;
      const atWordStart = new RegExp(`(?:^|[^\\p{L}])${reg.text}`, "iu");
      for (const t of corpus.titles) {
        if (!t.location || !boardMatches(t.location, reg.text)) continue;
        hits++;
        // Never letters inside another word ("Deutschland" for EU); and the card's country in the region, unless it lists several places.
        expect(atWordStart.test(t.location), `${reg.text}: ${t.location}`).toBe(true);
        expect(t.country === null || home.includes(t.country) || t.location.includes(";"), `${reg.text}: ${t.location} (${t.country})`).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(10);
  });

  it("the words left without a text fail that same check on the corpus or live", () => {
    const corpus = JSON.parse(readFileSync(resolve(__dirname, "fixtures/model-queries-2026-11.json"), "utf8")) as { titles: Array<{ location: string | null; country: string | null }> };
    const inside = (word: string) => corpus.titles.filter((t) => t.location && boardMatches(t.location, word) && !new RegExp(`(?:^|[^\\p{L}])${word}`, "iu").test(t.location));
    const outside = (word: string, members: readonly string[]) => corpus.titles.filter((t) => t.location && boardMatches(t.location, word) && t.country !== null && !members.includes(t.country));
    expect(inside("EU").length).toBeGreaterThan(10);
    expect(outside("Iberia", REGIONS.iberia.members).length).toBeGreaterThan(0);
  });

  it("every note's example is matched by the text its second arm sends, for every spelling", () => {
    let checked = 0;
    for (const a of ARGS.filter((x) => x.remote === true || String(x.location ?? "").match(/remote/i))) {
      const r = readRegionArgs({ query: "engineer", ...a })!;
      const ex = /such as "([^"]+)"\): to find them, run the same search again with location "([^"]+)"/.exec(r.regionNote);
      if (!r.alsoSearch) {
        expect(ex, JSON.stringify(a)).toBeNull();
        continue;
      }
      expect(ex, JSON.stringify(a)).not.toBeNull();
      expect(ex![2]).toBe(r.alsoSearch.location);
      expect(boardMatches(ex![1], String(r.alsoSearch.location)), `${ex![1]} by ${r.alsoSearch.location}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe("remote is asked exactly when the board will lift it", () => {
  it("the lift's regexes are the board's own: its INTENT_FILTERS rows that patch workMode remote, and its negated remote", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    const rows = [...src.matchAll(/\{ re: (\/.+?\/i), label: "[^"]+", patch: \{ workMode: "remote" \} \}/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(BOARD_REMOTE_LIFTS.map((re) => `/${re.source}/${re.flags}`)).toEqual(rows);
    expect(BOARD_NEGATED_REMOTE_SOURCE).toBe(NEGATED_REMOTE_SOURCE);
  });

  it.each([
    ["Remote Sensing Analyst", false], ["Remote Patient Monitoring Nurse", false], ["Remote Pilot", false],
    ["remotely data engineer", true], ["data engineer wfh", true], ["work from home nurse", true], ["telework analyst", true], ["remote nurse", true],
    ["nurse not remote", false], ["non-remote nurse", false], ["nurse -remote", false], ['nurse "remote"', false], ["nurse", false],
  ])("%s: remote asked %s", (q, want) => {
    expect(remoteWordAsked(q)).toBe(want);
  });

  it("a trade term with remote in it is no remote: the region is its countries, with no second arm", () => {
    for (const q of ["Remote Sensing Analyst", "Remote Patient Monitoring Nurse"]) {
      const r = readRegionArgs({ query: q, location: "Europe" })!;
      expect(r.args, q).toEqual({ location: null, country: EUROPE_TOP5() });
      expect(r.alsoSearch, q).toBeUndefined();
    }
  });

  it("a remote word in the query counts only when the caller sent no work mode, as on the board", () => {
    expect(readRegionArgs({ query: "data engineer wfh", location: "Europe" })!.alsoSearch).toBeDefined();
    expect(readRegionArgs({ query: "remote data engineer", location: "Europe", workMode: "hybrid" })!.alsoSearch).toBeUndefined();
    expect(readRegionArgs({ query: "remote data engineer", location: "Europe", remote: false })!.alsoSearch).toBeUndefined();
  });

  it("a long query is read in one pass: 132,000 characters well inside the time the old check took", () => {
    const long = "not remote ".repeat(12_000) + "engineer in Europe";
    const t0 = performance.now();
    remoteWordAsked(long);
    readRegionArgs({ query: long, location: "Europe" });
    readQuery(long);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});
