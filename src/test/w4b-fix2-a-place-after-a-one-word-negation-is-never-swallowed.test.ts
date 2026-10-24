// @vitest-environment node
/**
 * A PLACE AFTER A ONE-WORD NEGATION IS NEVER SWALLOWED (wave 4 round 2
 * recheck; S12-017's phrase rule finished).
 *
 * WHAT WAS WRONG. The round 1 fix (94cbd161) stopped a "not" phrase at two
 * words, a preposition, a state or an intent word. A place typed without a
 * preposition became the phrase's second word: "warehouse not forklift Dallas"
 * excluded "forklift dallas" (no title holds it, so nothing was excluded) and
 * Dallas left the search, which origin/main kept. isStateWord read only the
 * state aliases, not the metro aliases or the city table the place lift uses,
 * so "nurse not icu nyc" lost nyc too.
 *
 * THE RULE NOW. The phrase stops before any place knownPlace() recognises
 * (state, metro alias, the city table, "City, ST", a country), one to three
 * words long, unless the place began a word earlier inside the phrase
 * ("not new york" still excludes "new york").
 */
import { describe, expect, it } from "vitest";
import { splitExclusions } from "../../supabase/functions/job-board/search-routing";

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
  ])("%s", (q, positive, excluded) => {
    expect(splitExclusions(q)).toEqual({ positive, excluded });
  });

  it("controls: a two-word phrase, a place begun inside the phrase, a phrase alone", () => {
    expect(splitExclusions("nurse not night shift")).toEqual({ positive: "nurse", excluded: ["night shift"] });
    expect(splitExclusions("driver not box truck")).toEqual({ positive: "driver", excluded: ["box truck"] });
    expect(splitExclusions("nurse not new york")).toEqual({ positive: "nurse", excluded: ["new york"] });
    expect(splitExclusions("nurse not night shift Boston")).toEqual({ positive: "nurse Boston", excluded: ["night shift"] });
    expect(splitExclusions("engineer not team lead")).toEqual({ positive: "engineer", excluded: ["team lead"] });
  });
});
