/**
 * THE BUY CONTROLS, AND WHAT STANDS IN FOR THEM WHILE A SALE IS CLOSED.
 *
 * A buy button renders only while its card's sale gates are open
 * (sale-gates.ts): the seller's name and address published (G1), and the
 * product's own delivery watched (G2, G2b). While a gate is closed, the card
 * says which in one sentence and renders no button at all.
 *
 * Beside every buy button, in the same block:
 *   - "All sales are final." and the region line, directly under the button;
 *   - for Pro, ABOVE the button, an unchecked, required box agreeing to the
 *     automatic renewal, kept apart from every other term (California's
 *     automatic renewal law as amended by AB 2863). Go Pro with the box empty
 *     starts nothing, says why, and moves focus to the box;
 *   - for Pro, the shared PurchaseTerms line (renewal, "By continuing you
 *     agree", the seller): it sits in the button's own block, which is how a
 *     press on this button carries the Terms version (src/lib/purchase-terms.ts).
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { SellerIdentity } from "@/components/SellerIdentity";
import { useAuth } from "@/contexts/AuthContext";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { isOwingStatus } from "@/config/subscription-status";
import { money } from "@/lib/format";
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "./plan-facts";
import { GATE_TEXT_KEY, type FullAnalysisClosedBy, type ProClosedBy, type SaleGates } from "./sale-gates";

/** The wording version of the renewal box; the server records it with the time (wave 4, G7). */
export const RENEWAL_CONSENT_VERSION = "2026-10-17";

export interface RenewalConsentRecord {
  renewalConsent: true;
  renewalConsentVersion: string;
  /** The sentence the buyer ticked, in the language they read it in. */
  renewalConsentText: string;
}

/** Furniture only the preview page passes: a label above each button and a stand-in for the seller line. */
export interface PreviewFurniture {
  label: ReactNode;
  sellerNote: ReactNode;
}

const BUY_BUTTON = "w-full min-h-11 justify-center text-center";

export function GateNote({ closedBy }: { closedBy: FullAnalysisClosedBy | ProClosedBy }) {
  const { t } = useTranslation();
  return (
    <p role="note" data-gate={closedBy} className="mt-5 rounded-md border border-dashed border-border-strong px-3 py-2.5 text-meta text-muted-foreground">
      {t(GATE_TEXT_KEY[closedBy])}
    </p>
  );
}

/** "All sales are final. Not sold in the EU, the EEA, the UK or India yet." Under every buy button. */
export function SaleTermsLine() {
  const { t } = useTranslation();
  return (
    <p className="mt-2.5 text-xs text-subtle-foreground" data-sale-terms="">
      <span data-final-sale="">{t("pricingPlans.buy.finalSale")}</span> <span data-region-line="">{t("pricingPlans.buy.region")}</span>
    </p>
  );
}

export function FullAnalysisBuy({ gates, preview }: { gates: SaleGates; preview?: PreviewFurniture }) {
  const { t, i18n } = useTranslation();
  if (!gates.fullAnalysis.onSale) return <GateNote closedBy={gates.fullAnalysis.closedBy ?? "seller"} />;
  const price = money(FULL_ANALYSIS_PRICE_USD, "USD", { lng: i18n.language });
  return (
    <div className="mt-5" data-buy-block="full-analysis">
      {preview?.label}
      <Button asChild variant="secondary" size="lg" wrap className={BUY_BUTTON}>
        {/* The upload comes first and the checkout after it, on the scanner page. */}
        <Link to="/resume-checker#upload" onClick={gates.previewOpen ? (e) => e.preventDefault() : undefined} data-buy="full-analysis">
          {t("pricingPlans.fa.cta", { price })}
        </Link>
      </Button>
      <SaleTermsLine />
      <p className="mt-1 text-xs text-subtle-foreground">{t("pricingPlans.fa.fine")}</p>
      {gates.seller ? (
        <SellerIdentity variant="soldBy" seller={gates.seller} className="mt-1 text-xs text-subtle-foreground" />
      ) : (
        preview?.sellerNote
      )}
    </div>
  );
}

export interface ProBuyBlockProps {
  gates: SaleGates;
  busy?: boolean;
  onGoPro: (consent: RenewalConsentRecord) => void;
  preview?: PreviewFurniture;
}

/** The renewal box, Go Pro, and the lines beside it. Presentational: the caller decides what Go Pro does. */
export function ProBuyBlock({ gates, busy = false, onGoPro, preview }: ProBuyBlockProps) {
  const { t, i18n } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const id = useId();
  const price = money(PRO_PRICE_USD, "USD", { lng: i18n.language });
  const consentText = t("pricingPlans.pro.consent", { price });

  const press = () => {
    if (!agreed) {
      setMissing(true);
      box.current?.focus();
      return;
    }
    onGoPro({ renewalConsent: true, renewalConsentVersion: RENEWAL_CONSENT_VERSION, renewalConsentText: consentText });
  };

  return (
    <div className="mt-5" data-buy-block="pro">
      {preview?.label}
      <div className="rounded-md border border-border bg-background px-3 py-2.5" data-renewal-consent="">
        <label htmlFor={`${id}-renew`} className="flex min-h-6 cursor-pointer items-start gap-2.5 text-sm text-foreground coarse:min-h-11">
          <input
            ref={box}
            id={`${id}-renew`}
            type="checkbox"
            required
            aria-required="true"
            aria-invalid={missing && !agreed ? true : undefined}
            aria-describedby={missing && !agreed ? `${id}-renew-err` : undefined}
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setMissing(false);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-sm border-border-strong accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <span>{consentText}</span>
        </label>
        {missing && !agreed ? (
          <p id={`${id}-renew-err`} role="alert" className="mt-2 text-meta text-destructive">
            {t("pricingPlans.pro.consentError")}
          </p>
        ) : null}
      </div>
      <Button type="button" variant="secondary" size="lg" wrap className={`mt-3 ${BUY_BUTTON}`} onClick={press} disabled={busy} data-buy="pro">
        {t("pricingPlans.pro.cta", { price })}
      </Button>
      <SaleTermsLine />
      <PurchaseTerms kind="subscription" plan="pro" className="mt-1 text-subtle-foreground" />
      {!gates.seller ? preview?.sellerNote : null}
      <p className="mt-1 text-xs text-subtle-foreground">{t("pricingPlans.pro.fine")}</p>
    </div>
  );
}

/**
 * Go Pro wired to the account: a member sees Manage, an account that owes a
 * payment sees Update payment (never a second subscription, platform sweep
 * L6-06), anyone else the buy block. Signed out, Go Pro goes to sign-in first.
 *
 * The renewal box's record is not sent yet: create-subscription-checkout
 * accepts it once wave 4 ships G7 (it refuses a checkout without it and
 * records the version and the time). Until then the box gates the press here.
 */
export function ProBuyConnected({ gates }: { gates: SaleGates }) {
  const { t } = useTranslation();
  const { pro, subscribe, manage, actionLoading } = useProSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (pro.active || isOwingStatus(pro.status)) {
    const owing = !pro.active;
    return (
      <div className="mt-5" data-pro-state={owing ? "owing" : "active"}>
        <p className="text-sm text-foreground">{t(owing ? "pricingPlans.pro.owing" : "pricingPlans.pro.memberActive")}</p>
        <Button type="button" variant="secondary" size="lg" wrap className={`mt-3 ${BUY_BUTTON}`} onClick={() => void manage()} disabled={actionLoading}>
          {t(owing ? "pricingPlans.pro.updatePayment" : "pricingPlans.pro.manage")}
        </Button>
      </div>
    );
  }

  return (
    <ProBuyBlock
      gates={gates}
      busy={actionLoading || (Boolean(user) && pro.loading)}
      onGoPro={() => {
        if (!user) {
          navigate(`/auth?next=${encodeURIComponent(`${location.pathname}${location.search}#pro`)}`);
          return;
        }
        void subscribe(user.email ?? undefined);
      }}
    />
  );
}

/** The Pro card's buy area: a gate note while closed, the inert preview block, or the wired one. */
export function ProBuy({ gates, preview, onPreviewPress }: { gates: SaleGates; preview?: PreviewFurniture; onPreviewPress?: () => void }) {
  if (!gates.pro.onSale) return <GateNote closedBy={gates.pro.closedBy ?? "seller"} />;
  if (gates.previewOpen) return <ProBuyBlock gates={gates} preview={preview} onGoPro={() => onPreviewPress?.()} />;
  return <ProBuyConnected gates={gates} />;
}
