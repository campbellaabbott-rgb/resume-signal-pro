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
  /** Distinct employers, 0 when the light response omitted it. */
  companies: number;
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
        const d = data as { total?: number; companiesCount?: number } | null;
        const jobs = d?.total || 0;
        // Zero is not a total; it is a failed read. Leaving state null keeps
        // every caller on its no-number copy instead of publishing "0 jobs".
        if (jobs > 0) setTotals({ jobs, companies: d?.companiesCount ?? 0 });
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
