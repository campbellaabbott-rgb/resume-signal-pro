/**
 * THE HOMEPAGE'S LIST, AS THE BOARD'S CARD READS IT.
 *
 * The card context is the board's own; the address is the posting's page.
 * packRows keeps the reserved list box (src/lib/home/rows.ts) from growing or
 * shrinking: it shows the leading rows that fit whole and hides the rest, and
 * runs in a layout effect, before the browser paints.
 */
import type { CardContext } from "@/components/jobs/listing/JobCard";
import { postingPagePath } from "@/components/jobs/posting-page";
import type { ListingJob } from "@/lib/listing/types";

export const HOME_CARD_CONTEXT: CardContext = { surface: "board", density: "comfortable", hideEmployer: false, selected: false };

export function homePostingHref(job: Pick<ListingJob, "id">): string {
  return postingPagePath(job.id) ?? `/jobs?job=${encodeURIComponent(job.id)}`;
}

/** Show the leading rows that fit whole inside the box's reserved height; always at least one. */
export function packRows(ul: HTMLElement): number {
  const items = Array.from(ul.children) as HTMLElement[];
  items.forEach((li) => { li.style.removeProperty("display"); });
  const limit = parseFloat(getComputedStyle(ul).minHeight);
  const top = ul.getBoundingClientRect().top;
  let shown = 0;
  for (const li of items) {
    const bottom = li.getBoundingClientRect().bottom - top;
    if (shown === 0 || !Number.isFinite(limit) || bottom <= limit + 0.5) shown += 1;
    else break;
  }
  items.forEach((li, i) => { if (i >= shown) li.style.display = "none"; });
  ul.setAttribute("data-home-rows-shown", String(shown));
  return shown;
}
