import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Check, Loader2, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SUBSCRIPTIONS } from "@/config/products";
import { AUTO_VENDORS, CLICK_VENDORS } from "@/config/ats-vendors";
import { useAgentSender } from "@/hooks/useAgentSender";

/**
 * The agent tier. Priced from SUBSCRIPTIONS, never a literal — src/test/
 * pricing-truth.test.ts reads the Deno checkout files and fails if the number
 * shown here drifts from the number charged.
 *
 * THE AUTO-APPLY CLAIM IS GATED. Everything about unattended sending renders
 * only when a worker is actually live. A page that says "it applies for you"
 * while nothing can send is the one thing a paid product must never do, and
 * copy — unlike the release logic — has no way to refuse with a reason.
 */
export function AgentSubscriptionCard({ email }: { email?: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const { online } = useAgentSender();
  const price = SUBSCRIPTIONS.agent.priceUsd;
  const proPrice = SUBSCRIPTIONS.pro.priceUsd;

  const subscribe = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-agent-checkout", {
        body: { email },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("no checkout url");
      window.location.href = url;
    } catch {
      toast.error(t("agentPlan.checkoutFailed", "Could not start checkout — please try again"));
      setLoading(false);
    }
  };

  return (
    <div className="relative rounded-2xl border-2 border-primary/40 bg-card p-6 md:p-8 shadow-lg">
      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">
        <Bot className="w-3 h-3 mr-1" />
        {t("agentPlan.badge", "Does the applying for you")}
      </Badge>

      <div className="flex items-start gap-4 mb-4 mt-2">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
          <Bot className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-xl">{t("agentPlan.name", "Apply Agent")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("agentPlan.tagline", "It finds the roles, fills in the application, and sends it.")}
          </p>
        </div>
      </div>

      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-4xl font-bold">${price}</span>
        <span className="text-muted-foreground">/{t("agentPlan.month", "month")}</span>
      </div>

      {/* The single most load-bearing line on the card: what you get for the
          difference between the two plans. */}
      <div className="mb-6 flex items-center gap-2 text-sm font-medium text-primary">
        <Crown className="w-4 h-4 flex-shrink-0" />
        {t("agentPlan.includesPro", "Includes everything in Pro (${{proPrice}}/mo)", { proPrice })}
      </div>

      <ul className="space-y-2 mb-6">
        {online && (
          <li className="flex items-start gap-2 text-sm">
            <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <span>
              {t("agentPlan.perkAutoApply", "Applies for you automatically on {{names}}", {
                names: AUTO_VENDORS.map((v) => v.label).join(", "),
              })}
            </span>
          </li>
        )}
        <li className="flex items-start gap-2 text-sm">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>
            {t("agentPlan.perkOneClick", "Applications filled in and ready to send on {{names}}", {
              names: CLICK_VENDORS.map((v) => v.label).join(", "),
            })}
          </span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{t("agentPlan.perkQueue", "A queue you can review first, or let it run unattended — your choice, changeable any time")}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{t("agentPlan.perkCap", "A daily limit you set, and it never applies to the same job twice")}</span>
        </li>
        <li className="flex items-start gap-2 text-sm">
          <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <span>{t("agentPlan.perkHonest", "It never invents an answer. If a question needs you, it stops and asks.")}</span>
        </li>
      </ul>

      <Button className="w-full gap-2" onClick={subscribe} disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
        {t("agentPlan.cta", "Start the agent")}
      </Button>

      <p className="mt-3 text-xs text-muted-foreground text-center">
        {online
          ? t("agentPlan.footnoteOnline", "Cancel any time. We never solve or bypass a CAPTCHA — where a site uses one, your application is prepared and you send it.")
          : t("agentPlan.footnoteOffline", "Cancel any time. Unattended sending is not running right now, so applications are prepared for you to send in one click.")}
      </p>
    </div>
  );
}
