import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS } from "@/config/products";
import { fullAnalysisOnSale } from "@/lib/purchases-open";

interface FinalCTAProps {
  onGetStarted: () => void;
  isLoading?: boolean;
}

export function FinalCTA({ onGetStarted, isLoading }: FinalCTAProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();

  // Winners declared - using control variants
  const getCtaText = () => t('finalCta.ctaButton');
  const getPricingSubtext = () => t('finalCta.oneTime');

  const handleGetStarted = () => {
    onGetStarted();
  };

  // THE FREE-AGAINST-PAID GRID AND THE URGENCY BADGE ARE GONE (review
  // round 2026-10-26). The grid sold the Full Analysis with features it no
  // longer has (S12-049) or never had in its definition, which /pricing
  // states, and the badge claimed an outcome for the reader's job search.
  // What the analysis contains is said once, on /pricing, and rewritten from
  // a watched delivery before it goes on sale (P18).

  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
            {t('finalCta.title')}
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            {t('finalCta.subtitle')}
          </p>
          
          {/* The add-ons that sat here (Resume Roast, Interview Coach and Career
          Path at $5) were cut on 2026-10-12 (the product line): nothing below
          offers them. */}
          
          {/* Price + CTA. The analysis is priced here while its sale switch is
              on (G2, src/config/sales-gate.ts: on, as on main); no price waits
              for the seller's name (the owner, 2026-10-27). With the switch
              off the box offers the free scan alone. */}
          {!fullAnalysisOnSale() ? (
            <div className="inline-flex flex-col items-center gap-4 p-8 rounded-2xl bg-primary/10 border border-primary/30" data-final-cta-closed>
              <button
                onClick={handleGetStarted}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 disabled:opacity-50 min-h-[44px] touch-manipulation"
              >
                {t('finalCta.freeScanCta', 'Scan my résumé free')}
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          ) : (
          <div className="inline-flex flex-col items-center p-8 rounded-2xl bg-primary/10 border border-primary/30">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-5xl md:text-6xl font-bold text-foreground">${PRODUCTS.fullAnalysis.priceUsd}</span>
              <span className="text-muted-foreground text-lg">{getPricingSubtext()}</span>
            </div>
            {isLocalCurrency && (
              <p className="text-sm text-primary font-medium mb-2">
                ≈ {formatPrice(PRODUCTS.fullAnalysis.priceUsd)}
              </p>
            )}
            {/* No delivery time and no interview arithmetic beside the price:
                the analysis's timing is printed only from a watched delivery
                (P18), and no page says what a job application will do. */}
            <button
              onClick={handleGetStarted}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/25 disabled:opacity-50 min-h-[44px] touch-manipulation"
            >
              {getCtaText()}
              <ArrowRight className="w-5 h-5" />
            </button>

          </div>
          )}
        </div>
      </div>
    </section>
  );
}
