import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Live scan totals from the corpus (all-time scans conducted + countries),
// via the aggregate-only get_scan_totals RPC. Fetched on mount, refreshed
// every 30s while the tab is visible, and immediately when a scan completes
// on the page (Index dispatches "scan-completed"). Returns null until real
// numbers arrive — no hardcoded or invented counts, ever.
//
// Extracted from Hero.tsx so /trust and /methodology can share ONE source.
// They previously printed a hardcoded "10,000+" for this same quantity while
// the homepage — using this hook — showed the real figure. On 2026-07-27 the
// RPC returned 1,052, so the trust page overstated it by ~9.5x. Any surface
// that wants to state how many resumes have been analysed must call this and
// must render nothing when it returns null.
export function useScanTotals() {
  const [totals, setTotals] = useState<{ total_scans: number; countries: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // When the RPC doesn't exist yet (migration not published), every visitor
    // would otherwise re-poll a guaranteed 404 every 30s for their whole
    // session — stop permanently on the first "function not found".
    let gone = false;
    const load = () => {
      if (document.hidden || gone) return;
      // RPC created in migration 20260706200000; not yet in generated client types.
      (supabase.rpc as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>)(
        "get_scan_totals"
      ).then(
        ({ data, error }) => {
          const err = error as { code?: string } | null;
          if (err?.code === "PGRST202") { gone = true; return; }
          const d = data as { total_scans?: number; countries?: number } | null;
          if (!cancelled && !error && typeof d?.total_scans === "number" && d.total_scans > 0) {
            setTotals({ total_scans: d.total_scans, countries: d.countries ?? 0 });
          }
        },
        () => {}
      );
    };
    load();
    // 5 minutes, not 30s: this is an ALL-TIME counter that moves by single
    // digits per hour, and every page mounting Hero/trust/methodology carried
    // the 30s cadence — 120 RPC calls/hour per open tab for a number whose
    // display doesn't change between polls. The scan-completed listener below
    // still refreshes instantly when this very tab finishes a scan, which is
    // the only movement a viewer can actually witness.
    const interval = setInterval(load, 300_000);
    window.addEventListener("scan-completed", load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("scan-completed", load);
    };
  }, []);

  return totals;
}
