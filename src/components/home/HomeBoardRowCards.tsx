import { useLayoutEffect, type RefObject } from "react";
import { JobCard } from "@/components/jobs/listing/JobCard";
import type { ListingJob } from "@/lib/listing/types";
import { HOME_CARD_CONTEXT, homePostingHref, packRows } from "@/lib/home/list-box";

/**
 * THE HOMEPAGE'S POSTING CARDS, IN THEIR OWN CHUNK.
 *
 * The board's JobCard (with its menu module and the board's strings) is the
 * largest code on "/", about 48 KB gzip, and no row can render before the
 * job-board list answers, which the homepage asks for only after its first
 * paint (use-home-rows). So the cards load beside that call instead of ahead
 * of the first paint: HomeBoardRows imports this module once it has mounted
 * and keeps the reserved box, skeletons inside, until both the rows and the
 * cards are in (SEO round hand-off SEO-041: less JavaScript before "/" can
 * paint and respond).
 *
 * The cards carry no Check fit, no Save and no menu (review P12). They are
 * packed into the reserved box before the browser paints them.
 */
export interface HomeBoardRowCardsProps {
  rows: ListingJob[];
  listRef: RefObject<HTMLUListElement | null>;
  lng: string;
}

export function HomeBoardRowCards({ rows, listRef, lng }: HomeBoardRowCardsProps) {
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const pack = () => { packRows(ul); };
    pack();
    window.addEventListener("resize", pack);
    void document.fonts?.ready.then(pack).catch(() => {});
    return () => window.removeEventListener("resize", pack);
  }, [rows, lng, listRef]);

  return (
    <>
      {rows.map((job) => (
        <JobCard key={job.id} job={job} ctx={HOME_CARD_CONTEXT} href={homePostingHref(job)} />
      ))}
    </>
  );
}
