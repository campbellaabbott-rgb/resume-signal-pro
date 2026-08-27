/**
 * "nurse london" RETURNED A SCHOOL NURSE IN NEW SOUTH WALES.
 *
 * MEASURED live 2026-08-27:
 *   q="nurse"                     title matches 10,000 (capped)
 *   q="nurse london"              title matches 0, 121 description matches
 *   q="nurse" + location=london   title matches 30, 105 related
 *
 * Typing the city into the search box did not search that city. The words are
 * ANDed against title_tsv, no title contains both, and the query fell to the
 * description tier — where "london" matches London Ontario, London Kentucky,
 * and a school nurse in Marsden Park whose description mentions London.
 * "software engineer austin" is the same shape: 0 title matches against 116
 * with the location filter set. Putting the place in the box is the most
 * ordinary thing a searcher does, and it was the query most likely to be
 * answered with noise.
 *
 * The fix is the LOCATION SPLIT TIER: when the title count is zero, split the
 * query, treat the tail as a location, and accept the split only if the head
 * has real TITLE matches inside that location. No gazetteer — the corpus
 * decides what a place is, which is what keeps "drive a truck at night" from
 * being read as jobs in Night.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
/** Comments stripped — this file quotes failure shapes to explain them. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
// The tier sits between its gate and the empty-ranked rescue gate that follows.
const tierStart = CODE.indexOf("total === 0 && ranked.length > 0");
const TIER = CODE.slice(
  tierStart,
  CODE.indexOf("if (ranked.length === 0 && offset === 0", tierStart),
);
const JOBS = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const EN = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8"));

describe("a place typed into the box reaches the location filter", () => {
  it("has the tier at all, gated on the state it fixes", () => {
    // total === 0 && rows present is precisely "the page is description-only
    // guessing". A query with real title matches must never pay this tier's
    // round trip.
    expect(TIER.length, "the location-split tier is gone").toBeGreaterThan(500);
    expect(TIER, "the tier must stand down when a location filter is already set")
      .toContain("!applied.location");
  });

  it("asks the corpus, not a city list", () => {
    // The acceptance test is TITLE matches for the head inside the tail-as-
    // location — total_rows, not row count. Description matches inside the
    // location are the same guessing this tier replaces.
    expect(TIER).toMatch(/total_rows/);
    expect(TIER, "acceptance must require real title hits").toMatch(/hits <= 0\) continue/);
    expect(CODE, "a static gazetteer will rot and be wrong about Reading and Mobile")
      .not.toMatch(/CITY_NAMES|KNOWN_CITIES|GAZETTEER/);
  });

  it("tries the longest tail first, so San Francisco is not read as Francisco", () => {
    expect(TIER).toMatch(/for \(const n of \[2, 1\]\)/);
  });

  it("sends the tail through the metro aliases like any typed location", () => {
    // "nurse philly" must reach Philadelphia the same way location=philly does.
    expect(TIER).toMatch(/p_location: rankedLocationParam\(sp\.place\)/);
  });

  it("keeps every active filter — a split search is still the user's search", () => {
    for (const p of ["p_country", "p_category", "p_experience", "p_salary_floor", "p_companies", "p_max_age_days"]) {
      expect(TIER, `${p} dropped — the split widens the search behind the user's back`).toContain(p);
    }
  });

  it("is disclosed, and the disclosure carries both halves of the guess", () => {
    // The rule intentFilters and excludedTerms already follow: a filter nobody
    // can see is a filter nobody can remove.
    expect(TIER).toMatch(/locationSplit: \{ q: won\.head, location: won\.place \}/);
    expect(JOBS, "the page never says the query was rewritten").toContain("data?.locationSplit &&");
    expect(EN.jobsPage.locationSplit, "no user-facing string").toContain("{{place}}");
  });

  it("offers to make the split real, not just to describe it", () => {
    // Clicking moves the place into the actual location filter, so counts,
    // paging and every later refinement run on the honest query.
    expect(JOBS).toMatch(/setQ\(data\.locationSplit!\.q\); setLocation\(data\.locationSplit!\.location\);/);
  });

  it("publishes the split query's count, never the original zero", () => {
    // A page of rows under a total of 0 is the contradiction this tier ends.
    expect(TIER).toMatch(/total: won\.hits/);
  });

  it("serves one page honestly rather than an incoherent page two", () => {
    // The tier fires only at offset 0; a pager following nextOffset would be
    // answered by the ORIGINAL query's ranked path — different rows wearing
    // page two's clothing. Same contract as the exact-word tier.
    expect(TIER).toMatch(/hasMore: false/);
  });

  it("cannot be the reason a response is slow", () => {
    // A bonus on a page that already has rows: half the exact-word budget, and
    // a miss falls through to the page the visitor already had.
    expect(TIER).toMatch(/Math\.min\(3_500, budgetLeft\(\)\)/);
    expect(TIER).toMatch(/catch \(\) => \(\{ data: null \}\)/.source ? /\.catch\(\(\) => \(\{ data: null \}\)\)/ : /never/);
  });

  it("refuses tails that cannot be places", () => {
    // Digits and symbols: "engineer 401k" must not probe location "401k".
    expect(TIER).toMatch(/\\p\{L\}/);
  });
});
