import { useState, useEffect } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";

interface StickyBottomCTAProps {
  onGetStarted: () => void;
  isLoading?: boolean;
}

export function StickyBottomCTA({ onGetStarted, isLoading }: StickyBottomCTAProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();

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
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-slide-up">
      <div className="bg-gradient-to-r from-primary/95 via-primary to-primary/95 backdrop-blur-lg border-t border-primary/30 shadow-2xl shadow-primary/20">
        <div className="container py-3 md:py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Value prop */}
            <div className="hidden sm:flex items-center gap-3">
              <div className="p-2 rounded-full bg-white/10">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="text-white">
                <p className="font-semibold text-sm md:text-base">{t('stickyCta.title')}</p>
                <p className="text-xs md:text-sm text-white/80">{t('stickyCta.subtitle')}</p>
              </div>
            </div>
            
            {/* Mobile: Compact */}
            <div className="sm:hidden text-white">
              <p className="font-semibold text-sm">{t('stickyCta.mobileTitle')}</p>
            </div>
            
            {/* Right: CTA */}
            <div className="flex items-center gap-3">
              <div className="text-right text-white hidden md:block">
                <p className="text-2xl font-bold">$25</p>
                {isLocalCurrency && (
                  <p className="text-xs text-white/70">≈ {formatPrice(25)}</p>
                )}
              </div>
              
              <button
                onClick={onGetStarted}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 md:px-6 md:py-3 rounded-full bg-white text-primary font-semibold hover:bg-white/90 transition-all hover:scale-105 shadow-lg disabled:opacity-50"
              >
                <span className="text-sm md:text-base">{t('stickyCta.button')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              
              <button
                onClick={() => setIsDismissed(true)}
                className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
