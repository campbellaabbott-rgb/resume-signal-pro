// Which boards with a resume offset (deepCursors) a cold slice takes into the deep lane.
// Rationale: docs/job-board-index-notes.md#n426-deep-lane-ahead-of-base

/**
 * The lane's start, mapped from the cold cursor's place in its rotation onto the candidate list.
 * Monotone in `cold` within a rotation, so a run of slices walks the list in order whatever the cursor's stride.
 */
export function deepLaneStart(cold: number, coldListLen: number, candidates: number): number {
  if (!(candidates > 0)) return 0;
  const n = Math.max(1, Math.floor(coldListLen) || 1);
  const c = ((Math.floor(Number(cold) || 0) % n) + n) % n;
  return Math.min(candidates - 1, Math.floor((c * candidates) / n));
}

/** Up to `take` candidates from the start, skipping any already in the slice (deduped before the cap). */
export function selectDeepLane(
  tokens: readonly string[],
  o: { cold: number; coldListLen: number; take: number; taken: ReadonlySet<string> },
): { start: number; picked: string[] } {
  const start = deepLaneStart(o.cold, o.coldListLen, tokens.length);
  const take = Math.max(0, Math.floor(o.take) || 0);
  const picked = take === 0 ? [] : [...tokens.slice(start), ...tokens.slice(0, start)].filter((t) => !o.taken.has(t)).slice(0, take);
  return { start, picked };
}
