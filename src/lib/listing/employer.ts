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
 *
 * THE BAKE'S NAME GATE DECIDES FIRST (SEO check 2026-11-15, F11). The baked
 * posting page judges its employer's name with scripts/prerender-names.mjs
 * (postingNameVerdict): a trailing career-site label comes off ("Inova
 * Military" is Inova), and a name that is nobody's (a logo caption such as
 * "Group withMVSB wtag", a web address, a tenant code) is not printed, so the
 * page says "the employer". The card, the pane and the hydrated posting page
 * printed the refused name all the same, so a reader saw "VHB Email
 * Signature" a moment after the crawler's copy had refused it. Here the same
 * verdict is asked: a refused name is the empty string (every surface already
 * prints no employer line, no link and no possessive for one), a repaired
 * name is the one printed.
 */
import { cleanBoardLabel } from "@/lib/display-name";
import { postingNameVerdict, postingPathParts } from "@/components/jobs/posting-page";
import type { ListingJob } from "./types";

export function listingEmployer(job: Pick<ListingJob, "id" | "token" | "company">): string {
  const token = job.token ?? postingPathParts(job.id)?.token ?? null;
  const verdict = postingNameVerdict({ id: job.id, token, company: job.company ?? null });
  if (verdict.reason) return "";
  return cleanBoardLabel(verdict.name);
}
