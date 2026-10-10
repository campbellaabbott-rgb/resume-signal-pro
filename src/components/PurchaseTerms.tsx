/**
 * THE LINES ABOVE A BUY OR SIGN-UP BUTTON (wave 3, payments-account;
 * commercial-readiness plan 2026-10-08 items 11, 12 and 14).
 *
 *   - "By continuing you agree to the Terms of Service and the Privacy
 *     Policy", with both linked: no button said it, so the Terms bound nobody.
 *     The version it names is what the button's call sends (purchaseTerms).
 *   - For a plan, that it renews every month until cancelled, and for the
 *     agent the first-time trial and how not to be charged: the subscribe
 *     buttons said neither.
 *   - While the EU/UK switch is on (off by default), the box the server
 *     requires before a checkout.
 *
 * Every number is interpolated from src/config (products, eu-consumer).
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUBSCRIPTIONS } from "@/config/products";
import { EU_UK_SALES_ON, WITHDRAWAL_DAYS } from "@/config/eu-consumer";
import { setPurchaseConsent, termsLineMounted, usePurchaseConsent } from "@/lib/purchase-terms";
import { cn } from "@/lib/utils";
import { SellerIdentity } from "@/components/SellerIdentity";

type Props = {
  /** What the button starts: a one-time payment, a plan, or a new account. */
  kind: "payment" | "subscription" | "signup";
  /** For a plan: which, so its renewal terms are named. */
  plan?: "pro" | "agent";
  className?: string;
};

/** Renders a translated sentence whose <terms>…</terms> and <privacy>…</privacy> spans become links. */
function AgreeLine({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /<(terms|privacy)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    // A new tab, so reading the Terms mid-purchase does not lose the page
    // (and a plain anchor needs no router: the line sits inside panels that
    // are mounted on their own).
    parts.push(
      <a key={m.index} href={m[1] === "terms" ? "/terms" : "/privacy"} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
        {m[2]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function PurchaseTerms({ kind, plan, className }: Props) {
  const { t } = useTranslation();
  const consent = usePurchaseConsent();
  // While this line is on screen, a press on a button in its block sends the
  // Terms version; it must sit in the same element as the buttons it covers.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => termsLineMounted(ref.current), []);
  const proPrice = `$${SUBSCRIPTIONS.pro.priceUsd}`;
  const agentPrice = `$${SUBSCRIPTIONS.agent.priceUsd}`;

  return (
    <div ref={ref} className={cn("space-y-1.5 text-xs text-muted-foreground", className)} data-testid="purchase-terms">
      {plan === "pro" && (
        <p>{t("purchaseTerms.renewal", { price: proPrice })}</p>
      )}
      {plan === "agent" && (
        <p>{t("purchaseTerms.agentTrial", { days: SUBSCRIPTIONS.agent.trialDays, price: agentPrice })}</p>
      )}
      {EU_UK_SALES_ON && kind !== "signup" && (
        <label className="flex items-start gap-2 text-left">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={kind === "payment" ? consent.withdrawalWaiver : consent.serviceStartConsent}
            onChange={(e) => setPurchaseConsent(kind === "payment" ? { withdrawalWaiver: e.target.checked } : { serviceStartConsent: e.target.checked })}
          />
          <span>
            {kind === "payment"
              ? t("purchaseTerms.waiver", { days: WITHDRAWAL_DAYS })
              : t("purchaseTerms.serviceStart", { days: WITHDRAWAL_DAYS })}
          </span>
        </label>
      )}
      <p><AgreeLine text={t("purchaseTerms.agree")} /></p>
      <SellerIdentity variant="soldBy" />
    </div>
  );
}
