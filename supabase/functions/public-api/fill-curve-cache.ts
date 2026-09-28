/**
 * THE FIELD CURVE, READ OUT OF THE HOURLY STATS CACHE.
 *
 * /v1/stats has carried a `fillCurve` block since 2026-09-06 that read
 * `cache.fill_curve` as a bare array and dated it with the cache's ROOT
 * `computed_at`. Nothing wrote that key until 2026-09-27, when
 * get_category_fill_curve began hitting its own 60 s statement_timeout on the
 * REST path (34 s on 09-25, 47 s at 14:xx, no rows at 18:xx and 23:xx) and the
 * two pages that called it live on every visit moved to reading it from
 * refresh_stats_cache instead. That arm is written to survive its own
 * failure: when the curve times out, the OTHER keys still refresh and the
 * PREVIOUS curve is kept with its OWN earlier stamp, so a reader can see the
 * rows are older than the cache around them.
 *
 * Which means the old read here was wrong in both directions at once. If the
 * arm stores the part as `{computed_at, rows}` (the shape actively_hiring
 * already uses), `Array.isArray(cache.fill_curve)` is false and the block stays
 * null forever with the key present. If it stores a bare array with the stamp
 * beside it, the block lights up but dates a carried-forward curve with the
 * root stamp — the one silently-old figure the surrounding basis strings exist
 * to forbid. This module reads either shape and answers three questions the
 * payload needs: the rows, WHEN THOSE ROWS were computed, and whether the last
 * refresh had to carry them forward.
 *
 * It is a plain module with no Deno globals so the unit test can call it with
 * every shape the cache can take, rather than a text match over index.ts.
 */

export type FillCurveRow = Record<string, unknown>;

export interface FillCurveFromCache {
  /** One row per field, in the RPC's own column names. Never empty. */
  rows: FillCurveRow[];
  /**
   * When THESE rows were computed. For the object shape, the part's own
   * `computed_at` and nothing else; for a bare array, a sibling
   * `fill_curve_computed_at` and only then the cache root's `computed_at`.
   * Never null and never invented:
   * a cache that carries no stamp anywhere is not served at all, because a
   * public figure names its date basis or is not published -- the same rule
   * the page reader (src/lib/fill-curve-cache.ts) applies, so the two
   * runtimes cannot disagree about whether a stampless copy is a figure.
   */
  asOf: string;
  /**
   * True when `stale_parts` names the curve: the last hourly refresh could not
   * recompute it and kept the previous rows. `asOf` is then the earlier run's
   * stamp when the arm stored one, and otherwise an upper bound.
   */
  carriedForward: boolean;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** A stamp is a string that parses as a date; anything else is no stamp, not a stamp of unknown shape. */
const str = (x: unknown): string | null => (typeof x === "string" && x.length > 0 && !Number.isNaN(Date.parse(x)) ? x : null);

/**
 * Null means "not served": the key is absent, present with no rows, or has no
 * stamp anywhere to date the rows by. An empty array is deliberately NOT
 * served — `data: []` on the endpoint would read as "no field has a
 * measurable fill rate", a different and false claim from "the cache has not
 * computed it". (The page reader calls a stamped empty array "ready with no
 * rows" and then renders nothing for it; the served outcome is the same, and
 * the arm never writes one -- it carries the previous rows instead.)
 */
export function fillCurveFromCache(cache: unknown): FillCurveFromCache | null {
  if (!isRecord(cache)) return null;
  const part = cache.fill_curve;
  let rows: unknown[] | null = null;
  let asOf: string | null = null;
  if (Array.isArray(part)) {
    // A bare array is dated by whatever the writer put beside it: a sibling
    // stamp first, the cache root only when there is none.
    rows = part;
    asOf = str(cache.fill_curve_computed_at) ?? str(cache.computed_at);
  } else if (isRecord(part)) {
    // An object carries its own stamp and is dated by that ALONE. Falling
    // back to the root here would date a carried part -- the previous run's
    // rows -- with the run that merely wrote them, the silently-old figure
    // this module exists to refuse; the page reader applies the same rule.
    if (Array.isArray(part.rows)) rows = part.rows;
    asOf = str(part.computed_at);
  }
  if (!rows || asOf === null) return null;
  const clean = rows.filter(isRecord);
  if (clean.length === 0) return null;
  const stale = Array.isArray(cache.stale_parts) ? cache.stale_parts : [];
  return { rows: clean, asOf, carriedForward: stale.includes("fill_curve") };
}
