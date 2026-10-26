/**
 * THE HOMEPAGE'S LIST, AS THE BOARD'S CARD READS IT.
 *
 * The card context is the board's own; the address is the posting's page.
 * packRows keeps the reserved list box (src/lib/home/rows-box.ts) from
 * growing: it shows the leading rows that fit whole and hides the rest, gives
 * back the unused space only below the fold, and runs in a layout effect,
 * before the browser paints.
 */
import type { CardContext } from "@/components/jobs/listing/JobCard";
import { postingPagePath } from "@/components/jobs/posting-page";
import type { ListingJob } from "@/lib/listing/types";

export const HOME_CARD_CONTEXT: CardContext = { surface: "board", density: "comfortable", hideEmployer: false, selected: false };

export function homePostingHref(job: Pick<ListingJob, "id">): string {
  return postingPagePath(job.id) ?? `/jobs?job=${encodeURIComponent(job.id)}`;
}

/** The list's gap between rows (gap-2): a hole no bigger than this is just the gap. */
export const HOME_ROW_GAP_PX = 8;

/**
 * Show the leading rows that fit whole inside the box's reserved height
 * (always at least one), then give back the space no row uses when nobody can
 * see it move.
 *
 * THE HOLE (review round 2026-10-26). At the commonest phone widths three
 * rows fit and the fourth misses by a few pixels, which left 150-170 px of
 * blank box above the total line. When the box's bottom, shrunk to its last
 * row, is still at or below the fold, everything under the list is off screen
 * before and after the shrink, so nothing the reader can see moves (no layout
 * shift), and the box ends at its last row. When the reader can see the end
 * of the box (they scrolled before the rows came, or the list sits high on a
 * tall screen), the reserved box stays (review P24). Each pack starts from the
 * reserved box again, so a resize or the fonts landing re-measure it.
 */
export function packRows(ul: HTMLElement): number {
  const items = Array.from(ul.children) as HTMLElement[];
  items.forEach((li) => { li.style.removeProperty("display"); });
  ul.style.removeProperty("min-height");
  const limit = parseFloat(getComputedStyle(ul).minHeight);
  const top = ul.getBoundingClientRect().top;
  let shown = 0;
  let lastBottom = 0;
  for (const li of items) {
    const bottom = li.getBoundingClientRect().bottom - top;
    if (shown === 0 || !Number.isFinite(limit) || bottom <= limit + 0.5) {
      shown += 1;
      lastBottom = bottom;
    } else break;
  }
  items.forEach((li, i) => { if (i >= shown) li.style.display = "none"; });
  ul.setAttribute("data-home-rows-shown", String(shown));
  const viewport = ul.ownerDocument?.defaultView?.innerHeight ?? 0;
  if (Number.isFinite(limit) && limit - lastBottom > HOME_ROW_GAP_PX && viewport > 0 && top + lastBottom >= viewport) {
    ul.style.minHeight = `${Math.ceil(lastBottom)}px`;
  }
  return shown;
}
