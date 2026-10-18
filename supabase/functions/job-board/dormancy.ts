// Rationale: docs/job-board-index-notes.md#n1305-export-interface-boardfailurestate

export interface BoardFailureState {
  /** token -> consecutive failure count (pre-dormancy) */
  streaks: Record<string, number>;
  /** token -> epoch ms when the board was put dormant (drives recheck timing) */
  dormant: Record<string, number>;
  // Rationale: docs/job-board-index-notes.md#n1306-failedat-record-string-number
  failedAt?: Record<string, number>;
  // Rationale: docs/job-board-index-notes.md#n1307-firstfailedat-record-string-number
  firstFailedAt?: Record<string, number>;
  /** board key -> consecutive visits whose rows our database would not read or store (foldDbFailures, S11-023). */
  dbStreaks?: Record<string, number>;
}

// Rationale: docs/job-board-index-notes.md#n1308-const-own-rec-record-string-number
const own = (rec: Record<string, number>, t: string): number | undefined => (Object.prototype.hasOwnProperty.call(rec, t) ? rec[t] : undefined);

// Rationale: docs/job-board-index-notes.md#n1309-export-function-retrybackoffms-streak-nu
export function retryBackoffMs(streak: number): number {
  const base = 15 * 60_000;
  const capped = Math.min(Math.max(streak, 1), 5);
  return Math.min(base * 2 ** (capped - 1), 4 * 60 * 60_000);
}

// Rationale: docs/job-board-index-notes.md#n1310-export-function-selectretries-params
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
    if (own(params.dormant, token) != null) continue;  // dormancy owns its cadence
    if (params.exclude.has(token)) continue;           // already in this slice
    const streak = own(params.streaks, token) ?? 1;
    const overdueBy = params.now - at - retryBackoffMs(streak);
    if (overdueBy >= 0) due.push({ token, overdueBy });
  }
  // Rationale: docs/job-board-index-notes.md#n1311-due-sort-a-b-b-overdueby
  due.sort((a, b) => b.overdueBy - a.overdueBy);
  return due.slice(0, Math.max(params.cap, 0)).map((d) => d.token);
}

// Rationale: docs/job-board-index-notes.md#n1312-export-function-classifydormancy
export function classifyDormancy(
  tokens: readonly string[],
  dormant: Record<string, number>,
  now: number,
  recheckMs: number,
): { skip: Set<string>; recheck: Set<string> } {
  const skip = new Set<string>();
  const recheck = new Set<string>();
  for (const t of tokens) {
    const since = own(dormant, t);
    if (since == null) continue; // active board — fetch normally
    if (now - since >= recheckMs) recheck.add(t); // due for a recovery probe
    else skip.add(t); // dormant and not due — skip the dead fetch
  }
  return { skip, recheck };
}

// Rationale: docs/job-board-index-notes.md#n1313-export-function-updateboardfailures-para
export function updateBoardFailures(params: {
  okTokens: readonly string[];
  // Rationale: docs/job-board-index-notes.md#n1314-answeredtokens-readonly-string
  answeredTokens?: readonly string[];
  failedTokens: readonly string[];
  recheckTokens: ReadonlySet<string>;
  streaks: Record<string, number>;
  dormant: Record<string, number>;
  failedAt?: Record<string, number>;
  firstFailedAt?: Record<string, number>;
  deadThreshold: number;
  // Rationale: docs/job-board-index-notes.md#n1315-minfailureagems-number
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

  const answered = new Set(params.answeredTokens ?? []);
  for (const t of [...params.okTokens, ...answered]) {
    delete streaks[t];
    delete dormant[t];
    // A board that answered has nothing to retry. Leaving the stamp would keep
    // it in the retry lane forever, spending the budget on a healthy feed.
    delete failedAt[t];
    delete firstFailedAt[t];   // the streak is over; the clock starts fresh next time
  }
  for (const t of params.failedTokens) {
    // A board whose feed answered is not failing, whatever list a caller put it in.
    if (answered.has(t)) continue;
    if (params.recheckTokens.has(t)) {
      dormant[t] = params.now; // recovery probe still dead — reset the recheck timer
      delete failedAt[t];      // dormancy owns this board's cadence now
      delete firstFailedAt[t];
      continue;
    }
    const streak = (own(streaks, t) ?? 0) + 1;
    streaks[t] = streak;
    failedAt[t] = params.now;
    // Rationale: docs/job-board-index-notes.md#n1316-const-firstat-own-firstfailedat-t-params
    const firstAt = own(firstFailedAt, t) ?? params.now;
    firstFailedAt[t] = firstAt;
    const failingFor = params.now - firstAt;
    if (streak >= params.deadThreshold && failingFor >= params.minFailureAgeMs) {
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
  // Rationale: docs/job-board-index-notes.md#n1317-let-bounded-failedat
  let bounded = failedAt;
  const fEntries = Object.entries(failedAt);
  if (fEntries.length > params.dormantCap) {
    bounded = Object.fromEntries(fEntries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  // Rationale: docs/job-board-index-notes.md#n1318-const-keep-new-set-object-keys
  const keep = new Set(Object.keys(bounded));
  const boundedFirst = Object.fromEntries(
    Object.entries(firstFailedAt).filter(([k]) => keep.has(k)),
  );
  return { streaks, dormant, failedAt: bounded, firstFailedAt: boundedFirst, toPrune };
}

// Rationale: docs/job-board-index-notes.md#n1319-export-function-rearmincompleteprunes
export function rearmIncompletePrunes(
  state: { streaks: Record<string, number>; dormant: Record<string, number>; failedAt: Record<string, number>; firstFailedAt: Record<string, number> },
  keys: readonly string[],
  before: { firstFailedAt?: Record<string, number> },
  deadThreshold: number,
  now: number,
): { streaks: Record<string, number>; dormant: Record<string, number>; failedAt: Record<string, number>; firstFailedAt: Record<string, number> } {
  if (keys.length === 0) return state;
  const streaks = { ...state.streaks };
  const dormant = { ...state.dormant };
  const failedAt = { ...state.failedAt };
  const firstFailedAt = { ...state.firstFailedAt };
  for (const k of keys) {
    delete dormant[k];
    streaks[k] = Math.max(1, deadThreshold - 1);
    failedAt[k] = now;
    firstFailedAt[k] = own(before.firstFailedAt ?? {}, k) ?? now;
  }
  return { streaks, dormant, failedAt, firstFailedAt };
}

// Rationale: docs/job-board-index-notes.md#n1320-export-function-boardkey-source-string-t
export function boardKey(source: string, token: string, shared: ReadonlySet<string>): string {
  return shared.has(token) ? `${source}:${token}` : token;
}

/** The token a board key names. */
export function keyToken(key: string): string {
  const at = key.indexOf(":");
  return at < 0 ? key : key.slice(at + 1);
}

/** The vendor a board key names, or null for a bare-token key. */
export function keySource(key: string): string | null {
  const at = key.indexOf(":");
  return at < 0 ? null : key.slice(0, at);
}

// Rationale: docs/job-board-index-notes.md#n1321-export-function-dropbaresharedkeys-state
export function dropBareSharedKeys(state: BoardFailureState, shared: ReadonlySet<string>): { state: BoardFailureState; dropped: number } {
  let dropped = 0;
  const clean = (rec: Record<string, number> | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
      if (shared.has(k)) { dropped++; continue; }
      out[k] = v;
    }
    return out;
  };
  return {
    state: {
      streaks: clean(state.streaks),
      dormant: clean(state.dormant),
      failedAt: clean(state.failedAt),
      firstFailedAt: clean(state.firstFailedAt),
    },
    dropped,
  };
}

// Rationale: docs/job-board-index-notes.md#n1322-export-const-db_fail_alarm_visits
export const DB_FAIL_ALARM_VISITS = 3;

export function foldDbFailures(
  prev: Record<string, number> | null | undefined,
  dbFailed: readonly string[],
  stored: readonly string[],
  cap: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(prev ?? {})) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  for (const k of stored) delete out[k];
  for (const k of new Set(dbFailed)) out[k] = (own(out, k) ?? 0) + 1;
  const entries = Object.entries(out);
  return entries.length > cap ? Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, cap)) : out;
}

/** The boards whose stores have failed DB_FAIL_ALARM_VISITS visits running, longest run first. */
export function dbFailingBoards(dbStreaks: Record<string, number> | null | undefined, threshold = DB_FAIL_ALARM_VISITS): Array<{ key: string; visits: number }> {
  return Object.entries(dbStreaks ?? {})
    .filter(([, v]) => typeof v === "number" && v >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([key, visits]) => ({ key, visits }));
}
