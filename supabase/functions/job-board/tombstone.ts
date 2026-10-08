// Which aged-out ids may walk back in. Pure: no I/O; index.ts reads and writes
// job_board_aged_out and hands the rows here.
// Rationale: docs/job-board-index-notes.md#n412-redated-past-tombstone, #n427-a-tombstone-a-readmission-wrote

/**
 * How much later the feed's date must be than the tombstone's before it counts
 * as a re-date. Workday states "Posted N Days Ago" and normalizeWorkday dates it
 * from the fetch clock, so one unchanged posting reads up to a day apart across
 * visits; anything inside this margin is that jitter, not the employer.
 */
export const REDATE_MARGIN_MS = 3 * 86_400_000;

/**
 * Vendors whose STORED date a later pass can move older than the feed's: the
 * description filler replaces Workday's list date with the detail's startDate
 * (index.ts `betterDate`). For every other vendor a stored date only fills a gap.
 */
export const DATE_MOVES_AFTER_INSERT: ReadonlySet<string> = new Set(["workday"]);

export interface Tombstone { id: string; posted_at: string | null; aged_at?: string | null }

/**
 * True when the feed now states a date later than the one the tombstone
 * recorded, by more than the margin: the employer re-dated the posting under
 * the same id (Ashby re-publishing moves publishedAt). An undated feed row
 * never qualifies — that is the bamboohr/rippling loop the tombstone exists to
 * stop — and neither does a tombstone with no readable date.
 */
export function redatedPastTombstone(feedPostedAt: unknown, tombPostedAt: unknown): boolean {
  if (typeof feedPostedAt !== "string" || typeof tombPostedAt !== "string") return false;
  const f = Date.parse(feedPostedAt);
  const t = Date.parse(tombPostedAt);
  return Number.isFinite(f) && Number.isFinite(t) && f > t + REDATE_MARGIN_MS;
}

const ms = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/**
 * The two tombstones that hold no aged date, and when each lets a dated row back.
 *
 * - No readable date: nothing to be newer than but its own write. `aged_at` is
 *   when the row aged out (a re-admission always writes a date, so it was never
 *   moved), and a feed date past it by more than the margin is a re-date.
 * - A date INSIDE the window: only a re-admission writes one (the sweep and the
 *   seed tombstone rows already past the cutoff). On a vendor whose stored date
 *   never moves, that row cannot have aged out since, so it left by a closure or
 *   a prune, and the same id back on a date no older is a live posting.
 */
function undatedOrReadmittedLetsIn(
  row: { id?: unknown; source?: unknown; posted_at?: unknown },
  t: Tombstone,
  cutoffMs: number | undefined,
): boolean {
  const f = ms(row.posted_at);
  if (!Number.isFinite(f)) return false;
  if (cutoffMs !== undefined && f < cutoffMs) return false;
  const tp = ms(t.posted_at);
  if (!Number.isFinite(tp)) {
    const at = ms(t.aged_at);
    return Number.isFinite(at) && f > at + REDATE_MARGIN_MS;
  }
  if (cutoffMs === undefined || tp < cutoffMs || f < tp) return false;
  const source = typeof row.source === "string" ? row.source : String(row.id ?? "").split(":")[0];
  return !DATE_MOVES_AFTER_INSERT.has(source);
}

/**
 * Split this visit's new rows against their tombstones. `refused` keeps the old
 * meaning; `readmitted` are the rows whose tombstone the caller must move to the
 * row's own date once the insert has landed, or the next sweep cannot tell this
 * re-date from the next one. `cutoffMs` is the freshness cutoff of this pass.
 */
export function splitTombstoned<R extends { id?: unknown; source?: unknown; posted_at?: unknown }>(
  rows: readonly R[],
  tombs: readonly Tombstone[],
  opts: { cutoffMs?: number } = {},
): { refused: Set<string>; readmitted: R[] } {
  const byId = new Map<string, Tombstone>();
  for (const t of tombs) byId.set(String(t.id), t);
  const refused = new Set<string>();
  const readmitted: R[] = [];
  for (const r of rows) {
    const t = byId.get(String(r.id));
    if (!t) continue;
    if (redatedPastTombstone(r.posted_at, t.posted_at) || undatedOrReadmittedLetsIn(r, t, opts.cutoffMs)) readmitted.push(r);
    else refused.add(String(r.id));
  }
  return { refused, readmitted };
}
