// HOW FAR /v1/changes MAY READ, AND WHERE A CALLER RESUMES (S14X-065).
//
// A closure's closed_at is NOT the moment its row becomes visible. The board
// takes one stamp per board visit and then writes that visit's takedowns in
// 200-row chunks, each committed seconds to minutes later; a second visit
// that started after it can stamp later and commit first. A reader paging by
// (closed_at, event_id) who read in that gap moved its cursor past the first
// visit's stamp, and those rows, committed a moment later under the earlier
// stamp, were never handed back by any later page.
//
// So the feed reads only up to a settled horizon: a stamp at least
// CLOSED_SETTLE_MS old has either committed or will be written by a later
// visit under a later stamp. Fifteen minutes is over seven times the board's
// slice wall budget (120 s) and past the isolate's 400 s ceiling. first_seen
// is the insert statement's own now(), so opened[] needs only the length of
// one statement; two minutes covers it.
//
// The horizon is published, and so is a resume cursor on every page, so a
// consumer resumes by cursor and never by moving `since` to the last stamp it
// saw, which is the walk that loses rows.
//
// Pure, so the Node suite runs it by value.

export const CLOSED_SETTLE_MS = 15 * 60_000;
export const OPENED_SETTLE_MS = 2 * 60_000;

/** The newest stamp this read may serve, as the ISO string the query binds. */
export function settledThrough(nowMs: number, settleMs: number): string {
  return new Date(nowMs - settleMs).toISOString();
}

/**
 * Where the next read of this list starts: the last row's key whenever the
 * page had rows (hasMore or not), the cursor the caller sent when it had none,
 * and null on an empty first page (resume with the same `since`).
 */
export function resumeCursorOf<T>(
  rows: T[],
  keyOf: (row: T) => { ep: string; id: string } | null,
  incoming: { ep: string; id: string } | null,
): { ep: string; id: string } | null {
  const last = rows.length ? keyOf(rows[rows.length - 1]) : null;
  return last ?? incoming ?? null;
}
