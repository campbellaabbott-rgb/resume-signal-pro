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
 *   - "All sales are final.", above every payment and plan (homepage and
 *     pricing spec of 2026-10-17, "Before you buy": the before-audit found six
 *     paid entry points and none said it). The pricing page uses the same
 *     sentence in each language. One exception: while the EU/UK switch is on,
 *     a plan's block shows the service-start box instead, because
 *     withdraw-subscription refunds an EU or UK plan in full or pro rata and
 *     the box states those terms; an unqualified "final" would be false for
 *     the very buyers the switch admits. A payment keeps the sentence beside
 *     its box, in which the buyer gives up the withdrawal right.
 *   - While the EU/UK switch is off, one region line to every buyer: not sold
 *     in the EU, the EEA, the UK or India yet (S12-059; India by owner
 *     decision 2026-10-17), and that checkout turns buyers away by the
 *     currency and the time zone the device reports. Those are the checks
 *     that run without a key (the Full Analysis checkout reads both; Pro's
 *     reads the time zone). The address lookup runs only when its key is
 *     set, and whether it is set in production is unverified, so the line
 *     never names it (owner decision W5, 2026-10-24).
 *     ONE region statement per block: RegionNotice, which only a browser
 *     whose time zone is in the territory saw, no longer renders here,
 *     because the line covers every buyer, including one turned away by the
 *     currency whose time zone the notice could not place. (The Pro card
 *     still shows RegionNotice in place of its button to such a browser.)
 *   - For Pro, a separate, unticked box agreeing to the automatic renewal
 *     (owner decision 2026-10-17; California's automatic renewal law as
 *     amended by AB 2863). The server refuses a plan without it, and the card
 *     keeps its button disabled until it is ticked (onAutoRenewChange).
 *
 * Every number is interpolated from src/config (products, eu-consumer).
 */
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SUBSCRIPTIONS } from "@/config/products";
import { WITHDRAWAL_DAYS } from "@/config/eu-consumer";
import {
  askServerForEuUkSwitch, serverBoxWording, setPurchaseConsent, termsLineMounted, useEuUkBoxShown, usePurchaseConsent,
} from "@/lib/purchase-terms";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { SellerIdentity } from "@/components/SellerIdentity";

type Props = {
  /** What the button starts: a one-time payment, a plan, or a new account. */
  kind: "payment" | "subscription" | "signup";
  /** For a plan: which, so its renewal terms are named. */
  plan?: "pro" | "agent";
  className?: string;
  /** Told whenever Pro's renewal box changes, so the card can keep its button disabled until it is ticked. */
  onAutoRenewChange?: (ticked: boolean) => void;
  /**
   * For a block that says why a press with the renewal box empty started
   * nothing (the pricing page's Go Pro): the box is marked invalid and
   * described by that message's element while it shows.
   */
  autoRenewInvalid?: boolean;
  autoRenewErrorId?: string;
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

export function PurchaseTerms({ kind, plan, className, onAutoRenewChange, autoRenewInvalid = false, autoRenewErrorId }: Props) {
  const { t, i18n } = useTranslation();
  // The renewal box's label is bound to it by id as well as by nesting, so
  // every reader names the box by its sentence.
  const renewalBoxId = useId();
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
  // A purchase, not a sign-up: final, and (while EU and UK sales are off) not
  // sold in the territory, said to every buyer before the press. A plan under
  // the EU/UK switch is not final: its withdrawal box says what is refunded.
  const sale = kind !== "signup";
  const finalSale = sale && !(boxShown && kind === "subscription");
  // Written the reader's way, as the Go Pro button beside it writes it
  // ("45 $" in German), so one block never spells one price two ways.
  const proPrice = money(SUBSCRIPTIONS.pro.priceUsd, "USD", { lng: i18n.language });
  const agentPrice = `$${SUBSCRIPTIONS.agent.priceUsd}`;

  return (
    <div ref={ref} className={cn("space-y-1.5 text-xs text-muted-foreground", className)} data-testid="purchase-terms">
      {finalSale && <p data-final-sale="">{t("purchaseTerms.finalSale", "All sales are final.")}</p>}
      {sale && !boxShown && (
        <p data-region-line="">
          {t("purchaseTerms.regionLine", "Not sold in the EU, the EEA, the UK or India yet. Checkout turns away buyers it can place there, from the currency and the time zone your device reports.")}
        </p>
      )}
      {plan === "pro" && (
        <p>{t("purchaseTerms.renewal", { price: proPrice })}</p>
      )}
      {renewalBox && (
        <label htmlFor={renewalBoxId} className="flex min-h-6 cursor-pointer items-start gap-2 text-left coarse:min-h-11" data-auto-renew-box>
          <input
            id={renewalBoxId}
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            required
            aria-required="true"
            aria-invalid={autoRenewInvalid ? true : undefined}
            aria-describedby={autoRenewInvalid && autoRenewErrorId ? autoRenewErrorId : undefined}
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
