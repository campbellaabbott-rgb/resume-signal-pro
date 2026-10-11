/**
 * A FIT SCORE OF ONE HUNDRED AND FORTY OUT OF A HUNDRED (register L8-13).
 *
 * computeFit's precision divided posting terms found anywhere in the résumé
 * TEXT by the résumé's own term list, which drops a term contained in a
 * longer one. A short compound-heavy résumé ("osha compliance dental,
 * activation funnel, strategic selling") holds three terms and contains all
 * seven of the posting's: precision 7/3 = 2.33 and a score of 140, against
 * the 0-100 range /v1/fit, the MCP fit_resume tool and the board document.
 * Realistic résumés stayed at or under 100, which is why it survived.
 */
import { describe, expect, it } from "vitest";
import { computeFit } from "../../supabase/functions/_shared/fit-score";

const RESUME = "osha compliance dental, activation funnel, strategic selling";
const POSTING = "We need OSHA experience, compliance knowledge, dental office skills, user activation, sales funnel work, strategic planning and selling.";

describe("a fit score of one hundred and forty out of a hundred", () => {
  it("a compound-heavy résumé that covers every posting term scores at most 100, with precision at most 1", () => {
    const r = computeFit(POSTING, RESUME);
    expect(r.matched.length, "the case under test: all seven posting terms are in the résumé text").toBe(7);
    expect(r.precision, "precision is a share").toBeLessThanOrEqual(1);
    expect(r.pct, "the score left its documented 0-100 range").toBeLessThanOrEqual(100);
    expect(r.pct).toBeGreaterThanOrEqual(90);
  });

  it("positive control: an ordinary partial match is unchanged in kind (between 1 and 99)", () => {
    const r = computeFit(POSTING, "Registered nurse with dental assisting background and OSHA training; patient scheduling.");
    expect(r.pct).toBeGreaterThan(0);
    expect(r.pct).toBeLessThan(100);
  });
});
