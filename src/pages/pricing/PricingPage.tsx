/**
 * /pricing, REBUILT (homepage and pricing redesign, corrected spec 2026-10-17).
 *
 * Not routed yet: src/pages/Pricing.tsx serves /pricing until switch-over,
 * when App.tsx's lazy import points here (docs/homepage-pricing/README.md).
 * The page leads with what is free, states before any click that all sales
 * are final and where it does not sell, and renders a buy button only while
 * the seller's name and address are published (sale-gates.ts).
 *
 * Data: one read, the board's open-postings figure with its count time
 * (useBoardVendorCounts: get_board_vendor_counts, the same cached row the
 * front page's platform wall reads). No figure is printed without its time.
 * The Pro account check runs only once Pro is on sale (ProBuyConnected).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useBoardVendorCounts } from "@/hooks/useBoardVendorCounts";
import { money } from "@/lib/format";
import type { PreviewFurniture } from "@/components/pricing/BuyBlock";
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "@/components/pricing/plan-facts";
import { pricingJsonLd } from "@/components/pricing/pricing-jsonld";
import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates, type SaleGateInput } from "@/components/pricing/sale-gates";
import { usePricingStrings } from "@/components/pricing/use-pricing-strings";

export interface PricingPageProps {
  /** Tests and the preview only. The route passes nothing: the shipped seller and gates decide. */
  gateInput?: SaleGateInput;
  preview?: PreviewFurniture;
  onPreviewPress?: () => void;
}

export default function PricingPage({ gateInput, preview, onPreviewPress }: PricingPageProps = {}) {
  const ready = usePricingStrings();
  const { t, i18n } = useTranslation();
  const counts = useBoardVendorCounts();
  const gates = useMemo(
    () => resolveSaleGates(gateInput),
    [gateInput],
  );
  const lng = i18n.language;
  const prices = { faPrice: money(FULL_ANALYSIS_PRICE_USD, "USD", { lng }), proPrice: money(PRO_PRICE_USD, "USD", { lng }) };

  return (
    <div className="min-h-screen bg-background">
      {ready ? (
        <SEO title={t("pricingPlans.meta.title", prices)} description={t("pricingPlans.meta.description", prices)} path="/pricing" />
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd(gates)) }} />
      <Header />
      <main id="main-content" tabIndex={-1} className="min-h-screen pb-8 focus:outline-none">
        {ready ? (
          <PricingView postings={{ openTotal: counts.openTotal, asOf: counts.asOf }} gates={gates} preview={preview} onPreviewPress={onPreviewPress} />
        ) : null}
      </main>
      {ready ? <Footer /> : null}
    </div>
  );
}
