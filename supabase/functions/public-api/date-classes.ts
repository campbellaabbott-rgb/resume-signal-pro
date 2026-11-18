/**
 * HOW FAR A POSTING'S DATE CAN BE TRUSTED, BY THE SYSTEM THAT GAVE IT.
 *
 * A posting's age is the employer's date or nothing (the posting-age rule):
 * our own discovery stamp is never an age, hedged or not. This module turns
 * the employer's date into the age a check answer carries, and names the
 * class of date it is, because the hiring systems do not all mean the same
 * thing by it:
 *
 *   employer                 the date the employer's system states.
 *   employer_relative        Workday states "posted N days ago", which the
 *                            collector turns into a date: right to within
 *                            about a day, and never further back than its
 *                            own "30+ days" bucket.
 *   feed_date_moves_on_edit  Breezy, Paylocity and UKG rewrite the date when
 *                            a posting is edited (audit JL2, 2026-10-11:
 *                            7 of 127 cards up to 248 days younger than the
 *                            posting). The listing rule prints it as a feed
 *                            date and never as an age, so `days` is null.
 *   republish_moves_date     Ashby moves the date when the employer
 *                            republishes the same posting, under the same id.
 *   none                     no employer date: no age at all.
 *
 * THE SAME RULE AS THE LISTING. The set of date-moving systems is the
 * listing's REDATING_SOURCES (src/lib/listing/age.ts), copied here because an
 * edge function cannot import the page's code; a test holds the two equal and
 * holds `days` equal to the listing's own count. The day is the employer's
 * UTC calendar day, clamped to today (an employer's "tomorrow" reads today),
 * and `days` counts whole UTC days from it, exactly as a card counts them
 * when it is given no time zone.
 *
 * Pure and dependency-free, so the Node suite runs it as Deno does.
 */

export type DateClass = "employer" | "employer_relative" | "feed_date_moves_on_edit" | "republish_moves_date" | "none";

export const DATE_CLASSES: readonly DateClass[] = [
  "employer", "employer_relative", "feed_date_moves_on_edit", "republish_moves_date", "none",
];

/** Systems whose feed date moves when a posting is edited: the listing's REDATING_SOURCES. */
export const FEED_DATE_MOVES_ON_EDIT: readonly string[] = ["breezy", "paylocity", "ukg"];
/** Systems that state a posting's date as a count of days ago. */
export const EMPLOYER_RELATIVE: readonly string[] = ["workday"];
/** Systems that move the date when the same posting is republished. */
export const REPUBLISH_MOVES_DATE: readonly string[] = ["ashby"];

/** One sentence per class, said beside the date wherever an answer carries it. */
export const DATE_CLASS_NOTE: Record<DateClass, string> = {
  employer: "The date the employer's own hiring system gives this posting.",
  employer_relative:
    "The employer's hiring system gives this date as a number of days ago, so it is right to within about a day.",
  feed_date_moves_on_edit:
    "This hiring system rewrites the date whenever the posting is edited, so the posting can be older than its date; we give no age from it.",
  republish_moves_date:
    "This hiring system moves the date when the employer republishes the posting, so the posting can be older than its date.",
  none: "The employer's hiring system gives this posting no date, so we give no age.",
};

export interface PostingAge {
  /** The employer's stamp exactly as stored, or null. */
  postedAt: string | null;
  /** The employer's UTC calendar day, clamped to today; null when there is no date. */
  day: string | null;
  /** Whole UTC days from `day` to today; null when there is no date or the date moves on edit. */
  days: number | null;
  dateClass: DateClass;
  note: string;
}

const DAY_MS = 86_400_000;

const norm = (s: string | null | undefined): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

/** The source a posting id names: its first segment. */
export function sourceOfId(id: string | null | undefined): string | null {
  const head = typeof id === "string" ? id.split(":")[0] : "";
  return head ? head.trim().toLowerCase() : null;
}

/** A stamp the listing would read as a date: an ISO day that parses. */
const validIso = (iso: string | null | undefined): iso is string =>
  typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) && Number.isFinite(Date.parse(iso.slice(0, 10)));

/** The class of an employer date, from the system that stated it. */
export function dateClassOf(source: string | null | undefined, postedAt: string | null | undefined): DateClass {
  if (!validIso(postedAt)) return "none";
  const s = norm(source);
  if (FEED_DATE_MOVES_ON_EDIT.includes(s)) return "feed_date_moves_on_edit";
  if (EMPLOYER_RELATIVE.includes(s)) return "employer_relative";
  if (REPUBLISH_MOVES_DATE.includes(s)) return "republish_moves_date";
  return "employer";
}

/** The age a check answer may state: from the employer's date only. */
export function postingAge(source: string | null | undefined, postedAt: string | null | undefined, now: Date = new Date()): PostingAge {
  const dateClass = dateClassOf(source, postedAt);
  if (dateClass === "none" || !validIso(postedAt)) {
    return { postedAt: null, day: null, days: null, dateClass: "none", note: DATE_CLASS_NOTE.none };
  }
  const today = now.toISOString().slice(0, 10);
  const stated = postedAt.slice(0, 10);
  const day = stated > today ? today : stated;
  const days = dateClass === "feed_date_moves_on_edit"
    ? null
    : Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / DAY_MS));
  return { postedAt, day, days, dateClass, note: DATE_CLASS_NOTE[dateClass] };
}
