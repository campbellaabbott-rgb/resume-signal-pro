import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickRoute, splitExclusions } from "../../supabase/functions/job-board/search-routing";

/**
 * THREE DEFECTS, ONE BATTERY (2026-08-31, snap-2026-08-31-pre-agency).
 *
 *   q="director not for profit"   9,381ms   the SIMPLE route's retriever held
 *                                           a bare 7s deadline, missed it on a
 *                                           four-token conjunction, and the
 *                                           request then still paid the whole
 *                                           ranked pipeline behind the
 *                                           fall-through — past every
 *                                           decoration deadline.
 *   q="Collabera"                 6,489ms   zero results, and the ladder paid
 *                                           an embed + ANN + hydration to
 *                                           prove an emptiness three lexical
 *                                           engines had already resolved.
 *   q="RN" / "engineer not manager"  null   pages served with no figure while
 *                                           holding one that is true under an
 *                                           honest name: a full routed block
 *                                           proves a floor, and a withdrawn
 *                                           exclusion total is still a
 *                                           labelled ceiling.
 *
 * The pure functions are EXECUTED; the edge function cannot be imported, so
 * its wiring is matched against source with comments stripped before any
 * negative assertion — a guard's own literal in a comment has passed a dead
 * check in this repo repeatedly.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("a deadline on the primary path sums with everything behind it", () => {
  it("the trap query really does walk in through the router", () => {
    // The exclusion parser correctly vetoes "not for" (a search FOR nonprofit
    // titles keeps its words), and the stopword rule then sends the intact
    // four-token query to SIMPLE — so the retriever that pays for it is the
    // routed one, not the ranked RPC. Both decisions run here, not a copy.
    expect(splitExclusions("director not for profit"))
      .toEqual({ positive: "director not for profit", excluded: [] });
    expect(pickRoute("director not for profit", {}).route).toBe("SIMPLE");
  });

  it("the routed deadline is sized by the query's shape", () => {
    // 7s was sized against a cold-start spike measured on ONE-token q="IT" —
    // the shape this route exists for — and those keep it: shortening it
    // re-opens the same-query-two-answers coin toss the exact-word tier's own
    // test pins. A wide conjunction that has not answered in 2.5s is already
    // degenerating to the date-index walk, and the measured run spent its full
    // seven seconds to return nothing.
    expect(CODE).toMatch(/const routedQueryTokens = qText\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.length;/);
    expect(CODE).toMatch(/const ROUTED_DEADLINE_MS = routedQueryTokens >= 3 \? 2_500 : 7_000;/);
  });

  it("both routed queries draw it from the request budget — no bare deadline remains", () => {
    // The routed count mirrors the routed list verbatim, and that includes how
    // long each may run: one clamp per site, and the old bare literal gone
    // from both. An unclamped deadline on a path that FALLS THROUGH sums with
    // the entire pipeline behind it — the exact failure REQUEST_BUDGET_MS was
    // introduced to cap.
    expect((CODE.match(/Math\.min\(ROUTED_DEADLINE_MS, budgetLeft\(\)\)/g) ?? []).length).toBe(2);
    expect(CODE, "a routed query has grown a bare deadline again")
      .not.toMatch(/\.range\(blockStart, blockStart \+ ROUTE_WINDOW - 1\),\s*7_000,/);
    expect(CODE, "the routed count has grown a bare deadline again")
      .not.toMatch(/\.range\(0, ROUTE_WINDOW - 1\),\s*7_000,/);
  });
});

describe("a ladder that has proven emptiness stops paying for it", () => {
  it("proof is a resolved, error-free, empty answer — never a miss", () => {
    // A deadline miss resolves {data:null}, a thrown half yields the same []
    // downstream; treating either as proof is how a degraded ladder gets
    // mistaken for a decisive one. The exact-word flag demands BOTH halves
    // resolve as error-free arrays; the trigram flag demands the RPC itself
    // resolved. A tier that failed leaves its flag false and the rescue runs.
    expect(CODE).toMatch(/let simpleTierProvedEmpty = false;/);
    expect(CODE).toMatch(/let fuzzyTierProvedEmpty = false;/);
    expect(CODE).toMatch(/simpleTierProvedEmpty = halves\.every\(\(h\) =>\s*\n\s*h && !h\.error && Array\.isArray\(h\.data\) && h\.data\.length === 0\);/);
    expect(CODE).toMatch(/if \(!fErr && Array\.isArray\(fuzzy\)\) fuzzyTierProvedEmpty = fuzzy\.length === 0;/);
  });

  it("the semantic rescue declines when both proofs hold, and only then", () => {
    // The vector tier can only ship rows passing its lexical anchor, and by
    // the time both flags are set, search_jobs, the exact-word pair and the
    // trigram tier have all resolved empty on the same corpus — the anchor is
    // as good as unsatisfiable, and finding that out the long way costs a
    // cold-isolate model load, an HNSW scan and a hydration round trip.
    // The reviewer narrowed the skip to single-token queries the same day: the
    // emptiness proofs are whole-query facts, and a multi-token query could
    // still rescue on a subset — the measured offender class (bare company
    // names) is single-token anyway.
    expect(CODE).toMatch(/if \(qText\.length >= 3 && !\(simpleTierProvedEmpty && fuzzyTierProvedEmpty && qTokenCount <= 1\)\) \{/);
    // The gate reads the flags AFTER the tiers that set them.
    const gateAt = CODE.indexOf("!(simpleTierProvedEmpty && fuzzyTierProvedEmpty && qTokenCount <= 1)");
    expect(CODE.indexOf("simpleTierProvedEmpty = halves.every")).toBeLessThan(gateAt);
    expect(CODE.indexOf("fuzzyTierProvedEmpty = fuzzy.length === 0")).toBeLessThan(gateAt);
  });

  it("the thin-page augment keeps its semantic tier — the proof is about EMPTY pages", () => {
    // A page holding 1-19 real rows has live anchors by construction; the
    // emptiness proof never applies to it, so its entry point stays ungated.
    expect(CODE).toMatch(/await semanticRows\(Math\.min\(room \* 3, 60\), 1_500, \{ ids: haveIds, keys: haveKeys2 \}\)/);
  });
});

describe("a page that holds a number must say it", () => {
  it("a full routed block publishes the floor it just proved", () => {
    // q="RN" served a full page under no figure at all while the window in
    // hand had demonstrated at least 400 matches. The total stays withdrawn —
    // a window size wearing a total's clothing is the fuzzy tier's old defect
    // — but a floor is a fact even when the total is not, and the count probe
    // mirrors the list exactly.
    expect(CODE).toMatch(/\.\.\.\(blockFull \? \{ countUnavailable: true, totalAtLeast: blockStart \+ ordered\.length \} : \{\}\),/);
    expect(CODE).toMatch(/\.\.\.\(rcCapped \? \{ countUnavailable: true, totalAtLeast: rcRows\.length \} : \{\}\)/);
  });

  it("an exclusion still withdraws the total, and the battery query still splits", () => {
    // The withdrawal is DELIBERATE — no tier's count ever saw the exclusion
    // predicate, so any figure called `total` would count rows the page then
    // hides. That philosophy does not move; what changes is that the computed
    // figure stops being thrown away.
    expect(splitExclusions("engineer not manager")).toEqual({ positive: "engineer", excluded: ["manager"] });
    expect(CODE).toMatch(/total: null, countUnavailable: true, totalAtLeast: undefined, relatedTotal: undefined/);
  });

  it("the pre-exclusion figure is republished as a labelled ceiling", () => {
    // Removing rows can only shrink a set, so the positive query's count is a
    // true CEILING of what the page can show — under a name that cannot be
    // read as the total. Emitted only under an exclusion with a finite figure.
    expect(CODE).toMatch(/function exclusionCeiling\(excluded: readonly string\[\], ceiling: number \| null\): Record<string, unknown> \{/);
    expect(CODE).toMatch(/\? \{ totalBeforeExclusions: ceiling \}/);
    // The ranked exit withholds it when the page already disproved the count
    // or holds appended close matches — a ceiling of the exact segment over a
    // mixed page is the "Showing 40 of 18" contradiction again.
    expect(CODE).toMatch(/\.\.\.\(augmented \|\| totalUnderstated \? \{\} : exclusionCeiling\(excludedTerms, total\)\),/);
  });

  it("the ceiling rides BESIDE the withdrawal, never in place of it", () => {
    // Every spread of the ceiling sits after the caveat in the same exit, so
    // the caveat's total:null always wins and the ceiling only ever adds.
    const sites = [...CODE.matchAll(/\.\.\.exclusionCeiling\(excludedTerms/g)].map((m) => m.index ?? -1);
    expect(sites.length).toBeGreaterThanOrEqual(1);
    for (const at of sites) {
      const caveatBefore = CODE.lastIndexOf("...exclusionCountsCaveat(excludedTerms)", at);
      expect(caveatBefore, "an exit spreads the ceiling without the caveat before it").toBeGreaterThan(-1);
      expect(at - caveatBefore, "the caveat and the ceiling must sit in the same exit").toBeLessThan(800);
    }
  });
});
