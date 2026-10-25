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
 * arrives at 23:59 does not read as yesterday's.
 */
export function listingAge(job: Pick<ListingJob, "id" | "source" | "postedAt">, now: Date = new Date()): ListingAge {
  if (!validIso(job.postedAt)) return { kind: "undated" };
  const day = postingDatePosted(job.postedAt, now);
  if (isRedatingSource(listingSource(job))) return { kind: "redated", day };
  const today = Date.parse(now.toISOString().slice(0, 10));
  const days = Math.max(0, Math.round((today - Date.parse(day)) / DAY_MS));
  return { kind: "dated", days, day };
}
