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
 * Every listing component asks THIS function, and since pass B its body is
 * the design system's displayEmployer (src/lib/display-name.ts): the name
 * override and the entity decode as before, plus "X | X" collapsed to one and
 * a trailing "career website" taken off. The token comes from the row, or from
 * the posting id when a row arrives without one, as postingEmployer read it.
 */
import { displayEmployer } from "@/lib/display-name";
import { postingPathParts } from "@/components/jobs/posting-page";
import type { ListingJob } from "./types";

export function listingEmployer(job: Pick<ListingJob, "id" | "token" | "company">): string {
  const token = job.token ?? postingPathParts(job.id)?.token ?? null;
  return displayEmployer(token, job.company ?? null).text;
}
