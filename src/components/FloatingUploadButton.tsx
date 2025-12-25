import { useState, useEffect } from "react";
import { Zap, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingUploadButtonProps {
  hasContent?: boolean;
  scanComplete?: boolean;
}

export function FloatingUploadButton({ hasContent = false, scanComplete = false }: FloatingUploadButtonProps) {
  // Disable floating button entirely - we now have in-page arrow guides instead
  // The floating button was distracting and covering other UI elements
  // Users are now guided by inline arrows that point to the scan button
  return null;
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