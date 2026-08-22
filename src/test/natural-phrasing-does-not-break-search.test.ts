import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SIX list exits since routed retrieval landed (recency, ranked, fuzzy,
 * semantic, exact-word, routed). The count is asserted rather than a minimum
 * precisely so that adding an exit FAILS here and forces every disclosure
 * onto it — which is what happened, again, and is why this number keeps
 * moving.
 *
 * FIVE list exits since the simple-config tier landed (recency, ranked,
 * fuzzy, semantic, exact-word). The count is asserted rather than a minimum
 * precisely so that ADDING an exit fails here and forces the author to carry
 * every disclosure onto it — which is what happened.
 *
 * THE BOARD WAS AT ITS WORST WHEN SOMEONE TYPED NATURALLY.
 *
 * MEASURED on the live board 2026-08-20:
 *   "electrician"              979 results, top hit a real electrician role
 *   "electrician jobs near me"  44 results, top hit "Maintenance II-ARP"
 *
 * A 95% collapse and a wrong top result, from four words that say nothing
 * about the role. Two mechanisms combine:
 *   1. terms are ANDed, so every extra word can only shrink the set;
 *   2. terms are matched as SUBSTRINGS, so `%me%` matches "Maintenance",
 *      "Management", "Commercial".
 * Filler does not merely narrow a search — it poisons it with whatever
 * contains those letters. And "jobs near me" is how a very large share of
 * real people phrase a job search.
 *
 * What this file pins is the SHAPE of the fix, because each property was a
 * decision that could go wrong in the opposite direction.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

// Reconstruct the shipped list so the assertions test the real thing.
const FILLER = (() => {
  const block = /const QUERY_FILLER = new Set\(\[([\s\S]*?)\]\);/.exec(FN)?.[1] ?? "";
  return new Set([...block.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
})();

describe("natural job-search phrasing survives", () => {
  it("drops the words that cannot be part of a job title", () => {
    expect(FILLER.size, "QUERY_FILLER not parsed").toBeGreaterThan(10);
    for (const w of ["jobs", "job", "careers", "near", "me", "hiring", "openings", "positions"]) {
      expect(FILLER.has(w), `"${w}" should be treated as filler`).toBe(true);
    }
  });

  it("NEVER drops a word that appears in real job titles", () => {
    // The mirror of the bug being fixed: dropping these would silently WIDEN
    // a search the person meant to narrow. Every one is in live titles on
    // this board.
    for (const w of ["remote", "senior", "junior", "lead", "part", "time",
                     "contract", "intern", "manager", "night", "weekend"]) {
      expect(FILLER.has(w), `"${w}" appears in real titles and must be kept`).toBe(false);
    }
  });

  it("falls back to the raw query when filler was all there was", () => {
    // "jobs near me" strips to nothing. An empty term list returns the WHOLE
    // board, which reads as the search box being broken. Running the poor
    // query the person typed is better than silently ignoring them.
    const fn = /function queryTerms\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn, "queryTerms not found").not.toBe("");
    // Re-anchored 2026-08-20. The fallback still exists and still matters, but
    // it is now CONDITIONAL: it fires for an all-filler query and must NOT fire
    // when a pay figure was lifted out, because returning `all` there put the
    // money token back as a required title word and q="120000" returned zero.
    // See a-pay-figure-is-a-filter-not-a-word for that half.
    expect(fn).toMatch(/return \{ terms: all, dropped: \[\], liftedSalary: false \};/);
  });

  it("applies to the RANKED path — the one a typed query actually uses", () => {
    // The first version wired queryTerms into the two ILIKE term-builders and
    // MEASURED after deploy as changing nothing a searcher would notice:
    // "electrician jobs near me" still returned 44 rows topped by
    // "Maintenance II-ARP". A typed query is served by the ranked path, and
    // that path tsquery-ises qText — which was still the raw string. The
    // browse path is the one nobody types filler into.
    expect(FN).toMatch(/const qText = qt\.terms\.join\(" "\)/);
    // The count probe must ask the same question, or the total disagrees with
    // the results on screen.
    expect(FN).toMatch(/const qTextC = qtC\.terms\.join\(" "\)/);
    // Both keep the raw-text fallback for an all-filler query — now guarded so
    // it does not fire when the query was only a pay figure.
    expect((FN.match(/liftedSalary \? "" : String\(body\.q \?\? ""\)\.trim\(\)\.slice\(0, 200\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });

  it("applies to BOTH term-building sites, not just one", () => {
    // Two independent paths built terms from body.q. Fixing one and not the
    // other would leave the ranked path and the fallback path disagreeing
    // about what the visitor searched for.
    expect((FN.match(/queryTerms\(body\.q\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The raw lowercase split is what queryTerms replaced; qText's fallback
    // uses .trim() and is a different expression, so this stays precise.
    expect(FN).not.toMatch(/String\(body\.q \?\? ""\)\.toLowerCase\(\)\.split\(/);
  });

  it("tells the visitor which words it ignored", () => {
    // Silently rewriting someone's search is its own failure. The board
    // already names filters it cannot honour; dropped words get the same
    // treatment.
    // Moved into the shared searchDisclosures() helper, which is spread at all
    // four list returns rather than the recency one alone — searchers were
    // never told what had been dropped.
    expect(FN).toMatch(/out\.droppedTerms = dropped/);
    expect((FN.match(/\.\.\.searchDisclosures\(body, applied\)/g) ?? []).length).toBe(7);
    expect(UI).toMatch(/droppedTerms\?: string\[\];/);
    expect(UI).toMatch(/jobsPage\.droppedTerms/);
  });
});
