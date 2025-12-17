import { useState, useEffect } from "react";
import { X, Sparkles, FileText, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExitIntentPopupProps {
  onGetStarted: () => void;
}

export function ExitIntentPopup({ onGetStarted }: ExitIntentPopupProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session
    const dismissed = sessionStorage.getItem("exitPopupDismissed");
    if (dismissed) return;

    const handleMouseLeave = (e: MouseEvent) => {
      // Only trigger when mouse leaves from top of viewport
      if (e.clientY <= 0 && !hasTriggered) {
        setHasTriggered(true);
        setIsVisible(true);
      }
    };

    // Also trigger on mobile when user scrolls up quickly (potential exit behavior)
    let lastScrollY = window.scrollY;
    let scrollUpCount = 0;
    
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY < lastScrollY && currentScrollY < 100) {
        scrollUpCount++;
        if (scrollUpCount > 3 && !hasTriggered) {
          setHasTriggered(true);
          setIsVisible(true);
        }
      } else {
        scrollUpCount = 0;
      }
      lastScrollY = currentScrollY;
    };

    // Delay adding listeners to prevent immediate trigger
    const timeout = setTimeout(() => {
      document.addEventListener("mouseleave", handleMouseLeave);
      window.addEventListener("scroll", handleScroll, { passive: true });
    }, 5000); // Wait 5 seconds before enabling

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [hasTriggered]);

  const handleClose = () => {
    setIsVisible(false);
    sessionStorage.setItem("exitPopupDismissed", "true");
  };

  const handleGetStarted = () => {
    handleClose();
    onGetStarted();
  };

  if (!isVisible) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-popup-title"
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Popup */}
      <div className={cn(
        "relative w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 md:p-8",
        "animate-scale-in"
      )}>
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-lg hover:bg-muted transition-colors"
          aria-label="Close popup"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-success flex items-center justify-center animate-pulse">
              <Sparkles className="w-3 h-3 text-success-foreground" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="text-center space-y-4">
          <h2 id="exit-popup-title" className="text-2xl font-bold">
            Wait! Get Your Free Resume Score
          </h2>
          <p className="text-muted-foreground">
            Before you go, see how your resume stacks up against ATS systems. 
            <span className="text-primary font-medium"> It takes 30 seconds.</span>
          </p>

          {/* Benefits */}
          <ul className="text-left space-y-2 py-4 border-y border-border">
            <li className="flex items-center gap-3 text-sm">
              <div className="w-5 h-5 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <Zap className="w-3 h-3 text-success" />
              </div>
              <span>Instant ATS compatibility score</span>
            </li>
            <li className="flex items-center gap-3 text-sm">
              <div className="w-5 h-5 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <Zap className="w-3 h-3 text-success" />
              </div>
              <span>See missing keywords recruiters want</span>
            </li>
            <li className="flex items-center gap-3 text-sm">
              <div className="w-5 h-5 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                <Zap className="w-3 h-3 text-success" />
              </div>
              <span>100% free - no credit card needed</span>
            </li>
          </ul>

          {/* CTA */}
          <Button
            onClick={handleGetStarted}
            size="lg"
            className="w-full gap-2 text-lg py-6 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
          >
            <Sparkles className="w-5 h-5" />
            Get My Free Score
          </Button>

          <p className="text-xs text-muted-foreground">
            No sign-up required. Results in seconds.
          </p>
        </div>
      </div>
    </div>
  );
}
