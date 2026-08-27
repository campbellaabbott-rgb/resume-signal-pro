/**
 * WHAT THE AGENT CAN AND CANNOT REACH, said to the person paying for it.
 *
 * The agent auto-submits to a handful of ATS vendors. Everything else — Workday
 * alone is over half the board — puts bot detection on the apply form, so the
 * agent prepares a kit and the candidate submits it. A subscriber who believes
 * it covers all 570,000 postings will conclude it is broken on their second
 * day, and they will be right to, because we let them believe it.
 *
 * THIS PANEL WAS INVISIBLE, AND HAD BEEN FOR A WHILE. It read the `agent_reach`
 * RPC, which returns `57014 statement timeout` on every call — measured
 * 2026-08-05, four calls, ~3.2s each, at every cache window. The mechanism is a
 * deadlock, and it is worth naming so nobody restores the old call:
 *
 *   - `agent_reach` serves a cache in job_board_meta, and the ONLY writer of
 *     that cache is its own slow path.
 *   - That path runs two full `count(*)` over ~590k job_board_postings rows.
 *   - Anon's statement timeout kills it at ~3s, so the cache INSERT never runs.
 *   - The cache stays empty, so every later call takes the slow path. Forever.
 *
 * The component then did exactly what it promises below — rendered nothing
 * rather than a made-up number — so the failure was completely silent. The
 * honest fallback hid a real outage of the surface it was protecting. That is
 * the lesson worth keeping: "fails closed" and "fails visibly" are different
 * properties, and this had only the first.
 *
 * THE NUMBER ALREADY EXISTED, CHEAPLY. job-board's `status` action computes
 * `sendable` from pre-aggregated per-vendor coverage instead of counting rows,
 * and it answers in normal time with real values. Reading that fixes the panel
 * with no migration and no SQL deploy.
 *
 * AND IT REMOVES A FOURTH COPY OF THE VENDOR LIST. `agent_reach` hardcoded
 * ARRAY['breezy','teamtailor','personio','pinpoint'] inside its SQL body, where
 * no test can see it — so an adapter landing would leave that list silently
 * stale while every other copy moved. `status.sendable` derives from
 * SENDABLE_VENDORS, which src/test/sendable-mirror.test.ts already pins to the
 * worker's actual adapters.
 *
 * It still renders NOTHING on failure rather than a plausible-looking fallback.
 * A hardcoded "30,000+" that outlives the data it described is the exact
 * failure this component exists to prevent.
 */
import { useTranslation } from "react-i18next";
import { useAgentReach, reachPct } from "@/hooks/use-agent-reach";
import { SENDABLE_VENDORS } from "../../../supabase/functions/_shared/apply-automation";


export default function AgentReachNote() {
  const { t } = useTranslation();
  // One derivation, shared with the board's own pitch copy — see the hook.
  const reach = useAgentReach();

  if (!reach) return null;

  const pct = reachPct(reach);
  const fmt = (n: number) => n.toLocaleString();

  /**
   * NAME THE VENDORS ONLY WHEN BOTH RUNTIMES AGREE ON HOW MANY THERE ARE.
   *
   * The count comes from the deployed edge bundle; the names come from this
   * app bundle's copy of the same constant. They deploy separately, so during
   * a partial rollout one can know about an adapter the other does not — and
   * naming four vendors beside a figure computed from five is a quiet lie
   * about which employers this actually covers. The figure is the part that
   * matters and is always shown; the names drop out when they cannot be
   * trusted to describe it.
   */
  const namesTrustworthy = reach.vendors === SENDABLE_VENDORS.length;

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
          drivable: fmt(reach.postings),
          total: fmt(reach.ofTotal),
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
        {namesTrustworthy
          ? t("agent.reach.vendors", {
              defaultValue: "Auto-submits on: {{vendors}}. Counted from the live board, not an estimate.",
              vendors: [...SENDABLE_VENDORS].join(", "),
            })
          : t("agent.reach.vendorsCount", {
              defaultValue: "Auto-submits on {{n}} application systems. Counted from the live board, not an estimate.",
              n: reach.vendors,
            })}
      </p>
    </section>
  );
}
