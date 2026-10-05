import { Crown, Check, Loader2, Sparkles, Settings2, CreditCard } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { SUBSCRIPTIONS } from "@/config/products";
import { isOwingStatus } from "@/config/subscription-status";

// Every line is a shipped, factual capability OF THIS PLAN. The Morning Queue
// line that used to lead this list is the agent plan's (its entitlement is
// price-specific: _shared/agent.ts refuses the Pro price), so a Pro buyer met the
// agent's paywall on /agent after being sold it here (platform sweep L3-04).
// It is described on the agent card beside this one. Whether the Full
// Analysis belongs in Pro is an open owner decision (the $5 checkout still
// charges a Pro member), recorded in the payments wave report.
const PRO_PERKS = [
  "Batch application prep — tailored answers drafted for every saved job at once (you always hit send yourself)",
  "Unlimited scans — tailor a resume version to every job you apply to",
  "Track every application against the exact resume version you sent",
  "See which of your resume versions actually lands interviews",
  "Every paid tool included — Full Analysis, Keyword Fix, Cover Letters, Interview Coach, and all future tools, automatically",
  "Cancel anytime from your account",
];

/**
 * Resume Booster Pro card — the monthly all-access plan. Shown on /pricing and
 * /account.
 *
 * - A signed-out visitor is sent to sign in first and brought back: the
 *   checkout sells only to a signed-in account (2026-10-04 completeness
 *   review: it used to answer, for any address in the request, whether that
 *   address subscribed), and the plan lives on the account anyway.
 * - A plan that owes money (past_due and friends) shows "Update payment
 *   method", which opens the billing portal. It used to show "Go Pro", and the
 *   checkout then sold a second subscription that billed beside the first once
 *   Stripe's retry succeeded (platform sweep L6-06).
 */
export function ProSubscriptionCard({ compact = false }: { compact?: boolean }) {
  const { pro, subscribe, manage, actionLoading } = useProSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const price = SUBSCRIPTIONS.pro.priceUsd;
  const owing = isOwingStatus(pro.status);

  const goPro = () => {
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    void subscribe(user.email ?? undefined);
  };

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border-2 border-primary bg-card ring-2 ring-primary/20 shadow-xl",
        compact ? "p-5" : "p-6 md:p-8",
      )}
    >
      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">
        <Sparkles className="w-3 h-3 mr-1" />
        All-access
      </Badge>

      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-xl">Resume Booster Pro</h3>
          <p className="text-sm text-muted-foreground">
            Your whole job search in one workspace — plus every tool we make, now and future, included.
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold">${price}</span>
        <span className="text-muted-foreground">/month</span>
      </div>

      {!compact && (
        <ul className="space-y-2 mb-6 flex-1">
          {PRO_PERKS.map((perk) => (
            <li key={perk} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      )}

      {pro.active ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="w-4 h-4" />
            You're a Pro member — every tool is unlocked.
            {pro.currentPeriodEnd && (
              <span className="text-muted-foreground font-normal">
                Renews {new Date(pro.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={manage} disabled={actionLoading}>
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
            Manage subscription
          </Button>
        </div>
      ) : owing ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-destructive">
            Your last payment didn't go through. Update your card to keep your plan — no new subscription needed.
          </p>
          <Button className="w-full gap-2" onClick={manage} disabled={actionLoading}>
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Update payment method
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30"
            onClick={goPro}
            disabled={actionLoading || (Boolean(user) && pro.loading)}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            Go Pro — ${price}/month
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {user
              ? "Secure checkout via Stripe. Cancel anytime — no lock-in."
              : "You'll sign in first, so the plan is on your account. Secure checkout via Stripe; cancel anytime."}
          </p>
        </div>
      )}
    </div>
  );
}
