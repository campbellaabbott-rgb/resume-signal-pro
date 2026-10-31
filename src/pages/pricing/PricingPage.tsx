/**
 * /pricing, REBUILT (homepage and pricing redesign, corrected spec 2026-10-17).
 *
 * App.tsx routes /pricing here (switch-over step 1,
 * docs/homepage-pricing/README.md). The page leads with what is free, states before any click that all sales
 * are final and where it does not sell, and renders a buy button only while
 * the seller's name and address are published (sale-gates.ts).
 *
 * Data: one read, the board's open-postings figure with its count time
 * (useBoardVendorCounts: get_board_vendor_counts, the same cached row the
 * front page's platform wall reads). No figure is printed without its time.
 * The Pro account check runs only once Pro is on sale (ProBuyConnected).
 *
 * Only the FIRST render waits for the reader's main locale, which carries
 * this page's shard (useLocaleReady: no English frame swapping into German), and the footer waits with it, so nothing drawn early
 * is pushed down when the page lands. A later language change keeps the page
 * and the footer mounted, so the reader's focus and scroll position survive
 * it (useStickyReady).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n/pricing-strings";
import { SEO } from "@/components/seo/SEO";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useBoardVendorCounts } from "@/hooks/useBoardVendorCounts";
import { money } from "@/lib/format";
import type { PreviewFurniture } from "@/components/pricing/BuyBlock";
import { FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "@/components/pricing/plan-facts";
import { pricingJsonLd } from "@/components/pricing/pricing-jsonld";
import { pricingMetaKeys } from "@/components/pricing/pricing-meta";
import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates, type SaleGateInput } from "@/components/pricing/sale-gates";
import { useLocaleReady } from "@/lib/home/use-locale-ready";
import { useStickyReady } from "@/lib/home/use-sticky-ready";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";

export interface PricingPageProps {
  /** Tests and the preview only. The route passes nothing: the shipped seller and gates decide. */
  gateInput?: SaleGateInput;
  preview?: PreviewFurniture;
  onPreviewPress?: () => void;
}

export default function PricingPage({ gateInput, preview, onPreviewPress }: PricingPageProps = {}) {
  const shown = useStickyReady(useLocaleReady());
  // The old /pricing's scroll-depth and time-on-page events, kept under the
  // same page name so the pricing funnel reads on across the switch-over
  // (step 13); the visitor budget already counted them. They store and send
  // nothing before an analytics choice.
  useScrollDepth("pricing");
  useTimeOnPage("pricing");
  const { t, i18n } = useTranslation();
  const counts = useBoardVendorCounts();
  const gates = useMemo(
    () => resolveSaleGates(gateInput),
    [gateInput],
  );
  const lng = i18n.language;
  const prices = { faPrice: money(FULL_ANALYSIS_PRICE_USD, "USD", { lng }), proPrice: money(PRO_PRICE_USD, "USD", { lng }) };
  const meta = pricingMetaKeys(gates);

  return (
    <div className="min-h-screen bg-background">
      {shown ? (
        <SEO title={t(meta.title, prices)} description={t(meta.description, prices)} path="/pricing" />
      ) : null}
      {/* One source of structured data (SEO-031): on the baked /pricing the
          bake's block, which is this same pricingJsonLd, is the only one. */}
      <PageJsonLd blocks={[pricingJsonLd(gates)]} />
      <Header variant="quiet" />
      <main id="main-content" tabIndex={-1} className="min-h-screen pb-8 focus:outline-none">
        {shown ? (
          <PricingView postings={{ openTotal: counts.openTotal, asOf: counts.asOf }} gates={gates} preview={preview} onPreviewPress={onPreviewPress} />
        ) : null}
      </main>
      {shown ? <Footer /> : null}
    </div>
  );
}
