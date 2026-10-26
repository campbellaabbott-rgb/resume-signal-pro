// @vitest-environment node
/**
 * A PLACE AFTER A ONE-WORD NEGATION IS NEVER SWALLOWED (wave 4 round 2
 * recheck; since the descope of 2026-10-25, origin/main's rule).
 *
 * WHAT WAS WRONG. The round 1 fix (94cbd161) stopped a "not" phrase at two
 * words, a preposition, a state or an intent word. A place typed without a
 * preposition became the phrase's second word: "warehouse not forklift Dallas"
 * excluded "forklift dallas" (no title holds it, so nothing was excluded) and
 * Dallas left the search, which origin/main kept.
 *
 * THE RULE NOW. origin/main's, byte for byte: "not" takes exactly ONE word, so
 * any place after it, known to the board or not, stays in the search. The
 * rounds that let "not" take a compound or a multi-word place were taken out
 * by the descope (see w4b-descope-the-search-exclusion-is-origin-mains.test.ts),
 * so "nurse not night shift" excludes "night", as main does.
 */
import { describe, expect, it } from "vitest";
import { splitExclusions } from "../../supabase/functions/job-board/search-routing";
import * as ORIGIN_MAIN from "./fixtures/w4b-fix3-search/origin-main-exclusion";

describe("a place after the negated word stays in the search", () => {
  it.each([
    ["warehouse not forklift Dallas", "warehouse Dallas", ["forklift"]],
    ["teacher not substitute Chicago", "teacher Chicago", ["substitute"]],
    ["driver not cdl Houston", "driver Houston", ["cdl"]],
    ["accountant not senior Austin", "accountant Austin", ["senior"]],
    ["nurse not icu nyc", "nurse nyc", ["icu"]],
    ["barista not part-time Denver", "barista Denver", ["parttime"]],
    ["cashier not overnight San Antonio", "cashier San Antonio", ["overnight"]],
    ["electrician not apprentice Austin, TX", "electrician Austin, TX", ["apprentice"]],
    ["nurse not travel London", "nurse London", ["travel"]],
    ["developer not contract Toronto", "developer Toronto", ["contract"]],
    ["welder not pipeline Phoenix", "welder Phoenix", ["pipeline"]],
    ["chef not sous seattle", "chef seattle", ["sous"]],
    ["cook not line sf", "cook sf", ["line"]],
    ["cook not line SF", "cook SF", ["line"]],
    ["nurse not travel uk", "nurse uk", ["travel"]],
    ["analyst not junior us", "analyst us", ["junior"]],
    ["driver not cdl atl", "driver atl", ["cdl"]],
    ["nurse not icu new york", "nurse new york", ["icu"]],
    ["warehouse not forklift dallas tx", "warehouse dallas tx", ["forklift"]],
    ["driver not cdl los angeles", "driver los angeles", ["cdl"]],
    ["engineer not senior bay area", "engineer bay area", ["senior"]],
    ["warehouse not forklift San Jose", "warehouse San Jose", ["forklift"]],
  ])("%s", (q, positive, excluded) => {
    expect(splitExclusions(q)).toEqual({ positive, excluded });
    expect(splitExclusions(q), "origin/main's answer").toEqual(ORIGIN_MAIN.splitExclusions(q));
  });

  it("controls: two words after 'not' are never one exclusion, as on origin/main", () => {
    expect(splitExclusions("nurse not night shift")).toEqual({ positive: "nurse shift", excluded: ["night"] });
    expect(splitExclusions("driver not box truck")).toEqual({ positive: "driver truck", excluded: ["box"] });
    expect(splitExclusions("nurse not new york")).toEqual({ positive: "nurse york", excluded: ["new"] });
  });
});
