import { ArrowRight, CheckCircle2, Zap } from "lucide-react";
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
      case 'urgent': return 'Get Analysis Now';
      case 'benefit': return 'Start Landing Interviews';
      default: return t('finalCta.button');
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

  const benefits = [
    "finalCta.benefits.ats",
    "finalCta.benefits.keywords",
    "finalCta.benefits.redFlags",
    "finalCta.benefits.linkedin",
  ];

  return (
    <section className="py-20 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/5 to-background pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[150px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          {/* Urgency badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium mb-6 animate-pulse">
            <Zap className="w-4 h-4" />
            {t('finalCta.urgency')}
          </div>
          
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
            {t('finalCta.heading')}
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
            {t('finalCta.subheading')}
          </p>
          
          {/* Benefits list */}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 max-w-lg mx-auto text-left">
            {benefits.map((key) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          
          {/* Price + CTA */}
          <div className="inline-flex flex-col items-center p-8 rounded-2xl bg-card/80 border border-border/50 backdrop-blur-sm">
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
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/25 disabled:opacity-50"
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
