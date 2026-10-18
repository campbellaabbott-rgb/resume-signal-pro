/**
 * WHICH LIVE POSTINGS THE HOMEPAGE MAY SHOW, AND WHICH READ TIME EACH MAY CARRY.
 *
 * The homepage prints a handful of the board's newest postings with the
 * board's own card (JobCard). It may only print what the board itself would
 * print, so every rule here is the board's rule, applied before a row reaches
 * the card:
 *
 *   - THE AGE IS THE EMPLOYER'S DATE, AND IT IS FIXED. A row with no date the
 *     employer's system states, or one from a system that moves its date when
 *     a posting is edited (REDATING_SOURCES in src/lib/listing/age.ts), never
 *     reaches the homepage: the section says "posted in the last 7 days" and
 *     those rows cannot keep that promise (review P4).
 *   - GONE IS GONE. A row with missingSince is not shown.
 *   - AGENCY BOARDS stay on the board, labelled; the homepage asks the list
 *     call to leave them out and drops any that come back anyway.
 *   - ONE ROW PER EMPLOYER, so five rows show five employers.
 *   - THE FEED-READ STAMP IS SAID ONLY OF A BOARD WE READ IN FULL. JobCard
 *     prints any recheckedAt it is handed, so the gate sits here, in the
 *     caller, exactly as Jobs.tsx gates it: the row keeps its read time only
 *     where feedReadStatable passes on the employer's fill-curve row, and a
 *     row whose curve has not answered carries no stamp (review P2).
 */
import { feedReadStatable } from "@/lib/hiring-record-gate";
import { isRedatingSource, listingAge, listingSource } from "@/lib/listing/age";
import { listingEmployer } from "@/lib/listing/employer";
import type { ListingJob } from "@/lib/listing/types";

/** How far back "posted in the last 7 days" reaches, in whole UTC days. */
export const HOME_ROWS_WINDOW_DAYS = 7;
/** Rows kept: at most five; the list shows as many whole rows as fit its reserved box. */
export const HOME_ROWS_MAX = 5;
/**
 * THE RESERVED LIST BOX (review P24). Its height is fixed before any row
 * arrives and never changes: rows are packed into it and a row that would not
 * fit whole is not shown, so the box can neither grow nor shrink when the
 * list lands, and nothing below it moves.
 *
 * Under 640px: three rows of the tallest card the corrected spec measured at
 * 375px (175px, here 11rem). From 640px: five rows of 7.5rem, measured over
 * 177 live rows on 2026-10-18 (median card 106px from 768px; 90th percentile
 * 132 to 150px), so five rows fit in the usual case and four in a tall one.
 */
export const HOME_ROWS_PHONE = 3;
export const HOME_LIST_BOX_PHONE_REM = HOME_ROWS_PHONE * 11 + (HOME_ROWS_PHONE - 1) * 0.5;
export const HOME_LIST_BOX_WIDE_REM = HOME_ROWS_MAX * 7.5 + (HOME_ROWS_MAX - 1) * 0.5;

/** The one list call the homepage makes (corrected spec 4.2, step 1). */
export const HOME_LIST_BODY = {
  action: "list",
  sort: "newest",
  maxAgeDays: HOME_ROWS_WINDOW_DAYS,
  excludeAgencies: true,
  includeFacets: false,
  limit: 40,
} as const;

/** The columns of a get_company_fill_curve row the gate reads. */
export interface FeedReadCurveRow {
  company_token?: string | null;
  observability_bucket?: string | null;
  feed_state?: string | null;
}

const employerKey = (job: ListingJob): string[] => {
  const keys: string[] = [];
  if (typeof job.token === "string" && job.token.trim()) keys.push(`t:${job.token.trim().toLowerCase()}`);
  const name = listingEmployer(job).trim().toLowerCase();
  if (name) keys.push(`n:${name}`);
  return keys;
};

/**
 * The rows the homepage may print, newest first as the board sent them.
 * Pure: the same reply and the same clock always keep the same rows.
 */
export function selectHomeRows(
  jobs: readonly ListingJob[] | null | undefined,
  opts: { max?: number; now?: Date } = {},
): ListingJob[] {
  const max = opts.max ?? HOME_ROWS_MAX;
  const now = opts.now ?? new Date();
  const seen = new Set<string>();
  const kept: ListingJob[] = [];
  for (const job of jobs ?? []) {
    if (kept.length >= max) break;
    if (!job || typeof job.id !== "string" || !job.id) continue;
    if (typeof job.title !== "string" || !job.title.trim()) continue;
    if (job.missingSince) continue;
    if (job.agency === true) continue;
    if (isRedatingSource(listingSource(job))) continue;
    const age = listingAge(job, now);
    if (age.kind !== "dated" || age.days > HOME_ROWS_WINDOW_DAYS) continue;
    const keys = employerKey(job);
    if (keys.length === 0 || keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    kept.push(job);
  }
  return kept;
}

/** The distinct board tokens of the kept rows: the one fill-curve call asks for these. */
export function curveTokens(rows: readonly ListingJob[]): string[] {
  return [...new Set(rows.map((r) => (typeof r.token === "string" ? r.token.trim() : "")).filter(Boolean))];
}

/**
 * Each row with the read time it may print: the board's recheckedAt where the
 * employer's fill-curve row says we read that board in full, else null. A
 * null or failed curve leaves every row without a stamp.
 */
export function applyFeedReadGate(
  rows: readonly ListingJob[],
  curve: readonly FeedReadCurveRow[] | null | undefined,
): ListingJob[] {
  const byToken = new Map<string, FeedReadCurveRow>();
  for (const row of curve ?? []) {
    if (row && typeof row.company_token === "string") byToken.set(row.company_token, row);
  }
  return rows.map((job) => {
    const row = typeof job.token === "string" ? byToken.get(job.token) : undefined;
    return { ...job, recheckedAt: feedReadStatable(row) ? job.recheckedAt ?? null : null };
  });
}

/** Every row with no read time: what the list shows when the curve never answers. */
export function withoutFeedRead(rows: readonly ListingJob[]): ListingJob[] {
  return rows.map((job) => ({ ...job, recheckedAt: null }));
}
