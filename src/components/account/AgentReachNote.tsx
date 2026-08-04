/**
 * WHAT THE AGENT CAN AND CANNOT REACH, said to the person paying for it.
 *
 * The agent auto-submits to four ATS vendors. Everything else — Workday alone
 * is over half the board — puts bot detection on the apply form, so the agent
 * prepares a kit and the candidate submits it. A subscriber who believes it
 * covers all 570,000 postings will conclude it is broken on their second day,
 * and they will be right to, because we let them believe it.
 *
 * The number is READ, not written here: `agent_reach()` counts the live board
 * against the vendor list the worker actually dispatches on, and a test pins
 * those two lists set-equal. Nothing on this surface is a constant that can
 * quietly go stale.
 *
 * It renders NOTHING on failure rather than a plausible-looking fallback. A
 * hardcoded "30,000+" that outlives the data it described is the exact failure
 * this component exists to prevent.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface Reach {
  drivable: number;
  board_total: number;
  vendors: string[];
}

export default function AgentReachNote() {
  const { t } = useTranslation();
  const [reach, setReach] = useState<Reach | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("agent_reach", { p_max_age_minutes: 360 });
        if (error || !data) return;
        const row = (Array.isArray(data) ? data[0] : data) as Reach | undefined;
        if (!row || !row.drivable || !row.board_total) return;
        if (live) setReach(row);
      } catch {
        /* silent: no number is honest, a made-up one is not */
      }
    })();
    return () => { live = false; };
  }, []);

  if (!reach) return null;

  const pct = (reach.drivable / reach.board_total) * 100;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <section className="rounded-xl border border-border bg-muted/30 p-5">
      <h3 className="text-sm font-semibold">
        {t("agent.reach.title", "Where the agent can apply for you")}
      </h3>

      <p className="mt-2 text-sm text-muted-foreground">
        {t("agent.reach.body", {
          defaultValue:
            "It submits automatically to {{drivable}} of the {{total}} postings on the board ({{pct}}%). " +
            "The rest put bot protection on their application form, so the agent prepares everything and you press submit.",
          drivable: fmt(reach.drivable),
          total: fmt(reach.board_total),
          pct: pct.toFixed(1),
        })}
      </p>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary"
          // Floored at 1% so a true-but-tiny share is still visible as a bar
          // rather than reading as zero coverage.
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {t("agent.reach.vendors", {
          defaultValue: "Auto-submits on: {{vendors}}. Counted from the live board, not an estimate.",
          vendors: reach.vendors.join(", "),
        })}
      </p>
    </section>
  );
}
