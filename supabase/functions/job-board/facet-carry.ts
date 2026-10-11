/**
 * WHEN CARRIED COUNTS WERE COUNTED (review of S11-001).
 *
 * When refresh_job_board_facets fails, the pass carries the previous row's
 * company, category and vendor counts forward and stamps the row with this
 * pass's refreshedAt. facetsCarriedAt was meant to say when those integers
 * were counted (the /explore sentence prints it as such), but it was written
 * as this pass's time too, on every carried pass, so nothing recorded how old
 * the served counts were, and the heartbeat's 3 h bound on refreshedAt stayed
 * green while the counts aged without limit (facets timed out for 4+ hours on
 * 2026-08-29).
 *
 * The counted time is the previous row's refreshedAt when that row was
 * counted fresh, and the previous row's own counted time when it was itself a
 * carry. A carried row written before this rule has no counted time; its
 * refreshedAt is the best bound there is.
 */
export function carriedCountsAt(prev: Record<string, unknown> | null | undefined): string | null {
  if (!prev) return null;
  const at = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return prev.facetsCarried ? at(prev.facetsCarriedAt) ?? at(prev.refreshedAt) : at(prev.refreshedAt);
}
