// HOW FAR THE APPLY AGENT ACTUALLY REACHES, FROM THE DEPLOYED BUNDLE.
//
// Extracted from AgentReachNote on 2026-08-27, when the board's own pitch was
// found saying "It applies on four hiring systems — about 6% of the board"
// while SENDABLE_VENDORS held FIVE and the live figure was 8.2%. Both numbers
// were wrong, in all nine locales, on the page that sells the feature.
//
// A hardcoded count of something that grows is a claim with an expiry date
// nobody wrote down. Two surfaces stating it from two places is worse: they go
// stale independently, so the site contradicts itself. This hook is the one
// derivation both read.
//
// It returns null rather than a placeholder, and callers must render copy that
// needs no number in that case. A made-up figure is not a safer default than
// no figure.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** The shape job-board's `status` action returns under `sendable`. */
export interface Sendable {
  /** How many vendors the DEPLOYED bundle counted. A count, not a list. */
  vendors: number;
  postings: number;
  ofTotal: number;
  pct: number | null;
}

export function useAgentReach(): Sendable | null {
  const [reach, setReach] = useState<Sendable | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("job-board", {
          body: { action: "status" },
        });
        if (error) return;
        const s = (data as { sendable?: Sendable } | null)?.sendable;
        // Every field must be a real number. A partial payload rendering as
        // "0 of 0 (NaN%)" is worse than an absent panel.
        if (!s || !Number.isFinite(s.postings) || !Number.isFinite(s.ofTotal) || s.ofTotal <= 0) return;
        if (live) setReach(s);
      } catch {
        /* silent: no number is honest, a made-up one is not */
      }
    })();
    return () => { live = false; };
  }, []);

  return reach;
}

/** The percentage of the board the agent can submit on, from the same payload. */
export function reachPct(reach: Sendable): number {
  return reach.pct ?? (reach.postings / reach.ofTotal) * 100;
}
