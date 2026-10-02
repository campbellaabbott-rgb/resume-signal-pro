/**
 * WHETHER A WEEK'S TAKEDOWN COUNT MAY BE PRINTED AT ALL.
 *
 * /hiring-trends printed 845,110, 870,536 and 806,570 takedowns for the weeks
 * beginning 2026-09-07, 09-14 and 09-21, beside a 90-day closure total of
 * 1,852,789 read off the same cache row. A week cannot outnumber the quarter
 * it sits inside; it did because the weekly series counted batches the
 * collector had itself flagged as possible read failures (`suspect`) and the
 * 90-day total did not. Migration 20261002113617 puts the week on the 90-day
 * rule and publishes the excluded count beside it as `closed_flagged`.
 *
 * THAT MAKES THE FIGURE CONSISTENT, NOT CORRECT, and this module is the half
 * of the fix that knows the difference. The flagged mass comes from a Workday
 * read that treats each 250-row window as the whole board; the feed-dark guard
 * catches the large batches and misses the small ones, so on those weeks the
 * admitted count still carries unflagged phantom takedowns and is missing
 * every real takedown on a flagged board. When the flagged records outnumber
 * the ones the collector could vouch for, the week describes our crawler more
 * than it describes employers, and no count beats a suspect count.
 *
 * THE RULES, IN ORDER -- the first that fires decides:
 *
 *   1. `closed` is not a finite, non-negative number      -> held, unreadable
 *   2. it reads above CLOSURE_WEEK_PLAUSIBILITY times the 90-day record's own
 *      average week: closed_90d over the days that count covers, times seven,
 *      where the days are observed_days capped at CLOSURE_RECORD_WINDOW_DAYS
 *                                                         -> held, exceeds_record
 *   3. `closed_flagged` is a number and exceeds `closed`  -> held, flagged_majority
 *   4. otherwise                                          -> published
 *
 * AN OLD FIVE-COLUMN ROW is judged by rule 2 alone, which is what makes the
 * page safe whichever of the frontend and the migration deploys first: every
 * incident week fails the ceiling on its own (806,570 against a ceiling of
 * about 329k on the 2026-10-01 record).
 *
 * THE SAME RULES RUN IN THE PRERENDER, which cannot import this file -- its
 * figure builder is sliced out of scripts/prerender-seo.mjs and evaluated
 * alone by its guard -- so closureWeekVerdict there is a mirror, and
 * a-week-of-takedowns-cannot-outnumber-its-own-quarter.test.ts runs both over
 * one grid of inputs and fails on any disagreement. A crawler and a browser
 * must never be told different things about the same week.
 *
 * The threshold is not to be relaxed to make the tile come back. It returns
 * on its own with the first clean full week.
 *
 * THE SENTENCE A HELD WEEK PRINTS IS A CLAIM ABOUT RULE 2, and it shipped
 * stating a different rule. Review of this change found the withheld copy --
 * here, in the prerender and in the page's "How we measure" entry -- telling
 * readers a week is held above twice the record's DAILY figure, while the
 * code holds it above twice the record's average WEEK: seven times higher.
 * Read literally, every week the page printed broke the rule it stated
 * (172,263 published on the 2026-10-01 record, whose daily figure doubled is
 * about 47k; the ceiling the code applies is about 329k).
 *
 * Checking that sentence against the code turned up a second gap in rule 2
 * itself. observed_days is the age of the whole closure ledger -- whose prune
 * has been off since 20261001090000 and sat at 180 days before that -- while
 * closed_90d counts 90 days. Dividing one by the other is the record's
 * average day only while the ledger is younger than 90 days (79 on
 * 2026-10-01). From about 2026-10-12 the divisor would keep growing
 * and the numerator would not, so the ceiling would sink -- at 180 days deep
 * it would sit at one average week, not two, and an ordinary busy week would
 * be withheld under a sentence saying it was more than twice the average.
 * The divisor is capped at the count's own window. Both runtimes apply the
 * cap, and a-withheld-week-states-the-rule-that-withheld-it.test.tsx parses
 * the rule out of every public sentence that states it and checks it against
 * the verdict on records younger and older than the window, so the words and
 * the arithmetic cannot drift apart again.
 */

/** How far above the closure record's own weekly average a single week may read. */
export const CLOSURE_WEEK_PLAUSIBILITY = 2;

/** The window closed_90d counts over. observed_days is the age of the whole
 *  ledger and outgrows it, so the average is taken over at most this many days. */
export const CLOSURE_RECORD_WINDOW_DAYS = 90;

export type ClosureHoldReason = "unreadable" | "exceeds_record" | "flagged_majority";

/** A hiring_trends row, old shape (no closed_flagged) or new. */
export interface ClosureWeek {
  closed?: unknown;
  closed_flagged?: unknown;
}

/** The two fields of stats_cache.ghost_stats the ceiling is drawn from. */
export interface ClosureRecord {
  closed_90d?: unknown;
  observed_days?: unknown;
}

export type ClosureVerdict =
  | { state: "published"; closed: number; flagged: number | null; ceiling: number | null }
  | { state: "held"; reason: ClosureHoldReason; closed: number | null; flagged: number | null; ceiling: number | null };

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** The most a week may read before it is refused, or null when the record cannot say. */
export function closureCeiling(record: ClosureRecord | null | undefined): number | null {
  const total = count(record?.closed_90d);
  const days = count(record?.observed_days);
  return total !== null && days !== null && days > 0
    ? (total / Math.min(days, CLOSURE_RECORD_WINDOW_DAYS)) * 7 * CLOSURE_WEEK_PLAUSIBILITY
    : null;
}

export function closureVerdict(
  week: ClosureWeek | null | undefined,
  record: ClosureRecord | null | undefined,
): ClosureVerdict {
  const closed = count(week?.closed);
  const flagged = count(week?.closed_flagged);
  const ceiling = closureCeiling(record);
  if (closed === null) return { state: "held", reason: "unreadable", closed, flagged, ceiling };
  if (ceiling !== null && closed > ceiling) return { state: "held", reason: "exceeds_record", closed, flagged, ceiling };
  if (flagged !== null && flagged > closed) return { state: "held", reason: "flagged_majority", closed, flagged, ceiling };
  return { state: "published", closed, flagged, ceiling };
}

/** The sentence a held week prints in place of its number. */
export function heldClosureSentence(
  v: Extract<ClosureVerdict, { state: "held" }>,
  fmt: (n: number) => string = (n) => n.toLocaleString(),
): string {
  if (v.reason === "flagged_majority") {
    return `Withheld — our collector flagged ${fmt(v.flagged ?? 0)} of the week's takedown records as possible read failures of its own, more than the ${fmt(v.closed ?? 0)} it could vouch for, so a figure here would describe our crawler rather than employers.`;
  }
  if (v.reason === "exceeds_record") {
    return "Withheld — the week reads at more than twice the average week of our own 90-day closure record.";
  }
  return "Withheld — the week's takedown count did not arrive as a number.";
}
