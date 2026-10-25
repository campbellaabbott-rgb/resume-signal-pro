import { describe, expect, it } from "vitest";
import {
  foldName, pickRoute, scoreTitle, splitExclusions, wordCount,
  OCCUPATION_GUARD,
} from "../../supabase/functions/job-board/search-routing";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";

/**
 * A SCORER THAT HANGS ON ONE LETTER, and three quieter ways to lie.
 *
 * Four defects, every one confirmed by EXECUTING the shipped module — the
 * whole reason search-routing.ts is importable is that guards which match
 * source text pass while the code they describe is deleted.
 *
 *   1. wordCount's overlap rewind re-found the same match forever when the
 *      match was one character at position 0. foldName("c++") is "c"; one
 *      retrieved title "C" and scoreTitle never returned — the search request
 *      hung, not erred, which is the worst of the two.
 *   2. OCCUPATION_GUARD missed the place-name/common-word keys the 2026-08-21
 *      alias regeneration minted, so "wisconsin" collapsed the board to the
 *      University of Wisconsin and "flex" to Flextronics.
 *   3. "not" claimed the whole remainder: "director not for profit" excluded
 *      ["for","profit"] — striking the exact nonprofit titles asked for AND
 *      every title containing "for".
 *   4. Query tokens were folded into blobs no title tokenization produces:
 *      "k-8 teacher" carried "k8", "c++/c#" became "cc", and the old foldName
 *      DELETED accented letters, "L'Oréal" -> "loral".
 */

describe("the one-letter hang, and the overlap counts the fix must not change", () => {
  it("scoreTitle('C','c++') returns, and fast", () => {
    // Before the forward-progress guard this line never returned at all: the
    // rewind put lastIndex back to 0 after a length-1 match at position 0 and
    // exec re-found it forever. A timing bound, not just termination, so a
    // future accidental O(n^2) rewrite also trips it.
    const t0 = Date.now();
    const s = scoreTitle("C", "c++");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(Number.isFinite(s)).toBe(true);
    expect(wordCount("c", "c")).toBe(1);
  });

  it("keeps every count the rewind was written for", () => {
    // Pinned by running the OLD loop on inputs it could finish, before the
    // fix: the trailing boundary of one match is the leading boundary of the
    // next, so without the rewind "c c c" counts 2 and the 4x-"Sales" titles
    // the repetition penalty exists for count 2, not 4.
    expect(wordCount("c c c", "c")).toBe(3);
    expect(wordCount("sales sales sales sales", "sales")).toBe(4);
    // A normal multi-word title is unchanged too.
    expect(wordCount("senior sales manager", "sales")).toBe(1);
    // And the whole-word boundary still holds: substrings do not count.
    expect(wordCount("management", "manager")).toBe(0);
  });
});

describe("a common word must never silently collapse the board to one employer", () => {
  it("guards the place names and common words the alias regeneration minted", () => {
    // Each of these IS a live alias key — asserted, so this test proves the
    // guard is doing the work rather than the key having been dropped.
    for (const q of ["wisconsin", "flex", "mars"]) {
      expect(EMPLOYER_ALIASES[q], `${q} must exist as an alias key`).toBeTruthy();
      expect(pickRoute(q, EMPLOYER_ALIASES).route, `"${q}" must not collapse the board`).not.toBe("EMPLOYER");
      expect(OCCUPATION_GUARD.has(q)).toBe(true);
    }
    // The rest of the 2026-08-21 class, cheap to hold and expensive to lose.
    for (const q of ["rochester", "card", "wood", "republic", "ace", "benchmark", "arrow", "continental", "intuitive", "infuse", "sec", "nov", "ing"]) {
      expect(pickRoute(q, EMPLOYER_ALIASES).route, `"${q}" must not collapse the board`).not.toBe("EMPLOYER");
    }
  });

  it("still routes an unambiguous employer name — the guard is a list, not a wall", () => {
    // Verified against the live alias table: "northrop grumman" folds to a key
    // nobody types as anything but the company.
    const r = pickRoute("Northrop Grumman", EMPLOYER_ALIASES);
    expect(r.route).toBe("EMPLOYER");
    expect(r.matchedName).toBe("Northrop Grumman");
    expect(r.tokens?.length).toBeGreaterThan(0);
  });
});

describe("'not' marks one token, and never a stopword", () => {
  it("leaves 'director not for profit' alone — that is a search FOR nonprofits", () => {
    expect(splitExclusions("director not for profit")).toEqual({ positive: "director not for profit", excluded: [] });
  });

  it("still splits the ordinary refinement", () => {
    expect(splitExclusions("engineer not manager")).toEqual({ positive: "engineer", excluded: ["manager"] });
  });

  it("claims exactly one token — the words after it stay positive", () => {
    // The old remainder rule excluded "er" too, striking every ER nurse title
    // the query was refining toward.
    expect(splitExclusions("nurse not travel er")).toEqual({ positive: "nurse er", excluded: ["travel"] });
  });

  it("keeps the refuse-to-eat-the-query guards standing", () => {
    // Same shapes engineer-not-manager-returned-managers.test.ts pins; held
    // here too so this file fails on its own if the guard regresses.
    expect(splitExclusions("not manager")).toEqual({ positive: "not manager", excluded: [] });
    expect(splitExclusions("-manager")).toEqual({ positive: "-manager", excluded: [] });
    expect(splitExclusions("engineer not").excluded).toEqual([]);
  });
});

describe("query tokens get the SAME split titles get, and diacritics transliterate", () => {
  it("scores 'Teacher, K-8' above 'Math Teacher' for q='k-8 teacher'", () => {
    // The old whitespace-split+fold made the token "k8", which no title
    // tokenization can produce, so the exact-shape title lost on coverage.
    expect(scoreTitle("Teacher, K-8", "k-8 teacher")).toBeGreaterThan(scoreTitle("Math Teacher", "k-8 teacher"));
  });

  it("scores 'C++ Developer' above 'CEO' for q='c++/c#'", () => {
    // "c++/c#" used to fold to the single token "cc" — matched by nothing, so
    // every real title paid the length penalty and CEO's empty zero won.
    expect(scoreTitle("C++ Developer", "c++/c#")).toBeGreaterThan(scoreTitle("CEO", "c++/c#"));
  });

  it("transliterates diacritics instead of deleting the letter", () => {
    expect(foldName("L'Oréal")).toContain("oreal");
    // And the folds every existing caller depends on are byte-identical.
    expect(foldName("AT&T")).toBe("att");
    expect(foldName("Domino's")).toBe("dominos");
  });
});
