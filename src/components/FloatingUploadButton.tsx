import { useState, useEffect } from "react";
import { Zap, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingUploadButtonProps {
  hasContent?: boolean;
  scanComplete?: boolean;
}

export function FloatingUploadButton({ hasContent = false, scanComplete = false }: FloatingUploadButtonProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);

  useEffect(() => {
    if (!hasContent) {
      setIsVisible(false);
      setJustUploaded(false);
      return;
    }

    // If scan is complete, don't show the "Scan Now" button
    if (scanComplete) {
      setIsVisible(false);
      setJustUploaded(false);
      return;
    }

    // Show immediately when resume is uploaded
    setIsVisible(true);
    setJustUploaded(true);

    // After 3 seconds, switch to scroll-based visibility
    const timer = setTimeout(() => {
      setJustUploaded(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, [hasContent, scanComplete]);

  useEffect(() => {
    if (!hasContent || justUploaded || scanComplete) return;

    const handleScroll = () => {
      const scanButton = document.querySelector('[data-scan-button="true"]');
      if (!scanButton) return;

      const rect = scanButton.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      const isScanButtonVisible = rect.top < viewportHeight - 50 && rect.bottom > 50;
      setIsVisible(!isScanButtonVisible);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasContent, justUploaded, scanComplete]);

  const handleClick = () => {
    const scanButton = document.querySelector('[data-scan-button="true"]');
    if (scanButton) {
      scanButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (!hasContent || scanComplete) return null;

  return (
    <div 
      className={cn(
        "fixed z-50 bottom-24 left-0 right-0 flex justify-center pointer-events-none",
        "transition-all duration-300",
        isVisible 
          ? "translate-y-0 opacity-100" 
          : "translate-y-24 opacity-0"
      )}
    >
      <button
        onClick={handleClick}
        className={cn(
          "pointer-events-auto flex items-center gap-2 px-6 py-4 rounded-full",
          "bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground font-bold text-base",
          "shadow-xl shadow-success/40 hover:shadow-2xl hover:shadow-success/50",
          "touch-manipulation",
          justUploaded && "animate-bounce"
        )}
        aria-label="Scroll to free scan button"
      >
        <Zap className="w-5 h-5 fill-current" />
        <span>Scan Now – FREE</span>
      </button>
    </div>
  );
}

// New component for "See Report" floating button
interface FloatingSeeReportButtonProps {
  isVisible?: boolean;
}

export function FloatingSeeReportButton({ isVisible = false }: FloatingSeeReportButtonProps) {
  const [showButton, setShowButton] = useState(false);
  const [justAppeared, setJustAppeared] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setShowButton(false);
      setJustAppeared(false);
      return;
    }

    // Check if results are in viewport
    const handleScroll = () => {
      const resultsSection = document.querySelector('[data-results-section="true"]');
      if (!resultsSection) {
        setShowButton(false);
        return;
      }

      const rect = resultsSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // Show button when results are NOT visible
      const isResultsVisible = rect.top < viewportHeight - 100 && rect.bottom > 100;
      setShowButton(!isResultsVisible);
    };

    // Initial check
    handleScroll();
    
    // Show with animation on first appear
    if (!justAppeared) {
      setJustAppeared(true);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isVisible, justAppeared]);

  const handleClick = () => {
    const resultsSection = document.querySelector('[data-results-section="true"]');
    if (resultsSection) {
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isVisible) return null;

  return (
    <div 
      className={cn(
        "fixed z-50 bottom-24 left-0 right-0 flex justify-center pointer-events-none",
        "transition-all duration-300",
        showButton 
          ? "translate-y-0 opacity-100" 
          : "translate-y-24 opacity-0"
      )}
    >
      <button
        onClick={handleClick}
        className={cn(
          "pointer-events-auto flex items-center gap-2 px-6 py-4 rounded-full",
          "bg-gradient-to-r from-primary via-primary to-indigo-500 text-primary-foreground font-bold text-base",
          "shadow-xl shadow-primary/40 hover:shadow-2xl hover:shadow-primary/50",
          "touch-manipulation",
          justAppeared && "animate-bounce"
        )}
        aria-label="Scroll to scan results"
      >
        <FileText className="w-5 h-5" />
        <span>See Report</span>
      </button>
    </div>
  );
}