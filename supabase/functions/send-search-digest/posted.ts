/**
 * HOW OLD A POSTING IN THE DIGEST IS, BY THE BOARD'S OWN RULE (S14X-172,
 * S14X-252).
 *
 * The digest printed `Math.round` of the hours since the stamp, divided by 24,
 * so a date-only or midnight posting mailed at 14:23 UTC on its own day read
 * "posted yesterday" (0.6 of a day rounds up), and a posting from Breezy,
 * Paylocity or UKG, whose feed date moves when the employer edits it, read
 * "posted today" when it may be months old. The board's cards count whole
 * calendar days and print no age for those three systems
 * (src/lib/listing/age.ts); this is the same rule for a mail that runs with no
 * reader's clock in hand, so it counts UTC calendar days.
 *
 * Import-free on purpose: the Deno function and the Node tests both import it,
 * and a test pins REDATING_SOURCES to the board's list so the two cannot drift.
 */

/** Hiring systems whose feed date moves when a posting is edited (the board's list). */
export const REDATING_SOURCES: readonly string[] = ["breezy", "paylocity", "ukg"];

/** The system a posting was read from: its own source, else its id's first segment. */
export function postingSource(job: { id?: unknown; source?: unknown }): string | null {
  if (typeof job.source === "string" && job.source.trim()) return job.source.trim().toLowerCase();
  const head = typeof job.id === "string" ? job.id.split(":")[0] : "";
  return head ? head.toLowerCase() : null;
}

const DAY_MS = 86_400_000;

/**
 * Whole UTC calendar days from the day the stamp states to today, never
 * negative (an employer's "tomorrow" is today), or null when the posting may
 * print no age: no readable date, or a system that moves its date.
 */
export function postedDaysAgo(job: { id?: unknown; source?: unknown; postedAt?: unknown }, now: Date): number | null {
  const iso = job.postedAt;
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const stated = Date.parse(iso.slice(0, 10));
  if (!Number.isFinite(stated)) return null;
  const source = postingSource(job);
  if (source && REDATING_SOURCES.includes(source)) return null;
  const today = Date.parse(now.toISOString().slice(0, 10));
  return Math.max(0, Math.round((today - stated) / DAY_MS));
}
