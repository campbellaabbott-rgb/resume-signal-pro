/**
 * WHAT THIS GUARDS
 * ----------------
 * detectRegion's spelled-out-state-name branch used `P_US_STATE_NAME_CAP.exec`
 * — a leftmost-wins search over the whole location string. It therefore
 * answered with whichever state name appeared EARLIEST, not the one the
 * posting is in.
 *
 * MEASURED 2026-09-23 over live location strings (4,500 Workday rows + 4,500
 * board-wide rows, cursor-walked with the anon key; 1,253 of them reach this
 * branch). Two failure classes, 14 rows = 1.12% of the branch:
 *
 *   "Kansas City, Missouri"  -> US-KS. The state name is part of the CITY's
 *                               name. "Kansas, Oklahoma" is the same shape —
 *                               a town in Oklahoma filed under Kansas.
 *   "Chicago, Illinois; New   -> US-IL. A multi-site requisition filed at
 *    York, New York; ..."      whichever site the employer listed first.
 *
 * WHY IT REFUSES RATHER THAN PICKING BETTER
 * -----------------------------------------
 * Taking the LAST name instead of the first fixes "Kansas City, Missouri" and
 * is just as arbitrary on the multi-site strings. A region is written into a
 * longitudinal series that outlives the posting, and the function's own
 * doc comment already states the rule for the ", CA" collision: null is
 * recoverable, a wrong subdivision is not. So a string naming two or more
 * DIFFERENT states resolves to null.
 *
 * WHAT MUST NOT REGRESS, and this is the larger half: the dash-delimited
 * Workday form and the repeated-name form both name ONE state and are by far
 * the common case. A "whole comma-segment only" rule would have looked
 * principled and silently dropped every "San Antonio-Texas-United States of
 * America" row. Those are asserted below.
 *
 * The comma-prefixed CODE branch is deliberately untouched — a code is
 * unambiguous and trailing, and "Kansas City, MO" already resolved correctly
 * through it. The province branch is untouched too: of 180 live rows that
 * reached it, zero named two different provinces, so there is no measured
 * defect to fix there.
 *
 * TEETH: proven to fail by restoring the leftmost-wins `exec` — the
 * two-different-states block then reports US-KS for Kansas City. Restored.
 */
import { describe, expect, it } from "vitest";
import { REGION_MAP_VERSION, detectRegion } from "../../supabase/functions/job-board/normalize";

describe("a spelled-out state name only names a state when the string names one state", () => {
  it("refuses a string that names two different states", () => {
    // Every string here is verbatim from the live walk, and every one of them
    // resolves to a wrong or falsely precise subdivision today.
    const namesTwoStates: Array<[string, string]> = [
      ["Kansas City, Missouri", "the state is in the city's name"],
      ["Kansas, Oklahoma", "a town in Oklahoma"],
      ["Overland Park, Kansas; Chesterfield, Missouri", "two sites"],
      ["Austin, Texas & Sunnyvale, California", "two sites"],
      ["Remote - Illinois, USA; Remote - Texas, USA", "two remote scopes"],
      ["Chicago, Illinois; New York, New York; Philadelphia, Pennsylvania", "three sites"],
      ["McLean, Virginia, United States; New York, New York, United States", "two sites"],
    ];
    for (const [loc, why] of namesTwoStates) {
      expect(detectRegion(loc, "US"), `${loc} (${why})`).toBeNull();
    }
  });

  it("still resolves a string that names one state, however it is punctuated", () => {
    // The dash-delimited Workday form is the single most common shape in the
    // branch. A segment-based rule would have killed all of it.
    expect(detectRegion("San Antonio-Texas-United States of America", "US")).toBe("US-TX");
    expect(detectRegion("Folsom-California-United States of America", "US")).toBe("US-CA");
    expect(detectRegion("Cranberry Township-Pennsylvania-United States of America", "US")).toBe("US-PA");
    expect(detectRegion("Colorado Springs Campus", "US")).toBe("US-CO");
    expect(detectRegion("University of Maryland College Park", "US")).toBe("US-MD");
    expect(detectRegion("Remote Workers Illinois IL", "US")).toBe("US-IL");
  });

  it("treats a state named twice as one state, not two", () => {
    // "New York, New York" names one state in two roles. Counting mentions
    // rather than distinct states would refuse every city-equals-state row.
    expect(detectRegion("New York, New York", "US")).toBe("US-NY");
    expect(detectRegion("Rochester, New York; Buffalo, New York", "US")).toBe("US-NY");
    expect(detectRegion("Kalispell, Montana; Missoula, Montana", "US")).toBe("US-MT");
  });

  it("leaves the comma-prefixed code branch answering first and unchanged", () => {
    // The code is stronger evidence and runs before the names. This is what
    // makes the refusal above cheap: the common "City, ST" form never reaches
    // it. Note "Kansas City, MO" is RIGHT today and must stay right.
    expect(detectRegion("Kansas City, MO", "US")).toBe("US-MO");
    expect(detectRegion("Austin, TX", "US")).toBe("US-TX");
    expect(detectRegion("Washington, DC", "US")).toBe("US-DC");
  });

  it("does not answer outside the countries it has a vocabulary for", () => {
    expect(detectRegion("Kansas City, Missouri", "DE")).toBeNull();
    expect(detectRegion("Kansas City, Missouri", null)).toBeNull();
    expect(detectRegion(null, "US")).toBeNull();
  });

  it("names the rule version that produced the stored subdivisions", () => {
    expect(REGION_MAP_VERSION).toBeGreaterThanOrEqual(2);
  });
});
