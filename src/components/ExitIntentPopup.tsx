import { useState, useEffect, useCallback } from "react";
import { X, Gift, Clock, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOptimizationTracking } from "@/hooks/use-optimization-tracking";

interface ExitIntentPopupProps {
  onClose: () => void;
  onGetStarted: () => void;
}

export function ExitIntentPopup({ onClose, onGetStarted }: ExitIntentPopupProps) {
  const [isVisible, setIsVisible] = useState(false);
  const { trackExitIntentShown, trackExitIntentDismissed, trackExitIntentConverted } = useOptimizationTracking();

  useEffect(() => {
    // Track that popup was shown
    trackExitIntentShown();
    // Animate in after mount
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, [trackExitIntentShown]);

  const handleClose = () => {
    trackExitIntentDismissed();
    setIsVisible(false);
    setTimeout(onClose, 200);
  };

  const handleGetStarted = () => {
    trackExitIntentConverted();
    setIsVisible(false);
    setTimeout(onGetStarted, 200);
  };

  return (
    <div 
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200",
        isVisible ? "bg-background/80 backdrop-blur-sm" : "bg-transparent"
      )}
      onClick={handleClose}
    >
      <div 
        className={cn(
          "relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 transition-all duration-300",
          isVisible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close popup"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="text-center">
          {/* Icon badge */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-success/20 to-primary/20 mb-4">
            <Gift className="w-8 h-8 text-success" />
          </div>

          <h3 className="text-xl font-bold text-foreground mb-2">
            Wait — don't leave yet!
          </h3>
          
          <p className="text-muted-foreground mb-4">
            Get your <span className="font-semibold text-success">free ATS resume score</span> in 60 seconds. No sign-up required.
          </p>

          {/* Benefits list */}
          <div className="flex flex-col gap-2 mb-6 text-left">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-success flex-shrink-0" />
              <span>AI-powered analysis of your resume</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-success flex-shrink-0" />
              <span>Results in under 60 seconds</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Gift className="w-4 h-4 text-success flex-shrink-0" />
              <span>100% free — no credit card needed</span>
            </div>
          </div>

          {/* CTA Button */}
          <Button
            onClick={handleGetStarted}
            size="lg"
            className="w-full bg-gradient-to-r from-success to-emerald-500 hover:from-success/90 hover:to-emerald-500/90 text-success-foreground font-semibold shadow-lg"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            Check My Resume Now
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>

          <p className="mt-3 text-xs text-muted-foreground">
            Your resume is never stored or shared
          </p>
        </div>
      </div>
    </div>
  );
}

// Hook to detect exit intent
export function useExitIntent(enabled = true) {
  const [showPopup, setShowPopup] = useState(false);
  const [hasShown, setHasShown] = useState(false);

  useEffect(() => {
    if (!enabled || hasShown) return;

    // Check if already shown this session
    const alreadyShown = sessionStorage.getItem('exit_intent_shown');
    if (alreadyShown) {
      setHasShown(true);
      return;
    }

    const handleMouseLeave = (e: MouseEvent) => {
      // Only trigger when mouse leaves through the top of the viewport
      if (e.clientY <= 0 && !hasShown) {
        setShowPopup(true);
        setHasShown(true);
        sessionStorage.setItem('exit_intent_shown', 'true');
      }
    };

    // Only add listener after user has been on page for at least 5 seconds
    const timer = setTimeout(() => {
      document.addEventListener('mouseleave', handleMouseLeave);
    }, 5000);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [enabled, hasShown]);

  const closePopup = useCallback(() => {
    setShowPopup(false);
  }, []);

  return { showPopup, closePopup };
}
