/**
 * IS THIS POSTING LIVE? THREE ANSWERS, AND "NO DATE" IS NOT ONE OF THE NO'S.
 *
 * The posting page asked posting-page.ts's isPostingLive, which is right for
 * the BAKE (a page is baked, with JobPosting markup, only for a dated posting
 * inside the board's window) and wrong for a PERSON: it answers false for
 * every posting the employer did not date, so the React page told 15 of the
 * audited live, undated postings (JL1, 2026-10-11) that they were "no longer
 * live" — retracted, noindexed — while the board served them and the employer
 * still listed them.
 *
 *   gone          the employer's feed stopped listing it (missingSince set);
 *   windowClosed  the employer states a date and it is past the board's
 *                 serving window — the page's existing retraction, wording
 *                 unchanged;
 *   live          everything else, the undated posting included.
 *
 * isPostingLive itself is not touched: the bake imports it, and an undated
 * live page still carries no structured data and keeps whatever crawl
 * directive its file shipped — whether to index those is the SEO group's
 * decision, not this module's.
 */
import { postingValidThrough, type PostingRow } from "@/components/jobs/posting-page";
import { listingTitle } from "./text";
import { dropUnbalancedParenSegments } from "./location";
import type { ListingJob } from "./types";

/**
 * The row as the posting page shows it AND describes it to crawlers: the title
 * decoded and cleaned (JL12 — an entity-encoded title reached the h1,
 * document.title and the JobPosting title as "&amp;"), and a location with any
 * part whose brackets do not balance left out (JL13), so half a bracket never
 * becomes a locality. The stored row is untouched; the bake's copy of both
 * fixes belongs to the SEO group.
 */
export function shownPosting<T extends PostingRow>(job: T): T {
  return {
    ...job,
    title: job.title ? listingTitle(job.title) : job.title,
    location: job.location ? dropUnbalancedParenSegments(job.location) : job.location,
  };
}

export type PostingLiveness = "live" | "windowClosed" | "gone";

export function postingLiveness(
  job: Pick<ListingJob, "id" | "postedAt" | "missingSince">,
  now: Date = new Date(),
): PostingLiveness {
  if (job.missingSince) return "gone";
  // A stamp that is not a date is no statement of one (and would throw in the
  // window arithmetic): it reads as undated, never as expired.
  if (typeof job.postedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(job.postedAt) && Number.isFinite(Date.parse(job.postedAt.slice(0, 10)))) {
    const through = postingValidThrough({ id: job.id, postedAt: job.postedAt, missingSince: null } as PostingRow);
    if (!through || through < now.toISOString().slice(0, 10)) return "windowClosed";
  }
  return "live";
}
