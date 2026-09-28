/**
 * THE FIELD FILL CURVE AS THE HOURLY STATS CACHE CARRIES IT.
 *
 * Two pages read the field curve live on every visit -- the Ghost Job Index
 * for its "how often roles are actually filled, by field" table, and /jobs for
 * the field clause on every card and lander. The function behind it answered
 * in 34s on 2026-09-25, 47s at 14:xx on 2026-09-27, and hit its own 60-second
 * statement timeout with NO rows at 18:xx and 23:xx the same day (measured by
 * scripts/verify-deploy.sh section 4e and reproduced once with the anon key:
 * HTTP 500, code 57014, 60.63s). A section blanked by a timeout is
 * indistinguishable from a section with nothing to say, on a page whose whole
 * subject is whether job numbers can be trusted.
 *
 * The same refresh that writes the six cached statistics the page already
 * reads now writes this as a part of the same row, and both pages read it
 * from there and nowhere else. This module is the ONE reader, so the two pages
 * cannot disagree about what counts as a usable copy or whose stamp it wears.
 *
 * WHAT IT ACCEPTS. Two shapes, because the writer and the readers land in
 * separate changes and the API endpoint already reads the key:
 *
 *   { computed_at, rows }   the shape the leaderboard part uses -- the part's
 *                           OWN stamp, which on a carried run is older than the
 *                           row it arrived in;
 *   [ ...rows ]             a bare array, dated by a sibling stamp key when the
 *                           writer publishes one and by the row's top-level
 *                           computed_at when it does not.
 *
 * WHAT IT REFUSES, and what each refusal renders as. A key that is missing, a
 * JSON null, a part whose rows are not an array, or a part with no parseable
 * stamp is ABSENT: the refresh has not published a usable copy since this
 * reading was added, and the page says "not yet computed" -- never an error,
 * never a live call. A cache that could not be read at all (no object came
 * back) is UNREADABLE, which is a fact about our read and is said as one. An
 * EMPTY array with a stamp is READY with no rows: the function answers no row
 * below its own honesty floor on a young log, so that is an answer, not a
 * shape we fail to recognise.
 *
 * `carried` is the refresh's own word for it: the part is named in stale_parts,
 * so these rows are older than the row they arrived in and the page must say
 * so beside the date.
 */
export const FILL_CURVE_CACHE_KEY = "fill_curve";
/** The sibling stamp a bare-array writer may publish beside the rows. */
export const FILL_CURVE_STAMP_KEY = "fill_curve_computed_at";

export type CachedFillCurve<Row> =
  | { state: "unreadable" }
  | { state: "absent" }
  | { state: "ready"; rows: Row[]; computedAt: string; carried: boolean };

const isoStamp = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? v : null;

export function readCachedFillCurve<Row>(cache: unknown): CachedFillCurve<Row> {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return { state: "unreadable" };
  const c = cache as Record<string, unknown>;
  const part = c[FILL_CURVE_CACHE_KEY];
  let rows: unknown;
  let stamp: string | null;
  if (Array.isArray(part)) {
    rows = part;
    stamp = isoStamp(c[FILL_CURVE_STAMP_KEY]) ?? isoStamp(c.computed_at);
  } else if (part && typeof part === "object") {
    const p = part as Record<string, unknown>;
    rows = p.rows;
    stamp = isoStamp(p.computed_at);
  } else {
    return { state: "absent" };
  }
  if (!Array.isArray(rows) || stamp === null) return { state: "absent" };
  const stale = Array.isArray(c.stale_parts) ? (c.stale_parts as unknown[]) : [];
  return { state: "ready", rows: rows as Row[], computedAt: stamp, carried: stale.includes(FILL_CURVE_CACHE_KEY) };
}
