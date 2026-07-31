import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Is the apply agent's sender actually running right now?
 *
 * WHY THE MARKETING PAGES ASK THIS. The agent only sends applications while a
 * worker process is alive — it needs a real browser, so it lives outside the
 * edge functions and can be down while everything else is up. A pricing page
 * that describes unattended applying while nothing can send is charging for a
 * promise the product cannot keep that day.
 *
 * So the claim is rendered from the capability rather than from someone
 * remembering to edit a page. When this is false the surfaces fall back to what
 * is unambiguously true — applications prepared for one click.
 *
 * Starts as `false`, not `null`-then-true. The first paint must not flash a
 * claim we have not yet confirmed; showing less and then more is fine, showing
 * more and then retracting is not.
 */
export function useAgentSender(): { online: boolean; checked: boolean } {
  const [online, setOnline] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Cast because src/integrations/supabase/types.ts is generated and does
        // not know this RPC until its migration has applied and types are
        // regenerated. Until then the call returns an error, which this treats
        // as offline — the safe direction.
        const sb = supabase as unknown as {
          rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>;
        };
        const { data, error } = await sb.rpc("agent_sender_public_status");
        // Any error is treated as offline. The failure mode of guessing "on"
        // is a false advertisement; the failure mode of guessing "off" is a
        // page that undersells for a few seconds.
        if (alive) setOnline(!error && data === true);
      } catch {
        if (alive) setOnline(false);
      } finally {
        if (alive) setChecked(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { online, checked };
}
