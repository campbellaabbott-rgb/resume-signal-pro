/**
 * THE BUY CONTROLS, AND WHAT STANDS IN FOR THEM WHILE A SALE IS CLOSED.
 *
 * A buy button renders only while its card's sale gates are open
 * (sale-gates.ts): the seller's name and address published (G1), and the
 * product's own delivery watched (G2, G2b). While a gate is closed, the card
 * says which in one sentence and renders no button at all.
 *
 * Beside every buy button, in the same block:
 *   - "All sales are final." and the region line: for the Full Analysis
 *     directly under its link (SaleTermsLine), for Pro in the shared
 *     PurchaseTerms block above Go Pro, in the same words
 *     (purchaseTerms.finalSale, purchaseTerms.regionLine);
 *   - for the Full Analysis, how its price is charged: listed in US dollars,
 *     charged at about that value in the currency of the device's time zone
 *     when the scanner page's hook recognizes the zone and create-checkout
 *     supports its currency, else in US dollars (owner decision 2026-10-25);
 *   - for Pro, ABOVE the button, PurchaseTerms (renewal, "By continuing you
 *     agree", the seller) with its own unchecked, required box agreeing to
 *     the automatic renewal, kept apart from every other term (California's
 *     automatic renewal law as amended by AB 2863). It sits in the button's
 *     block, which is how a press on this button carries the Terms version
 *     and the renewal consent (src/lib/purchase-terms.ts): purchaseTerms()
 *     sends autoRenewConsent only when that box was ticked, and
 *     create-subscription-checkout refuses a plan without it and records
 *     AUTO_RENEW_CONSENT_VERSION with the time. Go Pro with the box empty
 *     starts nothing, says why, marks the box invalid and moves focus to it
 *     (switch-over step 8: the page's own stand-in box is gone).
 */
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n/pricing-strings";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { SellerIdentity } from "@/components/SellerIdentity";
import { RegionNotice, useRegionRefused } from "@/components/checkout/RegionNotice";
import { useAuth } from "@/contexts/AuthContext";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { isOwingStatus } from "@/config/subscription-status";
import { money } from "@/lib/format";
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "./plan-facts";
import { LINK_TARGET_44 } from "@/lib/home/targets";
import { GATE_TEXT_KEY, type FullAnalysisClosedBy, type ProClosedBy, type SaleGates } from "./sale-gates";

/** Furniture only the preview page passes: a label above each button and a stand-in for the seller line. */
export interface PreviewFurniture {
  label: ReactNode;
  sellerNote: ReactNode;
}

/** Buttons and the Full Analysis link share it; a link needs the important floor (src/lib/home/targets.ts). */
const BUY_BUTTON = `w-full ${LINK_TARGET_44} justify-center text-center`;

export function GateNote({ closedBy }: { closedBy: FullAnalysisClosedBy | ProClosedBy }) {
  const { t } = useTranslation();
  return (
    <p role="note" data-gate={closedBy} className="mt-5 rounded-md border border-dashed border-border-strong px-3 py-2.5 text-meta text-muted-foreground">
      {t(GATE_TEXT_KEY[closedBy])}
    </p>
  );
}

/**
 * "All sales are final." and the region line, under the Full Analysis link,
 * in PurchaseTerms' own words (the Pro block shows PurchaseTerms itself), so
 * the page says both in one wording.
 */
export function SaleTermsLine() {
  const { t } = useTranslation();
  return (
    <p className="mt-2.5 text-xs text-subtle-foreground" data-sale-terms="">
      <span data-final-sale="">{t("purchaseTerms.finalSale")}</span> <span data-region-line="">{t("purchaseTerms.regionLine")}</span>
    </p>
  );
}

/**
 * A BROWSER CHECKOUT WILL REFUSE SEES WHY INSTEAD OF A BUY CONTROL (review
 * round 2026-10-26). Both checkouts refuse a buyer whose device's time zone
 * is in the EU, the EEA, the UK or India while the EU/UK switch is off
 * (sales-territory.ts), and the page knows the zone before the press, so it
 * shows wave 4's time-zone notice where the button would be, as the Pro card
 * does. Rendered only once a product is on sale: a closed page asks the
 * server nothing about the territory. The preview's open state keeps its
 * buttons.
 */
function RegionRefusedOr({ children }: { children: ReactNode }) {
  const refused = useRegionRefused();
  return refused ? <RegionNotice className="mt-5" /> : <>{children}</>;
}

export function FullAnalysisBuy({ gates, preview }: { gates: SaleGates; preview?: PreviewFurniture }) {
  if (!gates.fullAnalysis.onSale) return <GateNote closedBy={gates.fullAnalysis.closedBy ?? "seller"} />;
  if (gates.previewOpen) return <FullAnalysisBuyOpen gates={gates} preview={preview} />;
  return (
    <RegionRefusedOr>
      <FullAnalysisBuyOpen gates={gates} preview={preview} />
    </RegionRefusedOr>
  );
}

function FullAnalysisBuyOpen({ gates, preview }: { gates: SaleGates; preview?: PreviewFurniture }) {
  const { t, i18n } = useTranslation();
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
      {/* The price above is a US-dollar list price; how it is charged, said beside it (2026-10-25). */}
      <p className="mt-1 text-xs text-subtle-foreground" data-fa-currency="">{t("pricingPlans.fa.currency")}</p>
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
  /** Called only once the renewal box is ticked. */
  onGoPro: () => void;
  preview?: PreviewFurniture;
}

/** PurchaseTerms with its renewal box, then Go Pro. Presentational: the caller decides what Go Pro does. */
export function ProBuyBlock({ gates, busy = false, onGoPro, preview }: ProBuyBlockProps) {
  const { t, i18n } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [missing, setMissing] = useState(false);
  const block = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const price = money(PRO_PRICE_USD, "USD", { lng: i18n.language });
  const onAutoRenewChange = useCallback((ticked: boolean) => {
    setAgreed(ticked);
    if (ticked) setMissing(false);
  }, []);
  const showError = missing && !agreed;

  const press = () => {
    if (!agreed) {
      setMissing(true);
      block.current?.querySelector<HTMLInputElement>("[data-auto-renew-box] input")?.focus();
      return;
    }
    onGoPro();
  };

  return (
    <div ref={block} className="mt-5" data-buy-block="pro">
      {preview?.label}
      <PurchaseTerms
        kind="subscription"
        plan="pro"
        onAutoRenewChange={onAutoRenewChange}
        autoRenewInvalid={showError}
        autoRenewErrorId={errorId}
        className="text-subtle-foreground"
      />
      {showError ? (
        <p id={errorId} role="alert" className="mt-2 text-meta text-destructive">
          {t("pricingPlans.pro.consentError")}
        </p>
      ) : null}
      <Button type="button" variant="secondary" size="lg" wrap className={`mt-3 ${BUY_BUTTON}`} onClick={press} disabled={busy} data-buy="pro">
        {t("pricingPlans.pro.cta", { price })}
      </Button>
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
 * The renewal consent travels in purchaseTerms(), from PurchaseTerms' box in
 * the pressed button's block (see the head of this file), so subscribe()
 * takes no consent argument.
 */
export function ProBuyConnected({ gates }: { gates: SaleGates }) {
  const { t } = useTranslation();
  const { pro, subscribe, manage, actionLoading } = useProSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // A member keeps Manage wherever they are; anyone else in a territory
  // checkout refuses sees the time-zone notice instead of Go Pro.
  const regionRefused = useRegionRefused();

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

  if (regionRefused) return <RegionNotice className="mt-5" />;

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
