// Dormancy skip-list for the cold-tier refresh rotation.
//
// The problem it solves: a chronically-dead feed stays in the catalog (COLD_LIST)
// and, every rotation, burns the full FETCH_TIMEOUT (~20s) before failing — pure
// wasted wall-clock that slows the whole cold-tail re-verification. The old prune
// deleted a dead board's POSTINGS at 6 consecutive failures but left its TOKEN in
// the rotation, so it kept getting fetched (and kept timing out) forever, and the
// streak reset meant it oscillated at the threshold indefinitely.
//
// The fix keeps the rotation cursor untouched (dead boards stay in COLD_LIST, so
// indexing and sweep coverage are unchanged) and instead skips the wasteful FETCH
// for dormant boards, rechecking each one only once per recheck window so a feed
// that comes back rejoins automatically. Pure functions here; all DB I/O stays in
// index.ts so this is unit-testable.

export interface BoardFailureState {
  /** token -> consecutive failure count (pre-dormancy) */
  streaks: Record<string, number>;
  /** token -> epoch ms when the board was put dormant (drives recheck timing) */
  dormant: Record<string, number>;
  /**
   * token -> epoch ms of the most recent FAILURE, for boards that are failing
   * but not yet dormant. Drives the retry lane's backoff.
   *
   * Measured 2026-08-26, and this is the whole reason it exists: a board only
   * gets a verification stamp when its fetch SUCCEEDS, so one failed fetch used
   * to cost that board a full rotation — 8.2 hours — before anything tried it
   * again. Two or three consecutive failures put it at 16-25h, which is exactly
   * where the freshness p95 sat (20.7h) while p50 was healthy at 4.9h. 82.5% of
   * boards were inside one rotation; the 5% tail was not slow rotation, it was
   * boards waiting a whole rotation for their second chance.
   */
  failedAt?: Record<string, number>;
  /**
   * token -> epoch ms of the FIRST failure in the current streak.
   *
   * THE PRUNE BAR IS A DURATION, NOT AN ATTEMPT COUNT, AND IT HAS TO STAY ONE.
   *
   * DEAD_BOARD_THRESHOLD (6) was calibrated when attempts arrived once per
   * rotation, so "6 consecutive failures" MEANT "dead for about 41 hours" —
   * that duration is the actual protection between a transient vendor blip and
   * deleting a company's entire corpus (the prune writes an exit row per
   * posting, deletes every row for the token, and blacks the board out for 12h;
   * re-ingest then resets first_seen).
   *
   * The retry lane decouples attempts from time: six attempts now fit in 7h45m.
   * Left alone, that silently cut a 41-hour guard to under eight — a Workday
   * CDN throttle of the kind already recorded in this codebase would have
   * pruned boards that were never dead. So the streak still gates the prune,
   * but a wall-clock floor gates it too, and THAT is the number calibrated
   * against reality. Adding a faster lane can no longer erode it.
   */
  firstFailedAt?: Record<string, number>;
}

/**
 * How long to wait before retrying a board that just failed, by streak.
 *
 * EXPONENTIAL, AND THAT IS THE POINT. A retry is not free: a dead feed burns the
 * full FETCH_TIMEOUT (~20s) before failing, which is the exact cost dormancy was
 * built to stop paying every rotation. A flat retry interval would hand that
 * cost back — every failing board, every few minutes, forever.
 *
 * Backoff makes the first retry cheap and fast (15 min, where transient vendor
 * 500s live) while a board that keeps failing recedes on its own until dormancy
 * takes over at DEAD_BOARD_THRESHOLD:
 *
 *   streak 1 -> 15 min    streak 3 -> 60 min    streak 5 -> 4h
 *   streak 2 -> 30 min    streak 4 -> 2h        streak 6 -> dormant (12h probe)
 */
export function retryBackoffMs(streak: number): number {
  const base = 15 * 60_000;
  const capped = Math.min(Math.max(streak, 1), 5);
  return Math.min(base * 2 ** (capped - 1), 4 * 60 * 60_000);
}

/**
 * Boards that failed recently and are now due for another attempt, most-overdue
 * first, capped.
 *
 * `exclude` is the set of tokens already in this slice — a board about to be
 * fetched anyway must not also take a retry place, which would spend the budget
 * and change nothing.
 *
 * Dormant boards are deliberately NOT here: they have their own, slower probe
 * cadence (DORMANT_RECHECK_MS) and re-admitting them to a 15-minute lane would
 * undo dormancy entirely.
 */
export function selectRetries(params: {
  streaks: Record<string, number>;
  failedAt: Record<string, number>;
  dormant: Record<string, number>;
  exclude: ReadonlySet<string>;
  now: number;
  cap: number;
}): string[] {
  const due: Array<{ token: string; overdueBy: number }> = [];
  for (const [token, at] of Object.entries(params.failedAt)) {
    if (params.dormant[token] != null) continue;      // dormancy owns its cadence
    if (params.exclude.has(token)) continue;           // already in this slice
    const streak = params.streaks[token] ?? 1;
    const overdueBy = params.now - at - retryBackoffMs(streak);
    if (overdueBy >= 0) due.push({ token, overdueBy });
  }
  // Most overdue first, so a growing backlog drains oldest-first rather than
  // letting whichever token Object.entries happens to yield first monopolise
  // the lane.
  due.sort((a, b) => b.overdueBy - a.overdueBy);
  return due.slice(0, Math.max(params.cap, 0)).map((d) => d.token);
}

/**
 * Split the fetch-eligible tokens of a cold slice into those to skip (dormant and
 * not yet due for a recovery probe) and those to recheck (dormant but past the
 * recheck window — fetch them once to see if the feed recovered). Tokens with no
 * dormancy record are neither: they fetch normally.
 *
 * Callers pass only tokens that are eligible to skip — demand-injected /
 * user-requested boards are excluded upstream so a board a user just opened is
 * always fetched.
 */
export function classifyDormancy(
  tokens: readonly string[],
  dormant: Record<string, number>,
  now: number,
  recheckMs: number,
): { skip: Set<string>; recheck: Set<string> } {
  const skip = new Set<string>();
  const recheck = new Set<string>();
  for (const t of tokens) {
    const since = dormant[t];
    if (since == null) continue; // active board — fetch normally
    if (now - since >= recheckMs) recheck.add(t); // due for a recovery probe
    else skip.add(t); // dormant and not due — skip the dead fetch
  }
  return { skip, recheck };
}

/**
 * Fold a slice's fetch results into the next board-failure state.
 *
 * - A board that responded (okTokens) is healthy: its streak and any dormancy clear.
 * - A recheck probe that failed stays dormant with a refreshed timer (still dead).
 * - Any other failure increments its streak; at deadThreshold the board is pruned
 *   (returned in `toPrune` for the caller to delete) and put dormant.
 * - Skipped dormant boards are not in okTokens/failedTokens, so they are untouched
 *   and keep waiting for their recheck window.
 *
 * The dormant map is capped (keeping the most recently detected entries, whose
 * recheck timers are still meaningful) so a mass die-off can't bloat the meta row.
 */
export function updateBoardFailures(params: {
  okTokens: readonly string[];
  failedTokens: readonly string[];
  recheckTokens: ReadonlySet<string>;
  streaks: Record<string, number>;
  dormant: Record<string, number>;
  failedAt?: Record<string, number>;
  firstFailedAt?: Record<string, number>;
  deadThreshold: number;
  /**
   * Wall-clock floor a board must have been failing for before the prune is
   * allowed, regardless of how many attempts fit into that window.
   */
  minFailureAgeMs: number;
  dormantCap: number;
  now: number;
}): {
  streaks: Record<string, number>;
  dormant: Record<string, number>;
  failedAt: Record<string, number>;
  firstFailedAt: Record<string, number>;
  toPrune: string[];
} {
  const streaks: Record<string, number> = { ...params.streaks };
  let dormant: Record<string, number> = { ...params.dormant };
  const failedAt: Record<string, number> = { ...(params.failedAt ?? {}) };
  const firstFailedAt: Record<string, number> = { ...(params.firstFailedAt ?? {}) };
  const toPrune: string[] = [];

  for (const t of params.okTokens) {
    delete streaks[t];
    delete dormant[t];
    // A board that answered has nothing to retry. Leaving the stamp would keep
    // it in the retry lane forever, spending the budget on a healthy feed.
    delete failedAt[t];
    delete firstFailedAt[t];   // the streak is over; the clock starts fresh next time
  }
  for (const t of params.failedTokens) {
    if (params.recheckTokens.has(t)) {
      dormant[t] = params.now; // recovery probe still dead — reset the recheck timer
      delete failedAt[t];      // dormancy owns this board's cadence now
      delete firstFailedAt[t];
      continue;
    }
    streaks[t] = (streaks[t] ?? 0) + 1;
    failedAt[t] = params.now;
    // A board carrying no start-of-streak stamp starts its clock NOW. That is
    // deliberately the conservative direction: state written before this field
    // existed delays a prune by up to the floor, and never accelerates one.
    if (firstFailedAt[t] == null) firstFailedAt[t] = params.now;
    const failingFor = params.now - firstFailedAt[t];
    if (streaks[t] >= params.deadThreshold && failingFor >= params.minFailureAgeMs) {
      toPrune.push(t);
      delete streaks[t];
      delete failedAt[t];      // handed over to the dormant probe cadence
      delete firstFailedAt[t];
      dormant[t] = params.now;
    }
  }

  const entries = Object.entries(dormant);
  if (entries.length > params.dormantCap) {
    dormant = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  // failedAt is bounded by the same reasoning as dormant: a mass vendor outage
  // must not grow this meta row without limit. Newest kept — an old stamp is
  // the least useful, since its board is either long since retried or has gone
  // dormant.
  let bounded = failedAt;
  const fEntries = Object.entries(failedAt);
  if (fEntries.length > params.dormantCap) {
    bounded = Object.fromEntries(fEntries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  // firstFailedAt is bounded alongside failedAt and by the same key set: a
  // start stamp whose last-failure stamp has been evicted has nothing left to
  // gate, and keeping it would leak rows a mass outage created.
  const keep = new Set(Object.keys(bounded));
  const boundedFirst = Object.fromEntries(
    Object.entries(firstFailedAt).filter(([k]) => keep.has(k)),
  );
  return { streaks, dormant, failedAt: bounded, firstFailedAt: boundedFirst, toPrune };
}
