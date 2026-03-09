import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Zap, X, Check, Flame, MessageSquare, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS } from "@/config/products";

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

  const comparisonItems = [
    { featureKey: "finalCta.comparison.atsScore", free: true, paid: true },
    { featureKey: "finalCta.comparison.redFlags", free: true, paid: true },
    { featureKey: "finalCta.comparison.sampleBullet", free: true, paid: false },
    { featureKey: "finalCta.comparison.allBullets", free: false, paid: true },
    { featureKey: "finalCta.comparison.linkedin", free: false, paid: true },
    { featureKey: "finalCta.comparison.jobKeywords", free: false, paid: true },
    { featureKey: "finalCta.comparison.industryTemplates", free: false, paid: true },
    { featureKey: "finalCta.comparison.fullReport", free: false, paid: true },
  ];

  const addOns = [
    { name: 'Resume Roast', icon: Flame, price: 'FREE' },
    { name: 'Interview Coach', icon: MessageSquare, price: 5 },
    { name: 'Career Path', icon: TrendingUp, price: 5 },
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
            {t('finalCta.title')}
          </h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            {t('finalCta.subtitle')}
          </p>
          
          {/* Free vs Paid Comparison */}
          <div className="bg-card/80 border border-border/50 rounded-2xl p-6 md:p-8 mb-10 backdrop-blur-sm">
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm font-semibold">
              <div className="text-left"></div>
              <div className="text-center text-muted-foreground">{t('finalCta.freeScan')}</div>
              <div className="text-center text-primary">{t('finalCta.fullAnalysis')}</div>
            </div>
            
            <div className="space-y-3">
              {comparisonItems.map((item, index) => (
                <div 
                  key={index} 
                  className={`grid grid-cols-3 gap-4 py-2 text-sm ${
                    index < comparisonItems.length - 1 ? 'border-b border-border/30' : ''
                  }`}
                >
                  <div className="text-left text-foreground">{t(item.featureKey)}</div>
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

          {/* $5 Add-Ons Showcase */}
          <div className="bg-card/60 border border-border/50 rounded-2xl p-6 mb-10 backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-sm font-semibold text-foreground">$5 Add-Ons</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">Quick Boosts</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {addOns.map(({ name, icon: Icon, price }) => (
                <div key={name} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-muted/30">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-foreground">{name}</span>
                  <span className="text-xs text-primary font-bold">${price}</span>
                </div>
              ))}
            </div>
            <Link 
              to="/pricing" 
              onClick={() => window.scrollTo(0, 0)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-4"
            >
              View all products <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          
          {/* Price + CTA */}
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
