/**
 * The only sanctioned way this SPA can tell Google a URL is gone.
 *
 * WHY THIS EXISTS. GSC flagged "Soft 404" on 2026-08-07. The cause is
 * structural: Lovable static hosting serves HTTP 200 with the app shell for
 * EVERY path — there is no per-URL status code lever, no vercel.json, no
 * dynamic rendering (verified: Googlebot receives byte-identical HTML). So
 * when a /jobs?job=<id> deep link outlives its posting — ~16k postings/day age
 * out of the 30-day window, and ~27k were purged at once when their real dates
 * arrived — the URL renders a "no longer live" banner under a head that still
 * says index,follow. Google's classifier calls that a soft 404, and it is
 * right to.
 *
 * Of Google's three sanctioned expiry signals (404/410, noindex, past
 * validThrough), noindex is the only one a static SPA can emit per-URL — as a
 * render-time head mutation, which Google honors because it classifies after
 * JS execution. That is what this module does, symmetrically: pages mark and
 * unmark dead states as the user (or crawler) navigates, so the flag can never
 * leak onto a live view in the same session.
 */

const TAG_ID = "spa-dead-state-robots";

/** Mark the CURRENT URL as not-indexable (dead posting, unknown route). */
export function markDeadForRobots(title?: string): void {
  if (!document.getElementById(TAG_ID)) {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex";
    tag.id = TAG_ID;
    document.head.appendChild(tag);
  }
  if (title) document.title = title;
}

/** Remove the mark — the view under this URL is live content again. */
export function clearDeadForRobots(): void {
  document.getElementById(TAG_ID)?.remove();
}
