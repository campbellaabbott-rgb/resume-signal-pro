/**
 * AN EXCLUDED PHRASE IS EXCLUDED WHOLE (S12-017, job-board .93, wave 4 round 2).
 *
 * splitExclusions split the query on spaces before it looked at quotes or at
 * what followed "not". So -"team lead" became the excluded token "team and
 * the positive word lead": the search returned team leads. And "nurse not
 * night shift" excluded "night" and REQUIRED "shift": the live rows matched
 * the positive control "nurse night shift" exactly, the opposite of what was
 * asked, on the site, in MCP, in ChatGPT's search and on /v1, which all read
 * the board's list.
 *
 * A quoted phrase is one token, negated whole by "-" or "not"; the words after
 * "not" are one phrase up to the next operator; and titleExcluded matches a
 * phrase as adjacent words, plural or singular.
 */
import { describe, expect, it } from "vitest";
import { splitExclusions, titleExcluded } from "../../supabase/functions/job-board/search-routing";

describe("the exclusion parser keeps a phrase together (S12-017)", () => {
  it('-"team lead" excludes the phrase and keeps nothing of it positive', () => {
    const ex = splitExclusions('supervisor -"team lead"');
    expect(ex).toEqual({ positive: "supervisor", excluded: ["team lead"] });
    expect(titleExcluded("Team Lead, Warehouse", ex.excluded)).toBe(true);
    expect(titleExcluded("Warehouse Supervisor", ex.excluded)).toBe(false);
    expect(titleExcluded("Lead Supervisor, Team Operations", ex.excluded), "the words apart are not the phrase").toBe(false);
  });

  it("'not' before several words negates them as one phrase, never the first word alone", () => {
    const ex = splitExclusions("nurse not night shift");
    expect(ex).toEqual({ positive: "nurse", excluded: ["night shift"] });
    expect(titleExcluded("Night Shift RN", ex.excluded)).toBe(true);
    expect(titleExcluded("RN - Day Shift", ex.excluded), "a day shift is what was asked for").toBe(false);
    expect(titleExcluded("Nurse Manager", ex.excluded)).toBe(false);
  });

  it("'not requiring night shifts' drops the verb and strikes the singular title too", () => {
    const ex = splitExclusions("nurse not requiring night shifts");
    expect(ex).toEqual({ positive: "nurse", excluded: ["night shifts"] });
    expect(titleExcluded("Registered Nurse - Night Shift", ex.excluded)).toBe(true);
  });

  it('not "a phrase", a phrase then an operator, and a positive quote beside an exclusion', () => {
    expect(splitExclusions('driver not "box truck"')).toEqual({ positive: "driver", excluded: ["box truck"] });
    expect(splitExclusions("nurse not night shift -travel")).toEqual({ positive: "nurse", excluded: ["night shift", "travel"] });
    expect(splitExclusions('"registered nurse" -"travel nurse"')).toEqual({ positive: '"registered nurse"', excluded: ["travel nurse"] });
  });

  it("positive control: the single-word forms and the guards stand", () => {
    expect(splitExclusions("engineer not manager")).toEqual({ positive: "engineer", excluded: ["manager"] });
    expect(splitExclusions("nurse -travel")).toEqual({ positive: "nurse", excluded: ["travel"] });
    expect(splitExclusions("director not for profit")).toEqual({ positive: "director not for profit", excluded: [] });
    expect(splitExclusions("not night shift")).toEqual({ positive: "not night shift", excluded: [] });
    expect(splitExclusions('"team lead"')).toEqual({ positive: '"team lead"', excluded: [] });
    expect(titleExcluded("Management Consultant", ["manager"])).toBe(false);
    expect(titleExcluded("Store Managers", ["manager"])).toBe(true);
  });
});
