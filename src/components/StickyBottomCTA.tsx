import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS } from "@/config/products";
import { setStickyBarVisible } from "@/lib/sticky-bar";

interface StickyBottomCTAProps {
  isLoading?: boolean;
}

export function StickyBottomCTA({ isLoading }: StickyBottomCTAProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const navigate = useNavigate();

  // Winner declared - using control variant
  const getCtaText = () => t('stickyCta.ctaButton');

  const handleGetStarted = () => {
    window.scrollTo(0, 0);
    navigate('/pricing');
  };

  useEffect(() => {
    const handleScroll = () => {
      // Show after scrolling past ~500px (past hero section)
      const scrolled = window.scrollY > 500;
      setIsVisible(scrolled && !isDismissed);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isDismissed]);

  // The help button lifts above the bar while it shows (src/lib/sticky-bar.ts).
  useEffect(() => {
    setStickyBarVisible(isVisible);
    return () => setStickyBarVisible(false);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-sticky animate-fade-in safe-bottom">
      <div className="bg-card border-t border-border-strong shadow-overlay">
        <div className="container py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            {/* Left: Value prop */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="p-2 rounded-md bg-muted">
                <Sparkles aria-hidden="true" className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="text-foreground">
                <p className="font-semibold text-sm md:text-base">
                  {t('freeResults.nextSteps.fullAnalysisName')} · ${PRODUCTS.fullAnalysis.priceUsd}
                  {isLocalCurrency && <span className="text-muted-foreground text-xs ml-1">({formatPrice(PRODUCTS.fullAnalysis.priceUsd)})</span>}
                </p>
                <p className="text-xs md:text-sm text-muted-foreground">{t('stickyCta.features')}</p>
              </div>
            </div>
            
            {/* Mobile: Compact */}
            <div className="sm:hidden text-foreground flex-1">
              <p className="font-semibold text-sm">
                {t('freeResults.nextSteps.fullAnalysisName')} · ${PRODUCTS.fullAnalysis.priceUsd}
                {isLocalCurrency && <span className="text-muted-foreground text-xs ml-1">({formatPrice(PRODUCTS.fullAnalysis.priceUsd)})</span>}
              </p>
              <p className="text-xs text-muted-foreground">{t('stickyCta.featuresMobile')}</p>
            </div>
            
            {/* Right: CTA */}
            <div className="flex items-center gap-2 sm:gap-3">
              
              <button
                onClick={handleGetStarted}
                disabled={isLoading}
                className="inline-flex h-10 items-center gap-2 px-4 sm:px-5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary-hover transition-colors disabled:opacity-60 coarse:h-11 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="text-sm sm:text-base">{getCtaText()}</span>
                <ArrowRight aria-hidden="true" className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => { setIsDismissed(true); setIsVisible(false); }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors coarse:h-11 coarse:w-11 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('common.dismiss')}
              >
                <X aria-hidden="true" className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
