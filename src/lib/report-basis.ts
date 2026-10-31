/**
 * THE BASIS THE FREE REPORT PRINTS BESIDE A HAND-SET NUMBER OR LIST.
 *
 * Every number the report shows names its basis (the review of 2026-10-27).
 * Three kinds were printed as if measured:
 *
 *   - the points each fix is worth, and the score they add up to: the AI's
 *     estimate per quick win, or fixed points per kind of fix (5 for
 *     rewriting weak bullets, 6 for working keywords in), capped at 95 by
 *     free-keyword-scan. They are a rough guide, not a forecast of a rescan;
 *   - the market card's notes (summary, in-demand skills, rising keywords):
 *     typed by hand per country and field, last compiled at the date the scan
 *     sends as listsAsOf (MARKET_DATA_AS_OF in its market module);
 *   - the skills-freshness lists: typed by hand for five fields, same date;
 *   - the fix plan's minutes: the AI's time estimate per quick win, or fixed
 *     minutes per kind of fix (FIX_PLAN_BASIS).
 *
 * An older build of the scan sends no date; the lines then name the basis
 * without one.
 */

export const FIX_POINTS_BASIS =
  "Points are a rough guide (the AI's estimate per fix, or fixed points per kind of fix), not a forecast of your next scan.";

/**
 * The fix plan prints minutes beside the points, and they are set the same
 * way: the AI's time estimate per quick win, or fixed minutes per kind of fix
 * (15 for rewriting weak bullets, 10 for working keywords in).
 */
export const FIX_PLAN_BASIS =
  "Minutes and points are a rough guide (the AI's estimate per fix, or fixed amounts per kind of fix), not a forecast of your next scan.";

export function marketBasis(asOf?: string | null): string {
  return asOf
    ? `Hand-compiled market notes, last updated ${asOf}; not a live reading of job postings.`
    : "Hand-compiled market notes; not a live reading of job postings.";
}

export function skillsBasis(asOf?: string | null): string {
  return asOf
    ? `Our hand-compiled lists for your field, last updated ${asOf}, matched as whole words in your resume.`
    : "Our hand-compiled lists for your field, matched as whole words in your resume.";
}
