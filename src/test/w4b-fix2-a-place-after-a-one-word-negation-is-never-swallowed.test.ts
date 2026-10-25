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
 * THE RULE NOW (fix 3). Stopping before known places still lost every city
 * the gazetteer did not know ("forklift san jose"), so "not" takes ONE word,
 * as origin/main did, unless the two words are a pinned compound ("night
 * shift") or a place of two or three words the board knows ("not new york"
 * excludes "new york"). The 591-query corpus behind it is
 * w4b-fix3-search-negated-phrases-corpus.test.ts.
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
    // A place name in lower case, or a code the place lift takes only in capitals, still ends the phrase.
    ["cook not line sf", "cook sf", ["line"]],
    ["cook not line SF", "cook SF", ["line"]],
    ["nurse not travel uk", "nurse uk", ["travel"]],
    ["analyst not junior us", "analyst us", ["junior"]],
    ["driver not cdl atl", "driver atl", ["cdl"]],
    ["nurse not icu new york", "nurse new york", ["icu"]],
    ["warehouse not forklift dallas tx", "warehouse dallas tx", ["forklift"]],
    ["driver not cdl los angeles", "driver los angeles", ["cdl"]],
    ["engineer not senior bay area", "engineer bay area", ["senior"]],
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
