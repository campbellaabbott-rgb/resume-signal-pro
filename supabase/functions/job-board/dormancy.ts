export interface BoardFailureState {
  streaks: Record<string, number>;
  dormant: Record<string, number>;
  failedAt?: Record<string, number>;
  firstFailedAt?: Record<string, number>;
}
export function retryBackoffMs(streak: number): number {
  const base = 15 * 60_000;
  const capped = Math.min(Math.max(streak, 1), 5);
  return Math.min(base * 2 ** (capped - 1), 4 * 60 * 60_000);
}
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
    if (params.dormant[token] != null) continue;
    if (params.exclude.has(token)) continue;
    const streak = params.streaks[token] ?? 1;
    const overdueBy = params.now - at - retryBackoffMs(streak);
    if (overdueBy >= 0) due.push({ token, overdueBy });
  }
  due.sort((a, b) => b.overdueBy - a.overdueBy);
  return due.slice(0, Math.max(params.cap, 0)).map((d) => d.token);
}
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
    if (since == null) continue;
    if (now - since >= recheckMs) recheck.add(t);
    else skip.add(t);
  }
  return { skip, recheck };
}
export function updateBoardFailures(params: {
  okTokens: readonly string[];
  failedTokens: readonly string[];
  recheckTokens: ReadonlySet<string>;
  streaks: Record<string, number>;
  dormant: Record<string, number>;
  failedAt?: Record<string, number>;
  firstFailedAt?: Record<string, number>;
  deadThreshold: number;
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
    delete failedAt[t];
    delete firstFailedAt[t];
  }
  for (const t of params.failedTokens) {
    if (params.recheckTokens.has(t)) {
      dormant[t] = params.now;
      delete failedAt[t];
      delete firstFailedAt[t];
      continue;
    }
    streaks[t] = (streaks[t] ?? 0) + 1;
    failedAt[t] = params.now;
    if (firstFailedAt[t] == null) firstFailedAt[t] = params.now;
    const failingFor = params.now - firstFailedAt[t];
    if (streaks[t] >= params.deadThreshold && failingFor >= params.minFailureAgeMs) {
      toPrune.push(t);
      delete streaks[t];
      delete failedAt[t];
      delete firstFailedAt[t];
      dormant[t] = params.now;
    }
  }
  const entries = Object.entries(dormant);
  if (entries.length > params.dormantCap) {
    dormant = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  let bounded = failedAt;
  const fEntries = Object.entries(failedAt);
  if (fEntries.length > params.dormantCap) {
    bounded = Object.fromEntries(fEntries.sort((a, b) => b[1] - a[1]).slice(0, params.dormantCap));
  }
  const keep = new Set(Object.keys(bounded));
  const boundedFirst = Object.fromEntries(
    Object.entries(firstFailedAt).filter(([k]) => keep.has(k)),
  );
  return { streaks, dormant, failedAt: bounded, firstFailedAt: boundedFirst, toPrune };
}