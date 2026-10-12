/**
 * HOW MANY RÉSUMÉ-FIT SCORINGS A KEY GETS IN A DAY.
 *
 * Owner decision 2026-10-11 (economics decision 2(a)): fit scoring is free
 * fair use, 25 calls a day, on any key the board issued -- every live key is
 * email-confirmed (api_key_issue mints only after the mailbox clicks its link,
 * 20261004100000) or minted by a signed-in account -- and 1,000 a day for a
 * paid tier, a live pass, the Agent plan or Pro. It is never offered on
 * ChatGPT. The scorer is a dictionary scorer with no model call, and the site
 * already scores at 60 an hour per address, so this is a bound, not a price.
 *
 * The 1,000 is job-fit's own per-key bucket (FIT_KEY_MAX): it stays the
 * backstop for every key. The 25 is counted from api_usage, the table the key
 * check meters every call into, so a free key's fit day is the same day its
 * quota counts, and the count includes the call being decided.
 *
 * One module so the connector and POST /v1/fit cannot give the same key two
 * different allowances. Import-free.
 */

/** Fit scorings a day on any key without a paid tier, a pass, the Agent plan or Pro. */
export const FIT_FREE_PER_DAY = 25;
/** Fit scorings a day with one of them: job-fit's per-key bucket. */
export const FIT_FULL_PER_DAY = 1000;

export type FitStanding = { full: boolean; limit: number };

/** The day's limit for a key, from whether something it holds opens the full allowance. */
export function fitStanding(full: boolean): FitStanding {
  return { full, limit: full ? FIT_FULL_PER_DAY : FIT_FREE_PER_DAY };
}

/**
 * Whether this call may score, given the day's count INCLUDING this call (the
 * key check counts before the tool runs). A full standing is bounded by the
 * scorer itself, never here.
 */
export function fitAllowed(standing: FitStanding, usedIncludingThisCall: number): boolean {
  if (standing.full) return true;
  return Number.isFinite(usedIncludingThisCall) && usedIncludingThisCall <= FIT_FREE_PER_DAY;
}

/** Free scorings left today after this call, for key_status and the refusal. */
export function fitFreeLeft(usedIncludingThisCall: number): number {
  const used = Number.isFinite(usedIncludingThisCall) ? usedIncludingThisCall : FIT_FREE_PER_DAY;
  return Math.max(0, FIT_FREE_PER_DAY - used);
}
