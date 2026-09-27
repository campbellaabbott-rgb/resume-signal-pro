import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

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
const SHARED = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/location-terms.ts"), "utf8"); // definitions moved here 2026-09-03; call sites stay in index.ts


/**
 * The top-up block, sliced between two lines of CODE and read two ways.
 *
 * It used to be sliced between two comment sentences: the heading of the
 * block's own rationale and the heading of the paragraph after it. On
 * 2026-09-27 every long comment run in index.ts moved to
 * docs/job-board-index-notes.md (the deploy-upload cap counts raw source
 * bytes), both landmarks left with them, and this slicer returned "" — three
 * assertions went red over a move that changed no code. Prose beside a block
 * can be moved, reworded or trimmed without the block changing, so it is not
 * a position. The block is now located by its own gate (the first condition
 * of its `if`) and by the statement that follows it, each unique in the file.
 *
 * Missing either landmark yields "" and the not-found assertion, never a
 * slice that runs on to the end of the file. A [0, 2600] window once missed
 * a `catch` that sat at 2,646 — the fourth fixed-width slice to silently
 * mis-scope an assertion in this suite — and an open-ended slice fails the
 * same way: the guard reads a region it did not mean, in the direction that
 * looks like success.
 */
const TOPUP_GATE = "groupSimilar && !twoSubset && !sortSalary && !countOnly &&";
const TOPUP_NEXT = "if (!sortSalary) grouped.jobs = interleaveByCompany(grouped.jobs);";
function topUpBlockOf(src: string): string {
  const gate = src.indexOf(TOPUP_GATE);
  if (gate < 0) return "";
  const start = src.lastIndexOf("if (", gate);
  if (start < 0 || src.slice(start, gate).trim() !== "if (") return "";
  const end = src.indexOf(TOPUP_NEXT, gate);
  return end < 0 ? "" : src.slice(start, end);
}
/** Comments gone: what every assertion about the block's CODE reads. */
const TOPUP_CODE = topUpBlockOf(codeOf(FN));
/** Comments kept: for the one check that is about the note inside the catch. */
const TOPUP = topUpBlockOf(FN);

describe("a page fills up", () => {
  it("tops up only when the buffer was genuinely exhausted", () => {
    // Not "fewer than limit" alone — a search with 12 real matches must not
    // trigger a pointless second query on every request.
    //
    // THE `!newestFirst` TERM IS GONE FROM THIS GATE AND MUST STAY GONE. It was
    // written when "newest" was an opt-in sort, and its stated reason ("a thin
    // newest page stays thin") was about the ANCHOR rather than the order. Since
    // the ordinary browse asks for sort:"newest" on every request, that term
    // retired this mechanism on the board's most common page — and the starvation
    // it exists for was measured exactly there ("retail sales" 39 cards under a
    // total of 3,437). The anchor now follows the order instead; see the keyset
    // case below.
    expect(FN).toMatch(/grouped\.jobs\.length < limit &&\s*\n\s*mappedRows\.length >= fetchLimit/);
    const gate = FN.slice(
      FN.indexOf("groupSimilar && !twoSubset && !sortSalary && !countOnly &&"),
      FN.indexOf("mappedRows.length >= fetchLimit"),
    );
    expect(gate, "the top-up is gated off the newest order again — that is now every browse page")
      .not.toMatch(/!newestFirst/);
  });

  it("tops up EXACTLY ONCE — never loops until full", () => {
    // Looping would turn a heavy search into an unbounded fan of queries,
    // which is the shape that took the board down on 2026-08-17.
    const block = TOPUP_CODE;
    expect(block, "top-up block not found").not.toBe("");
    expect(block).not.toMatch(/\bwhile\s*\(/);
    expect(block).not.toMatch(/for\s*\(\s*(let|const|var)\b/);
  });

  it("anchors the top-up on the keyset cursor, in whichever column the page is ordered by", () => {
    /* THE ANCHOR FOLLOWS THE ORDER. It used to be hardcoded to
     * `effective_posted`, which is why the gate above had to exclude the newest
     * order: continuing an effective_posted coordinate through a
     * (posted_at DESC NULLS LAST, id) ordering moves rows across a page boundary
     * the cursor knows nothing about. Naming the column from `newestFirst` makes
     * the same two-arm seek correct in both orders, so the exclusion is no longer
     * needed and the mechanism reaches the ordinary browse again. */
    const block = TOPUP_CODE;
    expect(block, "top-up block not found").not.toBe("");
    expect(block).toMatch(/const anchorCol = newestFirst \? "posted_at" : "effective_posted";/);
    expect(block).toMatch(/const anchorVal = newestFirst \? lastRaw\?\.posted_at : lastRaw\?\.effective_posted;/);
    // Two arms against that one column, id tiebreak inside the eq arm only.
    expect(block).toMatch(/\$\{anchorCol\}\.lt\."\$\{anchorVal\}",and\(\$\{anchorCol\}\.eq\."\$\{anchorVal\}",id\.gt\."\$\{lastRaw\.id\}"\)/);
    // SKIPPED, NOT FAKED, when the last raw row carries no date: a posted_at
    // comparison cannot describe the undated tail, and a short page is honest there.
    expect(block).toMatch(/if \(anchorVal && lastRaw\?\.id\)/);
  });

  it("stays off the paths with their own offset arithmetic", () => {
    // The ranked, two-subset and salary paths compute offsets differently; a
    // top-up ignoring that would move rows across a boundary the cursor knows
    // nothing about — the exact bug the keyset work just removed.
    expect(FN).toMatch(/groupSimilar && !twoSubset && !sortSalary && !countOnly/);
  });

  it("derives BOTH the next offset and the next cursor from the merged rows", () => {
    // After a top-up the consumed rows span two fetches. Reading either from
    // the first fetch alone would send page 2 back over rows page 1 served.
    //
    // TWO ARRAYS, KEPT IN LOCKSTEP. rawSequence holds MAPPED jobs because
    // collapseClusters needs job shape to fold on; rawKeys holds the RAW rows
    // because the keyset lives on `effective_posted`, which rowToJob does not
    // carry. The cursor read the mapped array for five days and was therefore
    // null on every response ever served — the line below said "cursor" and
    // meant it, and still could not see that. Both arrays must merge, or the
    // cursor names a row from the first fetch while the page ended in the
    // second.
    expect(FN).toMatch(/let rawSequence = mappedRows;/);
    expect(FN).toMatch(/rawSequence = \[\.\.\.mappedRows, \.\.\.extra\];/);
    expect(FN).toMatch(/let rawKeys = \(data \?\? \[\]\) as Array</);
    expect(FN).toMatch(/rawKeys = \[\.\.\.rawKeys, \.\.\.\(\(topUp\.data \?\? \[\]\) as typeof rawKeys\)\];/);
    expect(FN).toMatch(/const r = rawKeys\[Math\.max\(0, grouped\.rawConsumed - 1\)\]/);
    // The top-up's own anchor reads the same raw array. It read the mapped one
    // too, which is why the top-up had NEVER RUN: its gate is
    // `lastRaw?.effective_posted`, and that was always undefined.
    expect(FN).toMatch(/const lastRaw = rawKeys\[rawKeys\.length - 1\] as \{ effective_posted\?: string; posted_at\?: string; id\?: string \} \| undefined;/);
  });

  it("the ranked top-up stayed deleted, and hasMore still measures the merged sequence", () => {
    // The ranked top-up this test used to pin was DEAD CODE: inside the ranked
    // block scoreRanked is exactly !newestFirst, so its gate
    // `!newestFirst && !scoreRanked` was unsatisfiable and the second fetch it
    // promised for short pages never ran once (2026-08-29 six-lens sweep).
    // What this test protected — "retail sales" returning 37 cards of 60 —
    // was never protected by that block, and its p_offset arithmetic
    // (`offset + rankedRows.length`, relevance coordinates) is unsafe in both
    // the windowed and the deep regime. It is deleted, not revived; a short
    // page with a correct nextOffset is the honest behaviour.
    expect(FN).toMatch(/const rankedSequence = rankedWindow;/);
    const stripped = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "the unsatisfiable gate must not return").not.toMatch(/!newestFirst && !scoreRanked && groupSimilar/);
    // hasMore must be derived from the MERGED sequence, not the raw rows, or
    // "Load more" disappears while results remain. Asserted on the expression
    // rather than one line of it. FOUR branches now: deep, ring-merged
    // sub-seam, windowed, and plain — each must measure what is left in the
    // sequence it serves from.
    const hm = /hasMore: deepPage[\s\S]{0,1200}?,\n/.exec(FN)?.[0] ?? "";
    expect(hm, "the ranked hasMore expression could not be located").not.toBe("");
    expect(
      (hm.match(/rankedSequence\.length > rankedGrouped\.rawConsumed/g) ?? []).length,
      "EVERY branch must measure what is left in the merged sequence — there are " +
        "four now that a ring-merged query has its own seam",
    ).toBe(4);
  });

  it("serves the page it already has if the top-up fails", () => {
    const block = TOPUP_CODE;
    expect(block, "top-up block not found").not.toBe("");
    // ONE catch in the block, and it is empty of code: nothing rethrown,
    // nothing returned, so the page assembled before the try is what goes
    // out. Read with comments gone — the note inside the braces used to be
    // the whole assertion, and a catch that rethrew behind that note would
    // have passed it.
    expect((block.match(/\bcatch\b/g) ?? []).length, "one catch, the top-up's own").toBe(1);
    // After `catch`: an optional binding, an optional pair of empty braces,
    // then the brace that closes the enclosing block. The braces are optional
    // because the stripper folds a brace pair holding only a block comment
    // into one space; the emptiness is not optional.
    const after = block.slice(block.search(/\bcatch\b/) + "catch".length);
    expect(after, "the catch runs code before the page is served").toMatch(/^\s*(\([^)]*\)\s*)?(\{\s*\})?\s*\}/);
    // The swallow says why, inside the braces, so the next reader does not
    // delete an "empty" catch as a bug. The shape is pinned, not the words.
    expect(TOPUP).toMatch(/catch \{ \/\*[^*]+\*\/ \}/);
  });
});

describe("a metro abbreviation searches the metro", () => {
  const ALIASES = (() => {
    const b = /const METRO_ALIASES: Record<string, \{ names: string\[\]; keepRaw: boolean \}> = \{([\s\S]*?)\n\};/.exec(SHARED)?.[1] ?? "";
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
    // NINE since 2026-09-26: the newest-sorted text search got its own exit
    // (searchRoute NEWEST, ordered by posted_at in SQL over the whole title-match
    // set). The count rose because that exit carries this spread like the other
    // eight — a path that had gone mute would have LOWERED it.
    expect((FN.match(/\.\.\.searchDisclosures\(body, applied, maxAgeClamped\)/g) ?? []).length).toBe(9);
  });

  it("leaves a non-alias location exactly as typed", () => {
    const fn = /function locationTerms\([\s\S]*?\n}/.exec(SHARED)?.[0] ?? "";
    expect(fn).toMatch(/if \(!hit\) return \{ terms: \[clean\], expandedFrom: null \};/);
  });
});
