/**
 * HOW OLD A POSTING IS, AND WHEN WE LAST READ ITS BOARD — the two times a
 * listing prints, and the rules that decide whether it may print them at all.
 *
 * A POSTING AGE IS THE EMPLOYER'S DATE OR NOTHING. first_seen is our discovery
 * stamp and it has been mass-reset more than once, so no listing surface
 * prints it in any form, hedged or not (the 2.8-day-median incident). An
 * undated posting prints no age.
 *
 * SOME SYSTEMS MOVE THE DATE. Measured in the job-listings audit (2026-10-11):
 * on Breezy, Paylocity and UKG the feed's date is rewritten when a posting is
 * edited, and 7 of 127 sampled cards from those systems showed an age up to
 * 248 days younger than the posting. Their date is printed as a FEED date with
 * the hedge beside it, and never as a "posted N days ago" age on a card.
 *
 * A FUTURE DATE READS TODAY. A date-only stamp from an APAC tenant is a future
 * UTC midnight for the western half of the world; the employer's "tomorrow" is,
 * for every honest purpose, today. The clamp is posting-page.ts's own, so the
 * card, the pane and the page's structured data agree on the day.
 *
 * THE READER'S OWN DAY (NB-22), when the caller names the reader's time zone.
 * Counted in UTC days, a card read in the evening in New York said "posted 1
 * day ago" of a posting inside the board's own "Today" filter. With a zone, a
 * full timestamp is turned into the reader's local date first, and a date-only
 * stamp (or an exact UTC midnight, which is how date-only feeds write one)
 * stays the calendar date the employer wrote; both are then counted against
 * the reader's local today, clamped the same way. Only today in local time
 * would be wrong: a 02:00Z posting would read "today" to a New York reader on
 * the evening before it, in their day, was posted. With no zone, or one this
 * runtime does not know, the count is the UTC one above, unchanged. Structured
 * data keeps posting-page.ts's UTC day.
 */
import { postingDatePosted } from "@/components/jobs/posting-page";
import type { ListingJob } from "./types";

/** Hiring systems whose feed date moves when a posting is edited (audit JL2). */
export const REDATING_SOURCES: readonly string[] = ["breezy", "paylocity", "ukg"];

export function isRedatingSource(source: string | null | undefined): boolean {
  return typeof source === "string" && REDATING_SOURCES.includes(source.trim().toLowerCase());
}

/** The source a posting was read from: its own column, else its id's first segment. */
export function listingSource(job: Pick<ListingJob, "id" | "source">): string | null {
  if (typeof job.source === "string" && job.source.trim()) return job.source.trim().toLowerCase();
  const head = typeof job.id === "string" ? job.id.split(":")[0] : "";
  return head ? head.toLowerCase() : null;
}

const DAY_MS = 86_400_000;
/** A date-only stamp, or an exact UTC midnight: the employer's calendar date, never shifted into a zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/;

/** The calendar day (YYYY-MM-DD) an instant falls on in an IANA time zone; null for a zone the runtime does not know. */
export function dayInZone(ms: number, timeZone: string): string | null {
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get("year"), m = get("month"), d = get("day");
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null;
  }
}
/** The reader's IANA time zone as this runtime reports it, or undefined: the argument a card passes to listingAge. */
export function readerTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone ? zone : undefined;
  } catch {
    return undefined;
  }
}
const validIso = (iso: string | null | undefined): iso is string =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) && Number.isFinite(Date.parse(iso.slice(0, 10)));

export type ListingAge =
  /** The employer's system states a date we can print as an age. */
  | { kind: "dated"; days: number; day: string }
  /** A date from a system that moves it: printed as a feed date, with the hedge. */
  | { kind: "redated"; day: string }
  /** No employer date: no age, no first-seen, nothing. */
  | { kind: "undated" };

/**
 * The age a listing may print. `days` counts whole UTC calendar days from the
 * clamped stated day to today, so "today" is never negative and a stamp that
 * arrives at 23:59 does not read as yesterday's. Given the reader's IANA
 * `timeZone`, it counts the reader's calendar days instead (NB-22, above).
 */
export function listingAge(job: Pick<ListingJob, "id" | "source" | "postedAt">, now: Date = new Date(), timeZone?: string): ListingAge {
  if (!validIso(job.postedAt)) return { kind: "undated" };
  if (timeZone) {
    const today = dayInZone(now.getTime(), timeZone);
    const stated = DATE_ONLY.test(job.postedAt) ? job.postedAt.slice(0, 10) : dayInZone(Date.parse(job.postedAt), timeZone);
    if (today && stated) {
      const local = stated > today ? today : stated;
      if (isRedatingSource(listingSource(job))) return { kind: "redated", day: local };
      const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(local)) / DAY_MS));
      return { kind: "dated", days, day: local };
    }
  }
  const day = postingDatePosted(job.postedAt, now);
  if (isRedatingSource(listingSource(job))) return { kind: "redated", day };
  const today = Date.parse(now.toISOString().slice(0, 10));
  const days = Math.max(0, Math.round((today - Date.parse(day)) / DAY_MS));
  return { kind: "dated", days, day };
}
