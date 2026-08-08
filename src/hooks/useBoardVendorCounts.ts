import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
          rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
        };
        const { data, error } = await sb.rpc("get_job_board_facets");
        if (!alive || error || !data || typeof data !== "object") return;

        const payload = data as {
          sourcesFacet?: Record<string, unknown>;
          openTotal?: unknown;
          as_of?: unknown;
        };

        // A cold cache returns sourcesFacet {} and openTotal null. That is not a
        // measurement, so it must not flip `ready` — an empty object would
        // otherwise render every vendor as blank while claiming to be current.
        const raw = payload.sourcesFacet;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;

        const counts: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) {
          // Only finite positive integers count. A malformed value is dropped
          // rather than coerced — Number(null) is 0, and a 0 here is precisely
          // the false claim this hook exists to prevent.
          const n = typeof v === "number" ? v : Number(v);
          if (Number.isFinite(n) && n > 0) counts[k] = Math.round(n);
        }
        if (Object.keys(counts).length === 0) return;

        const totalRaw = payload.openTotal;
        const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
        const asOfMs = Date.parse(String(payload.as_of ?? ""));

        setState({
          counts,
          openTotal: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
          asOf: Number.isFinite(asOfMs) ? new Date(asOfMs) : null,
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
