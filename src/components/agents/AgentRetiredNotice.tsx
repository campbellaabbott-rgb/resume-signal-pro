/**
 * THE APPLY AGENT IS RETIRED, SAID WHERE IT USED TO BE SOLD OR RUN.
 *
 * Owner decision 2026-10-11 (the apply pivot): the Agent plan, the Agent Pass
 * and the Apply Assistant are no longer sold, and the server-side apply agent
 * is switched off (supabase/functions/_shared/apply-agent-switch.ts). The
 * signed-in console (/agent) and the Morning Queue panel still render for a
 * person who bought one before, and they carried a pass offer, a subscribe
 * button and a sentence about what the agent does every night. Where those
 * stood, this says what changed, that a past buyer is refunded or honoured,
 * and where the free path starts.
 *
 * The words are the retirement notice's own keys (agentPass.*, nine
 * locales), so the console, the panel and /agents/pass say one thing.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

/** Where a past buyer writes: the address /agents/pass names. */
export const AGENT_RETIRED_SUPPORT_EMAIL = "resumeboostersupp@gmail.com";

export function AgentRetiredNotice({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("rounded-xl border border-border bg-muted/40 p-4 text-[13px] text-muted-foreground", className)} data-agent-retired>
      <p>
        {t("agentPass.retiredBody", "We no longer sell the Agent Pass, the Agent plan or the Apply Assistant, and our own apply agent is switched off: Resume Booster does not send applications for anyone.")}
      </p>
      <p className="mt-2 flex items-start gap-2">
        <Mail className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden />
        <span>
          {t("agentPass.retiredBuyers", "Bought one before? We will refund it or honour it. Write to us from the address you paid with:")}{" "}
          <a href={`mailto:${AGENT_RETIRED_SUPPORT_EMAIL}`} className="text-primary hover:underline">{AGENT_RETIRED_SUPPORT_EMAIL}</a>
        </span>
      </p>
      <Link to="/agents" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        {t("agentPass.freePathCta", "Connect your AI")} <ArrowRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </div>
  );
}
