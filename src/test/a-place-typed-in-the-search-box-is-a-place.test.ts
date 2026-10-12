// @vitest-environment node
/**
 * A PLACE TYPED INTO THE SEARCH BOX IS A PLACE (wave 4, job-board .93).
 *
 * Live 2026-10-12: q "nurse jobs in Texas" returned 104 rows (titles holding
 * both words), q "nurse" with location "Texas" 1,592. Location "Austin, TX"
 * matched 2,564 rows and missed the 1,297 spelled "Austin, Texas". The pure
 * rules are walked here, then the shipped handler is asked the same questions.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { COUNTRY_NAMES, knownPlace, liftTrailingPlace, placeTerms, rankedPlaceParam } from "../../supabase/functions/job-board/query-place";
import { statedCountry } from "../../supabase/functions/job-board/normalize";
import { bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const FILLER = new Set(["job", "jobs", "career", "careers", "position", "positions", "opening", "openings", "in", "near", "around", "the", "a", "for"]);

describe("the trailing place a query names (query-place.ts)", () => {
  it.each([
    ["nurse jobs in Texas", "nurse jobs", { location: "Texas" }, "in Texas"],
    ["software engineer jobs in new york", "software engineer jobs", { location: "new york" }, "in new york"],
    ["barista near Austin", "barista", { location: "Austin" }, "near Austin"],
    ["data analyst in Austin, TX", "data analyst", { location: "Austin, TX" }, "in Austin, TX"],
    ["accountant in Germany", "accountant", { country: "DE" }, "in Germany"],
    ["teacher in the UK", "teacher", { country: "GB" }, "in UK"],
    ["developer in NYC", "developer", { location: "NYC" }, "in NYC"],
    ["jobs in Texas", "", { location: "Texas" }, "in Texas"],
  ])("%s", (q, head, patch, label) => {
    expect(liftTrailingPlace(q, FILLER)).toEqual({ head, patch, label });
  });

  it.each([
    "Engineer in Training",
    "Head of Growth in Fintech",
    "Sign in specialist",
    "Director of IN programs",
    "Remote Sensing Analyst",
    "nurse in OR",
    "jobs near me",
    "teacher in reading",
    "chef in Nice",
    "join us",
    "nurse in uk",
    "in Texas",
  ])("leaves %s as search text", (q) => {
    expect(liftTrailingPlace(q, FILLER)).toBeNull();
  });

  it("resolves the ambiguous ones as documented", () => {
    // Georgia and Washington are the US states the board's alias table knows;
    // "Ontario, CA" is the city in California, and the state code keeps it there.
    expect(knownPlace("Georgia")).toEqual({ location: "Georgia" });
    expect(knownPlace("Washington")).toEqual({ location: "Washington" });
    expect(knownPlace("Ontario, CA")).toEqual({ location: "Ontario, CA" });
    expect(placeTerms("Ontario, CA").terms).toEqual(["Ontario, CA", "Ontario, California", "Ontario,CA"]);
  });

  it("every country name is the code the country column holds", () => {
    for (const [name, code] of Object.entries(COUNTRY_NAMES)) {
      const typed = name.length <= 3 ? name.toUpperCase() : name.replace(/\b\w/g, (c) => c.toUpperCase());
      expect(statedCountry(`Somewhere, ${typed}`), `${name} -> ${code}`).toBe(code);
    }
  });
});

describe('"City, ST" is the city in that state, however the employer spells it', () => {
  it("searches all three spellings and says it expanded", () => {
    expect(placeTerms("Austin, TX")).toEqual({ terms: ["Austin, TX", "Austin, Texas", "Austin,TX"], expandedFrom: "Austin, TX" });
    expect(placeTerms("Austin, Texas").terms).toEqual(["Austin, TX", "Austin, Texas", "Austin,TX"]);
    expect(rankedPlaceParam("Washington, DC")).toBe("Washington, DC|Washington, District of Columbia|Washington,DC");
  });

  it("anything else reads exactly as the shared aliases always did", () => {
    expect(placeTerms("Texas")).toEqual({ terms: ["Texas", ", TX"], expandedFrom: "Texas" });
    expect(placeTerms("Austin")).toEqual({ terms: ["Austin"], expandedFrom: null });
    expect(placeTerms("Berlin, Germany")).toEqual({ terms: ["Berlin, Germany"], expandedFrom: null });
    expect(rankedPlaceParam("")).toBeNull();
  });
});

let board: BoardHandler;
beforeAll(async () => { board = await bootBoardHandler(); });

/** Every location the request sent to the database: search_jobs' p_location, and the browse filter on the column. */
function locationsSent(): string[] {
  const out: string[] = [];
  for (const q of board.db.queries as Query[]) {
    for (const [m, a] of q.calls) {
      if (m === "rpc") {
        const loc = (a[0] as { p_location?: unknown } | undefined)?.p_location;
        if (typeof loc === "string") out.push(loc);
      } else if ((m === "ilike" && a[0] === "location") || (m === "or" && String(a[0]).includes("location."))) {
        out.push(String(a[m === "ilike" ? 1 : 0]));
      }
    }
  }
  return out;
}

/** The query words search_jobs was asked for. */
const qSent = () => (board.db.queries as Query[]).filter((q) => q.rpc === "search_jobs")
  .map((q) => String((q.calls[0][1][0] as { p_q?: unknown }).p_q ?? ""));

describe("the shipped list reads the place as a place", () => {
  it("nurse jobs in Texas: the location filter, the place gone from the query, and the move named", async () => {
    board.reset();
    const r = await board.post({ action: "list", q: "nurse jobs in Texas", limit: 10 });
    expect(r.intentFilters, JSON.stringify(r).slice(0, 300)).toEqual(["in Texas"]);
    const locs = locationsSent();
    expect(locs.length, "no query carried a location").toBeGreaterThan(0);
    expect(locs.every((l) => l.includes("Texas")), locs.join(" / ")).toBe(true);
    expect(qSent().some((q) => /texas/i.test(q)), qSent().join(" / ")).toBe(false);
  });

  it("noIntent (the page's undo) keeps every word as search text", async () => {
    board.reset();
    const r = await board.post({ action: "list", q: "nurse jobs in Texas", noIntent: true, limit: 10 });
    expect(r.intentFilters).toBeUndefined();
    expect(locationsSent().some((l) => l.includes("Texas")), "the undo still filtered by place").toBe(false);
  });

  it("a location the caller set wins; the typed place stays text", async () => {
    board.reset();
    const r = await board.post({ action: "list", q: "nurse in Texas", location: "Ohio", limit: 10 });
    expect(r.intentFilters).toBeUndefined();
    expect(locationsSent().every((l) => l.includes("Ohio")), locationsSent().join(" / ")).toBe(true);
  });

  it('location "Austin, TX" searches the city in Texas under every spelling, and says so', async () => {
    board.reset();
    const r = await board.post({ action: "list", q: "nurse", location: "Austin, TX", limit: 10 });
    expect(r.locationExpandedFrom).toBe("Austin, TX");
    expect(r.locationSearched).toEqual(["Austin, TX", "Austin, Texas", "Austin,TX"]);
    const locs = locationsSent();
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.every((l) => l.includes("Austin, Texas")), locs.join(" / ")).toBe(true);
  });
});
