import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseVendorCounts } from "@/lib/home/vendor-counts";

/**
 * Live per-vendor open-posting counts for the front page's platform wall.
 *
 * Served from the cached facets row, which is computed on a 15-minute timer.
 * It cannot be computed on the request path: measured today as anon, an exact
 * count for a single vendor returns 57014 (statement timeout) — for all fifteen
 * vendors, even through count_jobs_capped at its 10k cap, while a vendor that
 * matches nothing returns instantly. So the numbers arrive pre-computed or not
 * at all.
 *
 * ABSENCE IS NOT ZERO, and this hook exists mainly to keep that true.
 *
 * A vendor with no live postings is OMITTED from sourcesFacet rather than
 * carried as 0, so `counts[key]` is `undefined` in two very different cases:
 * the cache has not been computed, or that vendor genuinely has none today.
 * Both must render as "no number shown" — never as "Greenhouse 0", which is a
 * claim we would be making on a credibility surface without having measured it.
 * The component therefore reads `ready`, and shows names alone until it is true.
 *
 * This is the same shape as useAgentSender: start with the smaller claim, widen
 * only once confirmed. Showing less and then more is fine; showing a number and
 * then correcting it is not.
 */
export interface BoardVendorCounts {
  /** Per-source open counts. Missing key = not measured OR none — never 0. */
  counts: Record<string, number>;
  /** Sum over all sources under the same serving rule. */
  openTotal: number | null;
  /** When the counts were computed, for the "as of" line. */
  asOf: Date | null;
  /** True only when real counts are in hand. False = render names only. */
  ready: boolean;
}

export function useBoardVendorCounts(): BoardVendorCounts {
  const [state, setState] = useState<BoardVendorCounts>({
    counts: {},
    openTotal: null,
    asOf: null,
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Cast: types.ts is generated and types this RPC as `Json`.
        const sb = supabase as unknown as {
          rpc: (fn: string) => Promise<{ data: unknown; error: { code?: string } | null }>;
        };
        // SLIM READ FIRST. get_job_board_facets returns 1.6MB, of which this
        // hook reads ~600 bytes (sourcesFacet/openTotal/as_of) — and the wall
        // mounts twice per landing, so the wide read cost ~3.2MB per visitor.
        // get_board_vendor_counts is the same cached row minus companiesFacet.
        // The wide RPC stays as the fallback for the deploy window where the
        // frontend ships before the migration applies (PGRST202 = function
        // not found) — degraded to yesterday's cost, never to a blank wall.
        let { data, error } = await sb.rpc("get_board_vendor_counts");
        if (error?.code === "PGRST202") {
          ({ data, error } = await sb.rpc("get_job_board_facets"));
        }
        if (!alive || error || !data || typeof data !== "object") return;

        // One parser for this hook and the crawler bake (src/lib/home/vendor-counts.ts).
        const reading = parseVendorCounts(data);
        if (!reading) return;
        setState({
          counts: reading.counts,
          openTotal: reading.openTotal,
          asOf: reading.asOf ? new Date(reading.asOf) : null,
          ready: true,
        });
      } catch {
        /* Stay at ready:false — the component falls back to names alone. */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
