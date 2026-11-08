// HOW MANY RÉSUMÉ-FIT SCORINGS A ... docs/shared-notes.md#s82

/** Fit scorings a day on any key without a paid tier, a pass, the Agent plan or Pro. */
export const FIT_FREE_PER_DAY = 25;
/** Fit scorings a day with one of them: job-fit's per-key bucket. */
export const FIT_FULL_PER_DAY = 1000;

export type FitStanding = { full: boolean; limit: number };

/** The day's limit for a key, from whether something it holds opens the full allowance. */
export function fitStanding(full: boolean): FitStanding {
  return { full, limit: full ? FIT_FULL_PER_DAY : FIT_FREE_PER_DAY };
}

// Whether this call may score, ... docs/shared-notes.md#s83
export function fitAllowed(standing: FitStanding, usedIncludingThisCall: number): boolean {
  if (standing.full) return true;
  return Number.isFinite(usedIncludingThisCall) && usedIncludingThisCall <= FIT_FREE_PER_DAY;
}

/** Free scorings left today after this call, for key_status and the refusal. */
export function fitFreeLeft(usedIncludingThisCall: number): number {
  const used = Number.isFinite(usedIncludingThisCall) ? usedIncludingThisCall : FIT_FREE_PER_DAY;
  return Math.max(0, FIT_FREE_PER_DAY - used);
}
