// Whether one visit read a whole board, and which advertised total a visit may
// be judged against. Pure: no I/O; index.ts hands the numbers in.
// Rationale: docs/job-board-index-notes.md#n413-workday-total-past-offset-zero

// Rationale: docs/job-board-index-notes.md#n1494-export-function-workdaywindowed-startoff
export function workdayWindowed(startOffset: number, feedTotal: number, fetched: number, exhausted: boolean): boolean {
  if (startOffset > 0) return true;
  return feedTotal > 0 ? feedTotal > fetched : !exhausted;
}

// Rationale: docs/job-board-index-notes.md#n1495-export-function-laptotal-visittotal-numb
export function lapTotal(visitTotal: number | null | undefined, cursorBefore: number, lapT0: number | null | undefined): number {
  const v = Math.max(0, Math.trunc(Number(visitTotal) || 0));
  if (v > 0) return v;
  if (cursorBefore > 0) return Math.max(0, Math.trunc(Number(lapT0) || 0));
  return 0;
}

// Rationale: docs/job-board-index-notes.md#n1496-export-function-stampfeedtotal-visittota
export function stampFeedTotal(visitTotal: number | null | undefined, cursorBefore: number, lapT0: number | null | undefined): number | null | undefined {
  if (typeof visitTotal === "number" && Number.isFinite(visitTotal) && visitTotal > 0) return visitTotal;
  if (cursorBefore === 0) return visitTotal ?? null;
  const t0 = Math.max(0, Math.trunc(Number(lapT0) || 0));
  return t0 > 0 ? t0 : undefined;
}

// Rationale: docs/job-board-index-notes.md#n1497-export-function-emptyfirstpage-firstoffs
export function emptyFirstPage(firstOffset: number, fetched: number, feedTotal: number): "refused" | "ended" | "restart" | null {
  if (fetched > 0) return null;
  const total = Math.max(0, Math.trunc(Number(feedTotal) || 0));
  if (firstOffset <= 0) return total > 0 ? "refused" : null;
  return total > firstOffset ? "restart" : "ended";
}

// Rationale: docs/job-board-index-notes.md#n1498-export-function-emptyinsidelaptotal-curs
export function emptyInsideLapTotal(cursorBefore: number, endOffset: number | null | undefined, lapT0: number | null | undefined): boolean {
  const t0 = Math.max(0, Math.trunc(Number(lapT0) || 0));
  return cursorBefore > 0 && typeof endOffset === "number" && endOffset <= cursorBefore && t0 > cursorBefore;
}

/** How long a deep board must have been failing before its cursor is called stranded. */
export const CURSOR_STRAND_MS = 6 * 3_600_000;

// Rationale: docs/job-board-index-notes.md#n1499-export-function-cursorafterfailure-curso
export function cursorAfterFailure(cursor: number, streakBefore: number, failingSinceMs?: number, nowMs: number = Date.now()): number {
  if (cursor <= 0 || streakBefore < 1) return cursor;
  if (typeof failingSinceMs === "number" && Number.isFinite(failingSinceMs) && nowMs - failingSinceMs < CURSOR_STRAND_MS) return cursor;
  return 0;
}

/** Oracle CE REST answers no page whose end passes offset 10,000 (n1430). */
export const ORACLE_RESULT_CAP = 10_000;

/** A walk that reached ORACLE_RESULT_CAP proves its lap only when its floor (the last readable row's posting date) is older than the fence (n1430). */
export function capLapCovers(lapSeen: number, floor: string | null | undefined, fenceMs: number): boolean {
  const f = Date.parse(String(floor ?? ""));
  return lapSeen >= ORACLE_RESULT_CAP && f + 86_400_000 < fenceMs;
}

/** True when a capped read could not have reached a stored row: undated, or posted on or before the floor's day (n1430). */
export function belowCapFloor(postedAt: string | null | undefined, floor: string | null | undefined): boolean {
  return floor != null && !(Date.parse(String(postedAt ?? "")) >= Date.parse(floor) + 86_400_000);
}

/** Where a walk from `startOffset` resumes (UKG, ADP; n1431): the fetchOracle contract, and its refusal of an empty first page. */
export function resumeAt(startOffset: number, fetched: number, feedTotal: number, exhausted: boolean) {
  const empty = emptyFirstPage(startOffset, fetched, feedTotal);
  if (empty === "refused") throw new Error(`empty page but total=${feedTotal}`);
  const ended = empty ? empty === "ended" : exhausted, endOffset = startOffset + fetched;
  const nextOffset = ended || empty === "restart" || (feedTotal > 0 && endOffset >= feedTotal) ? 0 : endOffset;
  return { windowed: !ended || startOffset > 0, feedTotal, nextOffset, feedEnded: ended, endOffset };
}
