/**
 * WHICH ROWS "MORE ROLES AT {EMPLOYER}" MAY PRINT — pure, and apart from the
 * component so the posting page can decide whether to mount the section
 * without loading it (the section is lazy: it sits below the fold).
 *
 * A board token is not an employer. Two hiring systems can carry one token for
 * two companies (src/lib/board-collisions.ts), and every USAJOBS row shares
 * the token "usajobs" across hundreds of agencies, so a token-wide list is
 * one employer's roles only when neither is the case — and even then a row is
 * kept only when its hiring system and its printed employer are the posting's.
 */
import { postingPathParts } from "@/components/jobs/posting-page";
import { isCollidedToken } from "@/lib/board-collisions";
import { listingEmployer } from "./employer";
import type { ListingJob } from "./types";

/** The federal feed: one token for every agency, so a token-wide list is never one employer's. */
const USAJOBS_SOURCE = "usajobs";

/** Whether a token-wide list can be presented as one employer's roles at all. */
export function moreRolesAllowed(token: string | null | undefined, source: string | null | undefined): boolean {
  if (!token) return false;
  if (isCollidedToken(token)) return false;
  return source !== USAJOBS_SOURCE && token !== USAJOBS_SOURCE;
}

/** A row's hiring system: its own field, else the first segment of its id. */
function sourceOf(job: Pick<ListingJob, "id" | "source">): string | null {
  return job.source ?? postingPathParts(job.id)?.source ?? null;
}

/**
 * The rows that are this employer's, and whether the reply held anyone
 * else's. A row is kept only when its hiring system is the posting's and its
 * printed employer name is the posting's.
 */
export function sameEmployerRows(
  jobs: ListingJob[],
  posting: { source: string | null; employer: string; excludeId: string },
): { rows: ListingJob[]; mixed: boolean } {
  let mixed = false;
  const rows: ListingJob[] = [];
  for (const j of jobs) {
    if (!j || typeof j.id !== "string" || j.id === posting.excludeId) continue;
    const same = (!posting.source || sourceOf(j) === posting.source) && listingEmployer(j) === posting.employer;
    if (same) rows.push(j);
    else mixed = true;
  }
  return { rows, mixed };
}
