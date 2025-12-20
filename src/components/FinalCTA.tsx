import { ArrowRight, CheckCircle2, Zap, X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { useABTest } from "@/hooks/use-ab-test";

interface FinalCTAProps {
  onGetStarted: () => void;
  isLoading?: boolean;
}

export function FinalCTA({ onGetStarted, isLoading }: FinalCTAProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const heroCta = useABTest('hero_cta');
  const pricingDisplay = useABTest('pricing_display');

  // CTA button text variants
  const getCtaText = () => {
    switch (heroCta.variant) {
      case 'urgent': return 'See All Packages';
      case 'benefit': return 'See All Packages';
      default: return 'See All Packages';
    }
  };

  // Pricing display variants
  const getPricingSubtext = () => {
    switch (pricingDisplay.variant) {
      case 'roi_focused': return '= Your Next Interview';
      default: return t('finalCta.oneTime');
    }
  };

  const handleGetStarted = () => {
    heroCta.trackConversion({ source: 'final_cta' });
    onGetStarted();
  };

  const comparisonItems = [
    { feature: "ATS Score & 17 Diagnostics", free: true, paid: true },
    { feature: "Red Flags & Missing Keywords", free: true, paid: true },
    { feature: "1 Sample Bullet Rewrite", free: true, paid: false },
    { feature: "ALL Bullets Rewritten with Metrics", free: false, paid: true },
    { feature: "LinkedIn Profile Optimization", free: false, paid: true },
    { feature: "Job-Specific Keyword Tailoring", free: false, paid: true },
    { feature: "Industry-Specific Templates Applied", free: false, paid: true },
    { feature: "Complete 10-Section Report", free: false, paid: true },
  ];

  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-4xl mx-auto text-center">
          {/* Urgency badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium mb-6 animate-pulse">
            <Zap className="w-4 h-4" />
            {t('finalCta.urgency')}
          </div>
          
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
            You've seen the problems. Now get the fixes.
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            The free scan shows what's wrong. The full analysis gives you rewritten content you can copy-paste.
          </p>
          
          {/* Free vs Paid Comparison */}
          <div className="bg-card/80 border border-border/50 rounded-2xl p-6 md:p-8 mb-10 backdrop-blur-sm">
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm font-semibold">
              <div className="text-left"></div>
              <div className="text-center text-muted-foreground">Free Scan</div>
              <div className="text-center text-primary">Full Analysis</div>
            </div>
            
            <div className="space-y-3">
              {comparisonItems.map((item, index) => (
                <div 
                  key={index} 
                  className={`grid grid-cols-3 gap-4 py-2 text-sm ${
                    index < comparisonItems.length - 1 ? 'border-b border-border/30' : ''
                  }`}
                >
                  <div className="text-left text-foreground">{item.feature}</div>
                  <div className="flex justify-center">
                    {item.free ? (
                      <Check className="w-5 h-5 text-success" />
                    ) : (
                      <X className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex justify-center">
                    <Check className="w-5 h-5 text-primary" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Price + CTA */}
          <div className="inline-flex flex-col items-center p-8 rounded-2xl bg-primary/10 border border-primary/30">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-5xl md:text-6xl font-bold text-foreground">$25</span>
              <span className="text-muted-foreground text-lg">{getPricingSubtext()}</span>
            </div>
            {isLocalCurrency && (
              <p className="text-sm text-primary font-medium mb-2">
                ≈ {formatPrice(25)}
              </p>
            )}
            <p className="text-sm text-muted-foreground mb-4">{t('finalCta.guarantee')}</p>
            
            <button
              onClick={handleGetStarted}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/25 disabled:opacity-50 min-h-[44px] touch-manipulation"
            >
              {getCtaText()}
              <ArrowRight className="w-5 h-5" />
            </button>
            
            <p className="text-xs text-muted-foreground mt-4">
              {t('finalCta.roi')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
