/**
 * THE ONE CHIP THE ACCOUNT TRACKER PRINTS ABOUT AN EMPLOYER'S CLOSURE RECORD.
 *
 * It printed "this company genuinely fills roles (2499)" for Johnson & Johnson
 * off get_company_fill_curve.fills_90d, a count of closure EVENTS: a role that
 * closed twice counted twice, and one serving again today counted once. At
 * most 1,799 of J&J's roles came down and stayed down, and 403 came back
 * (register L11-02). Both sides now count ROLES (20261008110000), and the
 * positive sentence is the board's own -- a closure is never a hire.
 */
export interface TrackedEmployerRecord {
  /** Roles closed once, not superseded, not serving again (a CEILING). */
  filled_roles_90d?: number | null;
  /** Roles that came back: closed again, superseded, or serving again (a FLOOR). */
  relisted_roles_90d?: number | null;
}

/** Same bars as the board's verdict: three roles that stayed down, re-listed roles not outnumbering them. */
export const TRACKED_MIN_STAYED_DOWN = 3;
/** The re-list caution needs at least this many roles that came back. */
export const TRACKED_CHURN_MIN = 10;

export type TrackedEmployerChip =
  | { kind: "churn"; n: number }
  | { kind: "stayed-down"; n: number }
  | null;

export function trackedEmployerChip(hh: TrackedEmployerRecord | null | undefined): TrackedEmployerChip {
  if (!hh) return null;
  const fills = hh.filled_roles_90d;
  const relists = hh.relisted_roles_90d;
  // A row from a deploy without the role columns says nothing, never zero.
  if (typeof fills !== "number" || typeof relists !== "number" || !Number.isFinite(fills) || !Number.isFinite(relists)) return null;
  if (relists > fills && relists >= TRACKED_CHURN_MIN) return { kind: "churn", n: relists };
  if (fills >= TRACKED_MIN_STAYED_DOWN && relists <= fills) return { kind: "stayed-down", n: fills };
  return null;
}
