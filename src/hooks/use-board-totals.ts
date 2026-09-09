// THE BOARD'S OWN COUNT, FOR ANY SURFACE THAT WANTS TO STATE IT.
//
// Extracted from JobBoardHero on 2026-08-13, when the homepage was found
// advertising "550,000+ verified openings" against a live board serving
// 603,904 — in the headline, in a CTA, and in the document <title>. The claim
// was never false (there are indeed more than 550,000) but it was frozen: it
// understated the product by ~54,000 roles and would keep drifting, in the one
// direction that makes the board look smaller than it is.
//
// A number a component hardcodes is a number that stops being true on its own
// schedule. This hook is the alternative, and it deliberately returns null
// rather than a placeholder: a surface that cannot get the count must say
// something that needs no count, never a stale one.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BoardTotals {
  /** Served openings — the same read-filtered count /jobs shows. */
  jobs: number;
  /**
   * DISTINCT COMPANY JOB BOARDS WITH AT LEAST ONE OPEN POSTING. Null when the
   * board could not state it.
   *
   * This field used to be documented as "Distinct employers" and carried
   * companiesCount — the length of the board's UNFILTERED company_token
   * grouping. It was wrong twice over, and both errors pushed the same way.
   *
   *   1. UNFILTERED. That grouping deliberately applies neither serving
   *      predicate, because the refresh pass uses it to drive an orphan prune
   *      that DELETES postings (migration 20260825190000). It therefore counts
   *      boards whose every posting has been withdrawn or has aged past the
   *      30-day window — and it was rendered in one sentence beside `jobs`,
   *      which applies both. A serving-filtered numerator over an unfiltered
   *      denominator is not a ratio anyone can act on.
   *   2. NOT EMPLOYERS. A token is one board. One employer can run several:
   *      clusters.ts records 76 employers inside the top 1,500 alone (PwC
   *      ships five Workday sub-sites), and the display-name merge that folds
   *      them happens after this count. So this is an exact count of boards
   *      and a FLOOR on employers, and the copy must say "company job boards".
   *
   * Null, never 0, when the response omitted it: 0 would read as "no board is
   * hiring", which is a claim, and callers drop the clause on null.
   */
  feeds: number | null;
  /**
   * The TRACKED corpus — every posting the board has a record of, including
   * ones it has since watched close. Null when the response omitted it.
   *
   * A SECOND TRUE NUMBER, NOT A BIGGER VERSION OF THE FIRST. `jobs` is what a
   * visitor can page to right now; `tracked` is what the board has observed.
   * They are 560,321 and 678,957 today. Any surface that states one MUST name
   * which — the homepage spent its life claiming the tracked figure under the
   * words "Verified Openings", which is the servable noun.
   */
  tracked: number | null;
}

/**
 * Live board totals, or null until (and unless) they arrive.
 *
 * `includeFacets: false` is load-bearing: the light response carries both
 * numbers at ~1,751 bytes against ~100,935 with facets on — a 58x cut on every
 * homepage view. Measured 2026-08-10.
 *
 * Uses `total` (the read-filtered ≤30-day count the board actually serves) and
 * never `totalAllCompanies`, which still counts aged rows the read filter
 * hides — that difference is how a homepage headline drifts away from the page
 * it links to.
 */
export function useBoardTotals(): BoardTotals | null {
  const [totals, setTotals] = useState<BoardTotals | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("job-board", { body: { action: "list", limit: 1, includeFacets: false } })
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as { total?: number; companiesOpenCount?: number; trackedTotal?: number } | null;
        const jobs = d?.total || 0;
        // Zero is not a total; it is a failed read. Leaving state null keeps
        // every caller on its no-number copy instead of publishing "0 jobs".
        // Same rule for tracked as for jobs: zero is a failed read, not a
        // total, and null keeps every caller on copy that needs no number.
        const tracked = typeof d?.trackedTotal === "number" && d.trackedTotal > 0 ? d.trackedTotal : null;
        // Same rule as `jobs` and `tracked`: absent or zero is a failed read,
        // not a measurement, and null keeps every caller on copy that needs no
        // number. companiesCount is NOT an acceptable fallback here — it is
        // the unfiltered grouping this field was fixed to stop publishing.
        const feeds = typeof d?.companiesOpenCount === "number" && d.companiesOpenCount > 0 ? d.companiesOpenCount : null;
        if (jobs > 0) setTotals({ jobs, feeds, tracked });
      })
      .catch(() => { /* callers render their count-free variant */ });
    return () => { cancelled = true; };
  }, []);
  return totals;
}

/** Rounded DOWN to the nearest 10k for display: "610,000+" from 613,737.
 *  Down, never nearest — a rounded-up figure claims roles that do not exist,
 *  and the "+" only reads as honest when the number under it is a floor. */
export function roundedFloor(n: number, step = 10_000): number {
  return Math.max(step, Math.floor(n / step) * step);
}
