// Whether one visit read a whole board, and which advertised total a visit may
// be judged against. Pure: no I/O; index.ts hands the numbers in.
// Rationale: docs/job-board-index-notes.md#n413-workday-total-past-offset-zero

/**
 * True when a Workday visit saw only part of the board.
 *
 * Many Workday tenants state `total` only on the offset-0 page and answer
 * `total: 0` on every later one (Adobe 526, Novartis 816, TD 1,521, T-Mobile
 * 2,000 at offset 0; 0 at offset 20 and beyond, measured 2026-10-05). A visit
 * that resumes mid-feed therefore sees a total of zero, and "the total does
 * not exceed what I fetched" was read as "I fetched the whole board": the
 * 250-row slice was treated as everything, the rest of the board was stamped
 * missing, deleted, and logged as employer takedowns.
 *
 * So a visit that did not start at the top is never whole, whatever the page
 * said; and when no total was stated at all, only a walk that reached the end
 * of the feed (a short page) is whole.
 */
export function workdayWindowed(startOffset: number, feedTotal: number, fetched: number, exhausted: boolean): boolean {
  if (startOffset > 0) return true;
  return feedTotal > 0 ? feedTotal > fetched : !exhausted;
}

/**
 * The advertised total a lap's wrap is measured against.
 *
 * The visit's own total when it stated one. A visit that began past offset 0
 * on a tenant that states its total only at the top has none; the total pinned
 * when the lap opened (`LapState.t0`, read from that lap's offset-0 page)
 * stands in, because that is the feed this lap set out to cover. A visit from
 * the top that stated nothing gets 0, which can never prove.
 */
export function lapTotal(visitTotal: number | null | undefined, cursorBefore: number, lapT0: number | null | undefined): number {
  const v = Math.max(0, Math.trunc(Number(visitTotal) || 0));
  if (v > 0) return v;
  if (cursorBefore > 0) return Math.max(0, Math.trunc(Number(lapT0) || 0));
  return 0;
}

/**
 * The feed_total to write on the verification stamp, or `undefined` to leave
 * the column out of the upsert so the last stated total stands.
 *
 * A zero from a mid-feed page is not the employer saying "zero"; it is the
 * tenant not saying. Writing it published "0 open" for boards advertising
 * hundreds and sorted them into the full-read bucket. A visit from the top
 * writes what it read (including an honest 0 for an empty board, and null for
 * a vendor that states no total).
 */
export function stampFeedTotal(visitTotal: number | null | undefined, cursorBefore: number, lapT0: number | null | undefined): number | null | undefined {
  if (typeof visitTotal === "number" && Number.isFinite(visitTotal) && visitTotal > 0) return visitTotal;
  if (cursorBefore === 0) return visitTotal ?? null;
  const t0 = Math.max(0, Math.trunc(Number(lapT0) || 0));
  return t0 > 0 ? t0 : undefined;
}
