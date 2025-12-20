import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Package, ArrowRight, X } from "lucide-react";
import { useABTest } from "@/hooks/use-ab-test";

export function StickyPricingBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [uploadInView, setUploadInView] = useState(false);
  const { variant, trackConversion } = useABTest('sticky_pricing_banner');

  useEffect(() => {
    const uploadEl = document.getElementById("upload");
    if (!uploadEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setUploadInView(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.2 }
    );

    observer.observe(uploadEl);
    return () => observer.disconnect();
  }, []);

  // A/B test: hide variant shows nothing
  if (variant === 'hide') return null;

  // Visible until user reaches the upload section or dismisses
  if (isDismissed || uploadInView) return null;

  const handleClick = () => {
    trackConversion({ action: 'pricing_click', source: 'sticky_banner' });
  };

  return (
    <>
      {/* Mobile: banner below fixed beta+header */}
      <div className="sm:hidden fixed top-[6.5rem] left-0 right-0 z-40 animate-fade-in">
        <div className="bg-accent/95 backdrop-blur-lg border-b border-border shadow-lg">
          <div className="container py-2.5">
            <div className="flex items-center justify-between gap-2">
              <Link 
                to="/pricing" 
                onClick={handleClick}
                className="flex items-center gap-2 flex-1"
              >
                <Package className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">
                  Resume packages from <span className="text-primary font-bold">$10</span>
                </span>
                <ArrowRight className="w-3 h-3 text-primary" />
              </Link>
              <button
                onClick={() => setIsDismissed(true)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-full transition-colors"
                aria-label="Dismiss pricing banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: Bottom-left floating pill */}
      <div className="hidden sm:block fixed bottom-24 left-4 z-40 animate-fade-in">
        <div className="relative">
          <Link
            to="/pricing"
            onClick={handleClick}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-card border border-border shadow-lg hover:shadow-xl hover:border-primary/50 transition-all group"
          >
            <Package className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">
              Packages from <span className="text-primary font-bold">$10</span>
            </span>
            <ArrowRight className="w-4 h-4 text-primary group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <button
            onClick={() => setIsDismissed(true)}
            className="absolute -top-2 -right-2 p-1 bg-muted rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Dismiss pricing banner"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </>
  );
}
