/**
 * WHAT A DASHBOARD READ CUT SHORT LEFT OUT (S13-070; the review of audit-rest).
 *
 * get-analytics from 2026-11-03.1 reads newest first against a time budget and
 * says how far it got (coveredFrom, a moment or null). The build before it reads
 * oldest first to a 50,000-row cap and sends no coveredFrom, so there the newest
 * days are the ones cut. The merge publishes this page ahead of the function, so
 * for that gap the note has to name the other end.
 */
export function analyticsCutNote(audience: { coveredFrom?: string | null }): string {
  const { coveredFrom } = audience;
  if (coveredFrom === undefined) {
    return "Hit the 50,000-event read cap, which reads oldest first: the newest days are cut, and these counts are a FLOOR, not a total. Narrow the date range for exact figures.";
  }
  const read = coveredFrom ? ` (everything from ${coveredFrom.slice(0, 16).replace("T", " ")} UTC on was read)` : "";
  return `The read ran out of time before the oldest events${read}, so the earlier days are a FLOOR, not a total. New and returning visitors are approximate on every day, the fully read ones too: a visitor whose first visit fell in the unread part is counted as new on a later day, so returning is undercounted. Narrow the date range for exact figures.`;
}
