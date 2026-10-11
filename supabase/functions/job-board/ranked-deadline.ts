// The ranked RPC on a clock (S11-009). Rationale: docs/job-board-index-notes.md#n482-the-description-tier-on-a-clock

/** The full call (title tier, then the description tier under 200 title hits). */
export const RANKED_FULL_DEADLINE_MS = 2_500;
/** The title tier alone, asked for when the full call missed its clock. */
export const RANKED_TITLE_DEADLINE_MS = 4_000;

export type RankedAnswer<T> = { data: T[] | null; error?: { code?: string; message?: string } | null };

/**
 * search_jobs with its description tier bounded. The full call races fullMs;
 * on a miss the title tier alone (p_title_only) answers under titleMs, and
 * `cut` says the description tier was not read. Both clocks missing answers
 * data null with `timedOut`. A clock never outlasts the request's budget.
 * withDeadline cannot cancel SQL: the abandoned call runs to its own 8 s.
 */
export async function rankedWithDeadline<T>(
  call: (titleOnly: boolean) => PromiseLike<RankedAnswer<T>>,
  budgetLeft: () => number,
  fullMs = RANKED_FULL_DEADLINE_MS,
  titleMs = RANKED_TITLE_DEADLINE_MS,
): Promise<RankedAnswer<T> & { cut: boolean; timedOut: boolean }> {
  const full = await raced(call(false), Math.min(fullMs, budgetLeft()));
  if (full) return { ...full, cut: false, timedOut: false };
  const title = await raced(call(true), Math.min(titleMs, budgetLeft()));
  if (title) return { ...title, cut: true, timedOut: false };
  return { data: null, error: null, cut: true, timedOut: true };
}

/** The answer, or null when the clock won. A rejection is an answer (an error). */
function raced<T>(p: PromiseLike<RankedAnswer<T>>, ms: number): Promise<RankedAnswer<T> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clock = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, ms)); });
  const answer = Promise.resolve(p).then(
    (r) => r,
    (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }),
  );
  return Promise.race([answer, clock]).finally(() => clearTimeout(timer));
}
