/**
 * WHAT HAPPENED TO THE POSTING AFTER YOU INTERVIEWED FOR IT.
 *
 * `job_board_closures` is the one asset a competitor cannot buy, scrape or
 * backfill: a takedown leaves no artifact anywhere, so reconstructing it means
 * having owned the fetch on the day the posting was up AND the day it vanished.
 * `get_application_lifecycle` already joins it to the tracker, and the account
 * already renders the result — "This posting closed by <date>".
 *
 * That sentence is worth the most at exactly one moment, and it is not the one
 * it is shown at. Two weeks after an interview, the candidate is refreshing
 * their inbox and has no information at all. The posting coming down is the
 * only observable event in that silence, and we are the only people who can see
 * it. Placed against the interview date it answers the question they actually
 * have: are they still looking?
 *
 * THE FOUR THINGS THIS MUST NOT SAY, each of which it would be easy to imply:
 *
 *  1. "You got the job." A closure is a takedown, not an outcome. It is
 *     consistent with somebody else being hired, the req being cancelled, and
 *     the budget being pulled. Every string below describes the POSTING.
 *  2. "They rejected you." Same evidence, opposite guess. Neither is ours.
 *  3. "The posting is still open" from an absence of closures. Employers on
 *     windowed or capped feeds log ZERO closures by design — `truncatedFetch`
 *     refuses to log them — so "no closure observed" is an artifact of the feed
 *     for those, never evidence about the employer. `not_observed` is a state
 *     with its own sentence, and it is never folded into "still standing".
 *  4. Anything at all when the dates cannot support it. A closure recorded
 *     BEFORE the interview date is either a rescheduled interview or a mistyped
 *     date, and reading it as "they closed it before meeting you" would be a
 *     confident answer built on a typo.
 *
 * Pure, and deliberately consumes what the tracker already has: the same
 * lifecycle RPC Account.tsx calls, no second query, no new definer function.
 * (107 of 121 definer functions in this project turned out to be anon-callable;
 * the cheapest one to secure is the one not written.)
 */

/** The tracker row's shape, as much of it as this needs. */
export type TrackedApplication = {
  id: string;
  company: string;
  role?: string | null;
  status?: string | null;
  applied_at?: string | null;
  interview_at?: string | null;
  /** From get_application_lifecycle: came_down | came_down_relisted | still_standing | not_observed */
  lifecycle_outcome?: string | null;
  posting_closed_at?: string | null;
};

export type InterviewSignalKind =
  /** Came down after the interview and has not reappeared. The strongest one. */
  | "closed-after"
  /** Came down after the interview, and the same role went back up since. */
  | "relisted-after"
  /** Still on the board N days after the interview. */
  | "still-open"
  /** Gone from the board with no closure on record — we do not know. */
  | "not-observed"
  /** A closure stamped at or before the interview date. Reported, never read. */
  | "closed-before";

export type InterviewSignal = {
  kind: InterviewSignalKind;
  application: TrackedApplication;
  /** Days between the interview and the closure, or between then and now. */
  days: number;
  /** The closure date, when there is a measured one. Never invented. */
  closedAt: string | null;
};

const DAY = 86_400_000;

/**
 * A date, or null. Rejects anything unparseable rather than yielding NaN into
 * arithmetic, where it would silently become 0 days and read as "today".
 */
const at = (iso: string | null | undefined): number | null => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? t : null;
};

/**
 * Interviews that have already happened, with what the board did afterwards.
 *
 * `now` is a parameter so this is testable without freezing the clock, and so a
 * test cannot pass because it ran on the right day.
 */
export function interviewSignals(
  applications: readonly TrackedApplication[],
  now: number = Date.now(),
): InterviewSignal[] {
  const out: InterviewSignal[] = [];

  for (const a of applications) {
    const iv = at(a.interview_at);
    // No interview date is not a missing signal — it is a different question,
    // and the tracker's own lifecycle line already answers that one.
    if (iv === null) continue;
    // An interview in the future has nothing to attribute yet. Same one-day
    // grace as InterviewsHub uses, so a row cannot be "upcoming" there and
    // "past" here at the same moment.
    if (iv > now - DAY) continue;

    const outcome = String(a.lifecycle_outcome ?? "");
    const closed = at(a.posting_closed_at);

    if (outcome === "still_standing") {
      out.push({ kind: "still-open", application: a, days: Math.floor((now - iv) / DAY), closedAt: null });
      continue;
    }

    // A closure we cannot date cannot be placed against the interview, and
    // placing it anyway is how a tracker starts inventing dates — the exact bug
    // get_application_lifecycle was written to end.
    if ((outcome === "came_down" || outcome === "came_down_relisted") && closed !== null) {
      if (closed <= iv) {
        // Before the meeting. Almost always a rescheduled or mistyped date, so
        // it is surfaced as itself and never as a finding about the employer.
        out.push({ kind: "closed-before", application: a, days: Math.floor((iv - closed) / DAY), closedAt: a.posting_closed_at ?? null });
        continue;
      }
      out.push({
        kind: outcome === "came_down_relisted" ? "relisted-after" : "closed-after",
        application: a,
        days: Math.floor((closed - iv) / DAY),
        closedAt: a.posting_closed_at ?? null,
      });
      continue;
    }

    // Everything else — `not_observed`, an unstamped row, a closure with no
    // date. One state, one sentence, and it is an admission rather than a
    // signal. Folding it into "still open" would turn every windowed feed into
    // a false reassurance.
    out.push({ kind: "not-observed", application: a, days: Math.floor((now - iv) / DAY), closedAt: null });
  }

  // Most recent interview first: the one still on somebody's mind.
  return out.sort((x, y) => (at(y.application.interview_at) ?? 0) - (at(x.application.interview_at) ?? 0));
}

/**
 * The one-line summary, and the reason it counts only two of the five kinds.
 *
 * `observed` is the denominator that can support a claim: interviews where the
 * posting either measurably came down or is measurably still up. `not-observed`
 * and `closed-before` are excluded from BOTH sides — including them in the
 * denominator would quietly deflate the rate with rows that carry no evidence,
 * and this platform has already published one false figure by counting a
 * requested window as an observed one.
 */
export function attributionSummary(signals: readonly InterviewSignal[]): {
  interviews: number;
  observed: number;
  closedAfter: number;
  stillOpen: number;
  relisted: number;
  unobserved: number;
} {
  const n = (k: InterviewSignalKind) => signals.filter((s) => s.kind === k).length;
  const closedAfter = n("closed-after");
  const stillOpen = n("still-open");
  const relisted = n("relisted-after");
  return {
    interviews: signals.length,
    observed: closedAfter + stillOpen + relisted,
    closedAfter,
    stillOpen,
    relisted,
    unobserved: n("not-observed") + n("closed-before"),
  };
}
