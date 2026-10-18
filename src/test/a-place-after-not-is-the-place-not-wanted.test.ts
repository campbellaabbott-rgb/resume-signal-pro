/**
 * A PLACE AFTER "NOT" IS THE PLACE NOT WANTED (S12-172, job-board .93, wave 4
 * round 2).
 *
 * Wave 4 moved a trailing "in <place>" out of the words and into the location
 * filter. Its pattern took the LAST "in", so "nurse jobs not in Texas" was
 * searched as location Texas: the one place the person ruled out. The board
 * has no place exclusion, so a place after a negation is not lifted at all.
 * (agent-mcp keeps its own copy of the lift; parity is handed to its owner.)
 */
import { describe, expect, it } from "vitest";
import { liftTrailingPlace } from "../../supabase/functions/job-board/query-place";

const FILLER = new Set(["job", "jobs", "in", "near", "around", "the", "a", "for"]);

describe("a negated place is never lifted into the location filter (S12-172)", () => {
  it("not / except / excluding / but / other than", () => {
    for (const q of [
      "nurse jobs not in Texas",
      "nurse jobs except in Texas",
      "warehouse jobs excluding in California",
      "remote jobs but not in Texas",
      "teacher jobs anywhere but in Florida",
      "driver other than in Ohio",
    ]) expect(liftTrailingPlace(q, FILLER), q).toBeNull();
  });

  it("positive control: an ordinary trailing place still lifts", () => {
    expect(liftTrailingPlace("nurse jobs in Texas", FILLER)?.patch).toEqual({ location: "Texas" });
    expect(liftTrailingPlace("software engineer jobs in new york", FILLER)?.patch).toEqual({ location: "new york" });
    expect(liftTrailingPlace("notary jobs in Texas", FILLER)?.patch, "a word that only starts with 'not' is not a negation").toEqual({ location: "Texas" });
  });
});
