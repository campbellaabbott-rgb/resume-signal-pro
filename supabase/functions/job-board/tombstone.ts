// Which aged-out ids may walk back in. Pure: no I/O; index.ts reads and writes
// job_board_aged_out and hands the rows here.
// Rationale: docs/job-board-index-notes.md#n412-redated-past-tombstone

/**
 * How much later the feed's date must be than the tombstone's before it counts
 * as a re-date. Workday states "Posted N Days Ago" and normalizeWorkday dates it
 * from the fetch clock, so one unchanged posting reads up to a day apart across
 * visits; anything inside this margin is that jitter, not the employer.
 */
export const REDATE_MARGIN_MS = 3 * 86_400_000;

export interface Tombstone { id: string; posted_at: string | null }

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

/**
 * Split this visit's new rows against their tombstones. `refused` keeps the old
 * meaning; `readmitted` are the rows whose tombstone the caller must move to the
 * row's own date once the insert has landed, or the next sweep cannot tell this
 * re-date from the next one.
 */
export function splitTombstoned<R extends { id?: unknown; posted_at?: unknown }>(
  rows: readonly R[],
  tombs: readonly Tombstone[],
): { refused: Set<string>; readmitted: R[] } {
  const byId = new Map<string, Tombstone>();
  for (const t of tombs) byId.set(String(t.id), t);
  const refused = new Set<string>();
  const readmitted: R[] = [];
  for (const r of rows) {
    const t = byId.get(String(r.id));
    if (!t) continue;
    if (redatedPastTombstone(r.posted_at, t.posted_at)) readmitted.push(r);
    else refused.add(String(r.id));
  }
  return { refused, readmitted };
}
