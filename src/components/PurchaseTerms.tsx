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
 *   - While it is off, to a browser whose time zone is in the EU, the EEA,
 *     the UK or India: that sales there wait for the tax registration
 *     (S12-059), so the buyer reads it beside every buy button before
 *     pressing, not after.
 *   - For Pro, a separate, unticked box agreeing to the automatic renewal
 *     (owner decision 2026-10-17; California's automatic renewal law as
 *     amended by AB 2863). The server refuses a plan without it, and the card
 *     keeps its button disabled until it is ticked (onAutoRenewChange).
 *
 * Every number is interpolated from src/config (products, eu-consumer).
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUBSCRIPTIONS } from "@/config/products";
import { WITHDRAWAL_DAYS } from "@/config/eu-consumer";
import {
  askServerForEuUkSwitch, serverBoxWording, setPurchaseConsent, termsLineMounted, useEuUkBoxShown, usePurchaseConsent,
} from "@/lib/purchase-terms";
import { cn } from "@/lib/utils";
import { SellerIdentity } from "@/components/SellerIdentity";
import { RegionNotice } from "@/components/checkout/RegionNotice";
import { inSalesTerritory } from "@/lib/checkout-territory";

type Props = {
  /** What the button starts: a one-time payment, a plan, or a new account. */
  kind: "payment" | "subscription" | "signup";
  /** For a plan: which, so its renewal terms are named. */
  plan?: "pro" | "agent";
  className?: string;
  /** Told whenever Pro's renewal box changes, so the card can keep its button disabled until it is ticked. */
  onAutoRenewChange?: (ticked: boolean) => void;
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

export function PurchaseTerms({ kind, plan, className, onAutoRenewChange }: Props) {
  const { t } = useTranslation();
  // While this line is on screen, a press on a button in its block sends the
  // Terms version; it must sit in the same element as the buttons it covers.
  // Its box is its own (S11-141).
  const ref = useRef<HTMLDivElement>(null);
  const consent = usePurchaseConsent(ref);
  useEffect(() => termsLineMounted(ref.current), []);
  const renewalBox = kind === "subscription" && plan === "pro";
  useEffect(() => { onAutoRenewChange?.(consent.autoRenewConsent); }, [consent.autoRenewConsent, onAutoRenewChange]);
  // The box shows when the server's switch is on, not only the build's (S11-142).
  const boxShown = useEuUkBoxShown();
  useEffect(() => { if (kind !== "signup") askServerForEuUkSwitch(); }, [kind]);
  const box = kind === "payment" ? "withdrawalWaiver" : "serviceStartConsent";
  // Not yet sold where this browser is (S12-059): said before the press.
  const regionRefused = kind !== "signup" && !boxShown && inSalesTerritory();
  const proPrice = `$${SUBSCRIPTIONS.pro.priceUsd}`;
  const agentPrice = `$${SUBSCRIPTIONS.agent.priceUsd}`;

  return (
    <div ref={ref} className={cn("space-y-1.5 text-xs text-muted-foreground", className)} data-testid="purchase-terms">
      {regionRefused && <RegionNotice className="text-left" />}
      {plan === "pro" && (
        <p>{t("purchaseTerms.renewal", { price: proPrice })}</p>
      )}
      {renewalBox && (
        <label className="flex items-start gap-2 text-left" data-auto-renew-box>
          <input
            type="checkbox"
            className="mt-0.5"
            required
            aria-required="true"
            checked={consent.autoRenewConsent}
            onChange={(e) => setPurchaseConsent(ref.current, { autoRenewConsent: e.target.checked })}
          />
          <span>
            {t("purchaseTerms.autoRenewConsent", "I agree that Pro renews automatically every month at {{price}} until I cancel, and that I can cancel any time from my account.", { price: proPrice })}
          </span>
        </label>
      )}
      {plan === "agent" && (
        <p>{t("purchaseTerms.agentTrial", { days: SUBSCRIPTIONS.agent.trialDays, price: agentPrice })}</p>
      )}
      {boxShown && kind !== "signup" && (
        <label className="flex items-start gap-2 text-left">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={consent[box]}
            onChange={(e) => setPurchaseConsent(ref.current, { [box]: e.target.checked })}
          />
          <span>
            {kind === "payment"
              ? t("purchaseTerms.waiver", { days: WITHDRAWAL_DAYS, defaultValue: serverBoxWording(box) })
              : t("purchaseTerms.serviceStart", { days: WITHDRAWAL_DAYS, defaultValue: serverBoxWording(box) })}
          </span>
        </label>
      )}
      <p><AgreeLine text={t("purchaseTerms.agree")} /></p>
      <SellerIdentity variant="soldBy" />
    </div>
  );
}
