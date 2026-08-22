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
 * TWO SEARCH DEFECTS, ONE ROOT CAUSE EACH, BOTH MEASURED LIVE 2026-08-20.
 *
 * A. THE PAGE UNDER-FILLED WHEN CLUSTERING ATE THE BUFFER.
 *    "retail sales"        39 cards under a total of 3,437
 *    "customer service"    42 cards under a total of 9,846
 *    "physical therapist"  55 cards under a total of 2,675
 *    Signature on every one: nextOffset === fetchLimit, i.e. all 180 raw rows
 *    consumed and still not a full page. The 3x over-fetch is a GUESS about
 *    how much clustering will fold, and on searches where one employer posts
 *    the same title in dozens of towns the guess is wrong. A third of a page
 *    under a headline promising thousands reads as a broken board.
 *
 * B. METRO SHORTHAND WAS EITHER MISSING OR ACTIVELY WRONG.
 *    "NYC"     356 hits — misses all 10,000 "New York" postings
 *    "SF"    1,427 hits — top result "Innisfil, Ontario"  (Inni-SF-il)
 *    "LA"   10,000 hits — top result "Plain City, Ohio"   (P-LA-in)
 *    Same root cause as the query-filler bug: ILIKE %x% does not know what a
 *    word is, so a two-letter abbreviation matches inside ordinary words.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

/**
 * The top-up block, sliced to its real END rather than a guessed width.
 *
 * A [0, 2600] window missed a `catch` that sits at 2,646 — the fourth
 * fixed-width slice to silently mis-scope an assertion in this suite. A magic
 * number turns "the code changed slightly" into "the guard tests nothing",
 * and it fails in the direction that looks like success.
 */
const TOPUP = (() => {
  const start = FN.indexOf("ONE TOP-UP WHEN CLUSTERING");
  if (start < 0) return "";
  // Ends at the statement that follows the block.
  const end = FN.indexOf("// Interleave the RETURNED page only", start);
  return end > start ? FN.slice(start, end) : FN.slice(start);
})();

describe("a page fills up", () => {
  it("tops up only when the buffer was genuinely exhausted", () => {
    // Not "fewer than limit" alone — a search with 12 real matches must not
    // trigger a pointless second query on every request.
    expect(FN).toMatch(/grouped\.jobs\.length < limit &&\s*\n\s*mappedRows\.length >= fetchLimit/);
  });

  it("tops up EXACTLY ONCE — never loops until full", () => {
    // Looping would turn a heavy search into an unbounded fan of queries,
    // which is the shape that took the board down on 2026-08-17.
    const block = TOPUP;
    expect(block, "top-up block not found").not.toBe("");
    expect(block).not.toMatch(/\bwhile\s*\(/);
    expect(block).not.toMatch(/for\s*\(\s*(let|const|var)\b/);
  });

  it("anchors the top-up on the keyset cursor, so it cannot repeat or skip", () => {
    const block = TOPUP;
    expect(block).toMatch(/effective_posted\.lt\."\$\{lastRaw\.effective_posted\}"/);
    expect(block).toMatch(/id\.gt\."\$\{lastRaw\.id\}"/);
  });

  it("stays off the paths with their own offset arithmetic", () => {
    // The ranked, two-subset and salary paths compute offsets differently; a
    // top-up ignoring that would move rows across a boundary the cursor knows
    // nothing about — the exact bug the keyset work just removed.
    expect(FN).toMatch(/groupSimilar && !twoSubset && !sortSalary && !countOnly/);
  });

  it("derives BOTH the next offset and the next cursor from the merged rows", () => {
    // After a top-up the consumed rows span two fetches. Reading either from
    // the first fetch alone would send page 2 back over rows page 1 served —
    // and would silently null the cursor on exactly the queries this fixes.
    expect(FN).toMatch(/let rawSequence = mappedRows;/);
    expect(FN).toMatch(/rawSequence = \[\.\.\.mappedRows, \.\.\.extra\];/);
    expect(FN).toMatch(/const r = rawSequence\[Math\.max\(0, grouped\.rawConsumed - 1\)\]/);
  });

  it("tops up the RANKED path too — the one a typed query uses", () => {
    // The first version shipped only on the recency path and MEASURED as
    // changing nothing: "retail sales" still returned 37 cards of 60,
    // "customer service" 41, because a typed query is served by the ranked
    // path and returns long before that code runs.
    // Re-anchored: the sequence is now the sorted WINDOW on a sorted page and
    // the raw rows otherwise. What this protects is unchanged — the top-up must
    // act on the ranked path's own sequence, not the recency one.
    expect(FN).toMatch(/let rankedSequence = rankedWindow;/);
    expect(FN).toMatch(/rankedGrouped\.jobs\.length < limit && rankedRows\.length >= fetchLimit/);
    // And it must NOT run on a sorted page: its p_offset arithmetic is in
    // relevance order, which a sorted window has already left behind.
    // The top-up pages from `offset + rankedRows.length`, which is
    // relevance-order arithmetic. It must stand down for a SORTED page and now
    // also for a SCORED one — both have left that ordering behind, and both
    // already read the RPC's entire 200-row cap, so there is nothing behind the
    // window to top up with.
    expect(FN).toMatch(/if \(!newestFirst && !scoreRanked && groupSimilar && rankedGrouped\.jobs\.length < limit/);
    // Paged by p_offset past everything already read — no cursor arithmetic.
    expect(FN).toMatch(/p_offset: offset \+ rankedRows\.length,/);
    // hasMore must count the MERGED rows or "Load more" disappears early.
    // hasMore must be derived from the MERGED sequence, not the raw rows, or
    // "Load more" disappears while results remain. Asserted on the expression
    // rather than one line of it: hasMore is now a ternary (sorted pages read a
    // finite window), and pinning the old single-line spelling would fail on a
    // correct refactor and teach the next person to delete the check.
    const hm = /hasMore: \(newestFirst \|\| scoreRanked\)[\s\S]{0,220}?,\n/.exec(FN)?.[0] ?? "";
    expect(hm, "the ranked hasMore expression could not be located").not.toBe("");
    expect(
      (hm.match(/rankedSequence\.length > rankedGrouped\.rawConsumed/g) ?? []).length,
      "BOTH branches must measure what is left in the merged sequence",
    ).toBe(2);
  });

  it("serves the page it already has if the top-up fails", () => {
    const block = TOPUP;
    expect(block).toMatch(/catch \{ \/\* the page we already have is still correct/);
  });
});

describe("a metro abbreviation searches the metro", () => {
  const ALIASES = (() => {
    const b = /const METRO_ALIASES: Record<string, \{ names: string\[\]; keepRaw: boolean \}> = \{([\s\S]*?)\n\};/.exec(FN)?.[1] ?? "";
    const out: Record<string, { names: string[]; keepRaw: boolean }> = {};
    for (const m of b.matchAll(/"?([a-z ]+)"?:\s*\{\s*names:\s*\[([^\]]*)\],\s*keepRaw:\s*(true|false)/g)) {
      out[m[1].trim()] = { names: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]), keepRaw: m[3] === "true" };
    }
    return out;
  })();

  it("maps the shorthand people actually type", () => {
    expect(Object.keys(ALIASES).length).toBeGreaterThanOrEqual(8);
    expect(ALIASES["nyc"]?.names).toContain("New York");
    expect(ALIASES["sf"]?.names).toContain("San Francisco");
    expect(ALIASES["la"]?.names).toContain("Los Angeles");
  });

  it("REPLACES the noisy short forms instead of ORing them in", () => {
    // %LA% matched "Plain City, Ohio" and %SF% matched "Innisfil, Ontario".
    // Keeping the raw token would keep that garbage in the results.
    expect(ALIASES["la"]?.keepRaw, "LA is noise as a substring — must not be searched raw").toBe(false);
    expect(ALIASES["sf"]?.keepRaw, "SF is noise as a substring — must not be searched raw").toBe(false);
    // NYC is distinctive and appears in real location strings, so both.
    expect(ALIASES["nyc"]?.keepRaw).toBe(true);
  });

  it("tells the visitor the search was expanded", () => {
    // We guessed on their behalf; someone who meant something else has to be
    // able to see that.
    // Moved into the shared searchDisclosures() helper 2026-08-20. The
    // expansion notice previously reached only the recency return, so someone
    // who TYPED "SF" was never told it had been read as San Francisco — the
    // disclosure is now spread at all four list returns.
    expect(FN).toMatch(/out\.locationExpandedFrom = l\.expandedFrom; out\.locationSearched = l\.terms/);
    expect((FN.match(/\.\.\.searchDisclosures\(body, applied, maxAgeClamped\)/g) ?? []).length).toBe(7);
  });

  it("leaves a non-alias location exactly as typed", () => {
    const fn = /function locationTerms\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn).toMatch(/if \(!hit\) return \{ terms: \[clean\], expandedFrom: null \};/);
  });
});
