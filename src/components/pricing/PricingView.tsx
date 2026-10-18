/**
 * THE /pricing BODY, top to bottom (corrected spec 2026-10-17, section 5):
 *
 *   PricingHead          H1, the summary that leads with what is free, jump links
 *   BeforeYouBuy         all sales final; the region refusal and what checkout
 *                        checks; US dollars and Pro's renewal. Above every card.
 *   Free / Full Analysis / Pro
 *   FreeVsFullAnalysis   what the Full Analysis adds to the free report
 *   BuilderAndLicence    the planned Builder API card and the data licence
 *   PlanLimitsTable      what each plan allows, on the site and in your AI
 *   PricingFaq           answers rendered in the DOM for crawlers and Find
 *
 * Presentational: the route (src/pages/pricing/PricingPage.tsx) passes the
 * board's open-postings figure and the sale gates. Nothing here is a
 * product the owner cut: the only one-off is the Full Analysis.
 */
import "./use-pricing-strings";
import { BeforeYouBuy } from "./BeforeYouBuy";
import { BuilderAndLicence } from "./BuilderAndLicence";
import type { PreviewFurniture } from "./BuyBlock";
import { FreeCard, FullAnalysisCard, ProCard, type OpenPostings } from "./PlanCards";
import { FreeVsFullAnalysis } from "./FreeVsFullAnalysis";
import { PlanLimitsTable } from "./PlanLimitsTable";
import { PricingFaq } from "./PricingFaq";
import { PricingHead } from "./PricingHead";
import type { SaleGates } from "./sale-gates";

export interface PricingViewProps {
  postings: OpenPostings;
  gates: SaleGates;
  /** src/preview only. */
  preview?: PreviewFurniture;
  /** src/preview only: what an inert Go Pro press does. */
  onPreviewPress?: () => void;
}

export function PricingView({ postings, gates, preview, onPreviewPress }: PricingViewProps) {
  return (
    <>
      <section aria-labelledby="pricing-h1" className="pb-2 pt-20 lg:pt-28">
        <div className="container">
          <PricingHead />
          <BeforeYouBuy />
          <div className="mt-5 grid gap-3 lg:mt-6 lg:grid-cols-3 lg:gap-4" data-testid="plan-cards">
            <FreeCard postings={postings} />
            <FullAnalysisCard gates={gates} preview={preview} />
            <ProCard gates={gates} preview={preview} onPreviewPress={onPreviewPress} />
          </div>
        </div>
      </section>
      <FreeVsFullAnalysis />
      <BuilderAndLicence />
      <PlanLimitsTable gates={gates} />
      <PricingFaq />
    </>
  );
}
