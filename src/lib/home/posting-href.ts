/**
 * THE TWO FACTS "/" NEEDS FROM THE POSTING PAGE'S MODULE, COPIED (review
 * round of 2026-10-26).
 *
 * src/components/jobs/posting-page.ts is about 11.9 kB gzip, and the homepage
 * used one constant and one short function of it, which put all of it in the
 * static closure of "/" (11 kB more than it needs; README, the review round).
 * The owner retired step 15's JavaScript cap on 2026-10-27, and the copies
 * still keep that module out of "/". These are copies;
 * src/test/hp-fix-the-homepage-loads-no-posting-page-module.test.ts holds each
 * equal to the original and fails on a homepage module that imports it.
 */

/** The board's serving window (posting-page.ts BOARD_FRESH_WINDOW_DAYS). */
export const HOME_BOARD_FRESH_WINDOW_DAYS = 30;

const SEGMENT = /^[A-Za-z0-9._~@=+-]+$/;

/** A posting's page path (posting-page.ts postingPagePath), or null when its id cannot be one. */
export function homePostingPath(id: string): string | null {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const [source, token, key] = parts;
  if (!SEGMENT.test(source) || !SEGMENT.test(token) || !SEGMENT.test(key)) return null;
  const path = `/jobs/posting/${source}/${token}/${key}`;
  return key.includes(".") ? `${path}/` : path;
}
