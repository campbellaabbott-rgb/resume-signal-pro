import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { useABTest } from "@/hooks/use-ab-test";
import { PRODUCTS } from "@/config/products";

interface StickyBottomCTAProps {
  onGetStarted: () => void;
  isLoading?: boolean;
}

export function StickyBottomCTA({ onGetStarted, isLoading }: StickyBottomCTAProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const heroCta = useABTest('hero_cta');
  const navigate = useNavigate();

  // CTA button text variants
  const getCtaText = () => {
    return 'See All Packages';
  };

  const handleGetStarted = () => {
    heroCta.trackConversion({ source: 'sticky_cta' });
    // Navigate to pricing page
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

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up safe-bottom">
      <div className="bg-gradient-to-r from-primary/95 via-primary to-primary/95 backdrop-blur-lg border-t border-primary/30 shadow-2xl shadow-primary/20">
        <div className="container py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            {/* Left: Value prop */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="p-2 rounded-full bg-white/10">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="text-white">
                <p className="font-semibold text-sm md:text-base">
                  Premium packages from ${PRODUCTS.basicKeywordFix.priceUsd}
                  {isLocalCurrency && <span className="text-white/80 text-xs ml-1">({formatPrice(PRODUCTS.basicKeywordFix.priceUsd)})</span>}
                </p>
                <p className="text-xs md:text-sm text-white/80">Full rewrites + LinkedIn optimization + job-specific tailoring</p>
              </div>
            </div>
            
            {/* Mobile: Compact */}
            <div className="sm:hidden text-white flex-1">
              <p className="font-semibold text-sm">
                From ${PRODUCTS.basicKeywordFix.priceUsd}
                {isLocalCurrency && <span className="text-white/70 text-xs ml-1">({formatPrice(PRODUCTS.basicKeywordFix.priceUsd)})</span>}
              </p>
              <p className="text-xs text-white/70">Full rewrites + LinkedIn optimization</p>
            </div>
            
            {/* Right: CTA */}
            <div className="flex items-center gap-2 sm:gap-3">
              
              <button
                onClick={handleGetStarted}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-full bg-white text-primary font-semibold hover:bg-white/90 active:scale-[0.98] transition-all shadow-lg disabled:opacity-50 min-h-[44px] touch-manipulation"
              >
                <span className="text-sm sm:text-base">{getCtaText()}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => setIsDismissed(true)}
                className="p-2.5 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
                aria-label="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
