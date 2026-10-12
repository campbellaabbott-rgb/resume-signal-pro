/**
 * ONE POSTING, ONE EMPLOYER NAME, ON EVERY SURFACE.
 *
 * Read from the code on 823da0c4 (design spec, JL3): the card printed the
 * stored `company`, the pane's trust line the same string run through
 * companyDisplayName, and the posting page postingEmployer (the database's
 * name override plus the entity decode). So a Workday tenant stored by its
 * system code ("Ms" on ms~wd5~external) read "Morgan Stanley" on the posting
 * page and "Ms" on the card that linked to it.
 *
 * Every listing component asks THIS function, so there is one seam to change:
 * when the design-system pass lands src/lib/display-name.ts (displayEmployer:
 * "X | X" collapsed, "career website" stripped, generic board labels refused),
 * the body below becomes a call to it and nothing else moves.
 */
import { postingEmployer } from "@/components/jobs/posting-page";
import type { ListingJob } from "./types";

export function listingEmployer(job: Pick<ListingJob, "id" | "token" | "company">): string {
  return postingEmployer({ id: job.id, token: job.token ?? null, company: job.company ?? null });
}
