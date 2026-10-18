import { useState } from "react";
import { Crown, Check, Loader2, Sparkles, Settings2, CreditCard, Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { SUBSCRIPTIONS } from "@/config/products";
import { PRO_PERK_ITEMS, PRO_SUMMARY } from "@/config/pro-perks";
import { isOwingStatus } from "@/config/subscription-status";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { RegionNotice, useRegionRefused } from "@/components/checkout/RegionNotice";
import { PurchasesOpenSoon } from "@/components/checkout/PurchasesOpenSoon";
import { purchasesOpen } from "@/lib/purchases-open";

// What the plan includes lives in src/config/pro-perks.ts, where the pricing
// guards read it without mounting this card.

/** Where a subscriber writes when their plan is not linked to this account. */
export const PRO_SUPPORT_EMAIL = "resumeboostersupp@gmail.com";

/**
 * Resume Booster Pro card — the monthly plan. Shown on /pricing and /account.
 *
 * - A signed-out visitor is sent to sign in first and brought back: the
 *   checkout sells only to a signed-in account, and the plan lives on the
 *   account anyway.
 * - A plan that owes money (past_due and friends) shows "Update payment
 *   method", which opens the billing portal, never a second subscription
 *   (platform sweep L6-06).
 * - EVERY WORD IS TRANSLATABLE (S12-044): each string is t(key, English
 *   default); the perks carry their own keys (pro-perks.ts).
 * - A PLAN CANCELLED IN THE PORTAL SAYS "Ends <date>" (S12-076), not "Renews".
 * - THE RETIRED AGENT PLAN IS NOT SHOWN AS PRO (S12-168): an account whose
 *   standing rests on it sees that it is retired and how to cancel, never
 *   "$45/month ... Renews" or a prompt to pay for it.
 * - A buyer in the EU, the EEA, the UK or India sees why it is not sold
 *   there yet instead of a button the checkout would refuse (S12-059).
 * - WHAT PRO IS comes from one list (src/config/pro-perks.ts, owner decision
 *   2026-10-17), which the server's Stripe description reads too.
 * - NO BUY BUTTON WITHOUT A NAMED SELLER (owner decision 2026-10-17): until
 *   src/config/seller.ts carries the legal name and postal address, the card
 *   says purchases open soon instead of "Go Pro".
 * - A SEPARATE, UNTICKED RENEWAL BOX (California's automatic renewal law as
 *   amended by AB 2863): a signed-in buyer's "Go Pro" stays disabled until it
 *   is ticked, and the server refuses a plan without it.
 */
export function ProSubscriptionCard({ compact = false }: { compact?: boolean }) {
  const { pro, subscribe, manage, actionLoading, justSubscribed, notConfirmedYet } = useProSubscription();
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const regionRefused = useRegionRefused();
  const open = purchasesOpen();
  const [renewTicked, setRenewTicked] = useState(false);
  const price = SUBSCRIPTIONS.pro.priceUsd;
  const owing = isOwingStatus(pro.status);
  const retiredPlan = pro.planTier === "agent";
  const periodEnd = pro.currentPeriodEnd ? new Date(pro.currentPeriodEnd).toLocaleDateString() : null;

  const goPro = () => {
    if (!user) {
      navigate(`/auth?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
      return;
    }
    void subscribe(user.email ?? undefined);
  };

  const manageButton = (label: string, Icon: typeof Settings2, variant: "outline" | "default" = "outline") => (
    <Button variant={variant} className="w-full gap-2" onClick={manage} disabled={actionLoading}>
      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {label}
    </Button>
  );

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border-2 border-primary bg-card ring-2 ring-primary/20 shadow-xl",
        compact ? "p-5" : "p-6 md:p-8",
      )}
      data-pro-card
    >
      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">
        <Sparkles className="w-3 h-3 mr-1" />
        {t("proPlan.badge", "Writing tools")}
      </Badge>

      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-xl">{t("proPlan.title", "Resume Booster Pro")}</h3>
          <p className="text-sm text-muted-foreground">
            {t(PRO_SUMMARY.key, PRO_SUMMARY.text)}
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold">${price}</span>
        <span className="text-muted-foreground">{t("proPlan.perMonth", "/month")}</span>
      </div>

      {!compact && (
        <ul className="space-y-2 mb-6 flex-1">
          {PRO_PERK_ITEMS.map((perk) => (
            <li key={perk.key} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>{t(perk.key, perk.text)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* BACK FROM STRIPE (S8-055): the plan is confirmed out loud, or said
          to be confirming, never answered with a second "Go Pro". */}
      {justSubscribed && (
        <p role="status" className="mb-3 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium" data-testid="pro-welcome">
          {pro.active
            ? t("proPlan.confirmed", "Thank you: your Pro subscription is confirmed.")
            : t("proPlan.confirming", "Confirming your subscription with Stripe. This takes a few seconds.")}
        </p>
      )}
      {notConfirmedYet && (
        <p role="status" className="mb-3 rounded-md bg-muted px-3 py-2 text-sm" data-testid="pro-not-confirmed">
          {t("proPlan.notConfirmedYet")}
        </p>
      )}
      {retiredPlan ? (
        <div className="space-y-3" data-retired-plan>
          <p className="flex items-start gap-2 text-sm font-medium">
            <Archive className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            {t("proPlan.retiredPlanTitle", "Your plan is the Apply Agent plan, which we no longer sell.")}
          </p>
          <p className="text-sm text-muted-foreground">
            {owing
              ? t("proPlan.retiredPlanOwing", "Its last payment didn't go through. You don't need a card for a plan we no longer sell: cancel it in billing and the retries stop.")
              : pro.cancelAtPeriodEnd && periodEnd
                ? t("proPlan.retiredPlanEnds", "It ends on {{date}} and will not renew. Pro's tools stay on until then.", { date: periodEnd })
                : t("proPlan.retiredPlanLive", "While it runs, Pro's tools stay on. The agent itself is switched off; you can cancel the plan any time in billing.")}
          </p>
          {manageButton(t("proPlan.manageRetired", "Manage or cancel in billing"), Settings2)}
        </div>
      ) : pro.active ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-success">
            <Check className="w-4 h-4" />
            {/* A trial unlocks the plan's ongoing features and mints no paid
                one-off tool (the one rule, _shared/pro-standing.ts). */}
            {pro.trialing
              ? t("proPlan.trialingNoCap", "Your trial is on: scans have no daily cap now. The $5 Full Analysis is included from your first payment.")
              : t("proPlan.activeMember", "You're a Pro member: the writing tools are unlocked.")}
            {periodEnd && (
              <span className="text-muted-foreground font-normal" data-testid={pro.cancelAtPeriodEnd ? "pro-ends" : "pro-renews"}>
                {pro.cancelAtPeriodEnd
                  ? t("proPlan.endsOn", "Ends {{date}}: cancelled, it will not renew", { date: periodEnd })
                  : t("proPlan.renewsOn", "Renews {{date}}", { date: periodEnd })}
              </span>
            )}
          </div>
          {manageButton(t("proPlan.manage", "Manage subscription"), Settings2)}
        </div>
      ) : owing ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-destructive">
            {t("proPlan.owing", "Your last payment didn't go through. Update your card to keep your plan — no new subscription needed.")}
          </p>
          {manageButton(t("proPlan.updatePayment", "Update payment method"), CreditCard, "default")}
        </div>
      ) : regionRefused ? (
        <RegionNotice />
      ) : !open ? (
        <div className="space-y-3">
          {pro.linkPending && (
            <p className="text-sm text-muted-foreground">
              {t("proPlan.linkPendingUnlinked", "This address has a plan that isn't linked to this account yet. Email {{support}} from that address and we will link it.", { support: PRO_SUPPORT_EMAIL })}
            </p>
          )}
          <PurchasesOpenSoon />
        </div>
      ) : (
        <div className="space-y-3">
          {pro.linkPending && (
            <p className="text-sm text-muted-foreground">
              {t("proPlan.linkPendingUnlinked", "This address has a plan that isn't linked to this account yet. Email {{support}} from that address and we will link it.", { support: PRO_SUPPORT_EMAIL })}
            </p>
          )}
          <PurchaseTerms kind="subscription" plan="pro" className="text-center" onAutoRenewChange={setRenewTicked} />
          <Button
            className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30"
            onClick={goPro}
            disabled={actionLoading || (Boolean(user) && pro.loading) || (justSubscribed && !pro.active) || (Boolean(user) && !renewTicked)}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            {t("proPlan.goPro", "Go Pro — ${{price}}/month", { price })}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {user
              ? t("proPlan.secureSignedIn", "Secure checkout via Stripe. Cancel anytime — no lock-in.")
              : t("proPlan.secureSignedOut", "You'll sign in first, so the plan is on your account. Secure checkout via Stripe; cancel anytime.")}
          </p>
        </div>
      )}
    </div>
  );
}
