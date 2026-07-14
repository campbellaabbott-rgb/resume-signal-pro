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
  deadThreshold: number;
  dormantCap: number;
  now: number;
}): { streaks: Record<string, number>; dormant: Record<string, number>; toPrune: string[] } {
  const streaks: Record<string, number> = { ...params.streaks };
  let dormant: Record<string, number> = { ...params.dormant };
  const toPrune: string[] = [];

  for (const t of params.okTokens) {
    delete streaks[t];
    delete dormant[t];
  }
  for (const t of params.failedTokens) {
    if (params.recheckTokens.has(t)) {
      dormant[t] = params.now; // recovery probe still dead — reset the recheck timer
      continue;
    }
    streaks[t] = (streaks[t] ?? 0) + 1;
    if (streaks[t] >= params.deadThreshold) {
      toPrune.push(t);
      delete streaks[t];
      dormant[t] = params.now;
    }
  }

  const entries = Object.entries(dormant);
  if (entries.length > params.dormantCap) {
    dormant = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  return { streaks, dormant, toPrune };
}
