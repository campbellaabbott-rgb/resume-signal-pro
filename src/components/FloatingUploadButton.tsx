import { useState, useEffect } from "react";
import { Zap, FileText, ArrowDown, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface FloatingUploadButtonProps {
  hasContent?: boolean;
  scanComplete?: boolean;
  /** increments whenever we want the floating CTA to "pop" again */
  trigger?: number;
  resumeVerified?: boolean;
  onVerifyClick?: () => void;
}

export function FloatingUploadButton({ 
  hasContent = false, 
  scanComplete = false,
  trigger = 0,
  resumeVerified = false,
  onVerifyClick
}: FloatingUploadButtonProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showVerifyFirst, setShowVerifyFirst] = useState(true);
  const [justTriggered, setJustTriggered] = useState(false);

  // Track if user has clicked verify this session
  const [hasClickedVerify, setHasClickedVerify] = useState(false);
  
  // Prevent double-clicks during verify process
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!hasContent || scanComplete) {
      setIsVisible(false);
      setShowVerifyFirst(true);
      setJustTriggered(false);
      setHasClickedVerify(false);
      setIsVerifying(false); // Reset on new content
      return;
    }

    // Pop the button whenever trigger increments (upload OR paste-ready)
    // ALWAYS start with Step 1: Verify Resume
    setIsVisible(true);
    setShowVerifyFirst(true);
    setHasClickedVerify(false);
    setIsVerifying(false); // Reset - new upload means new verification needed
    setJustTriggered(true);

    const timer = setTimeout(() => {
      setJustTriggered(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, [hasContent, scanComplete, trigger]);

  // Only switch to Step 2 after explicit verify click OR external resumeVerified
  useEffect(() => {
    if (resumeVerified && hasContent && !scanComplete) {
      setShowVerifyFirst(false);
    }
  }, [resumeVerified, hasContent, scanComplete]);

  useEffect(() => {
    if (!hasContent || scanComplete || justTriggered) return;

    const handleScroll = () => {
      // Check visibility of appropriate section based on current step
      if (showVerifyFirst) {
        const resumeSection = document.querySelector('[data-resume-loaded="true"]');
        if (resumeSection) {
          const rect = resumeSection.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const isResumeVisible = rect.top < viewportHeight - 50 && rect.bottom > 50;
          setIsVisible(!isResumeVisible);
        }
      } else {
        const scanButton = document.querySelector('[data-scan-button="true"]');
        if (scanButton) {
          const rect = scanButton.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const isScanButtonVisible = rect.top < viewportHeight - 50 && rect.bottom > 50;
          setIsVisible(!isScanButtonVisible);
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasContent, scanComplete, showVerifyFirst, justTriggered]);

  const handleVerifyClick = () => {
    // Prevent double-clicks - only process if not already verifying
    if (isVerifying) return;

    setIsVerifying(true);

    const startedAt = Date.now();

    const tryScrollToResume = () => {
      const resumeSection = document.querySelector('[data-resume-loaded="true"]');
      if (resumeSection) {
        resumeSection.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // After scrolling to verify, switch to showing scan button
        window.setTimeout(() => {
          setHasClickedVerify(true);
          setShowVerifyFirst(false);
          setIsVerifying(false);
          onVerifyClick?.();
        }, 800);
        return;
      }

      // If the resume section hasn't mounted yet (fast click after upload), retry briefly.
      if (Date.now() - startedAt > 1500) {
        setIsVerifying(false);
        return;
      }

      window.setTimeout(tryScrollToResume, 100);
    };

    tryScrollToResume();
  };

  const handleScanClick = () => {
    const scanButton = document.querySelector('[data-scan-button="true"]');
    if (scanButton) {
      scanButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (!hasContent || scanComplete) return null;

  return (
    <div 
      className={cn(
        "fixed z-help bottom-24 left-0 right-0 flex justify-center pointer-events-none",
        "transition-opacity duration-base",
        isVisible 
          ? "opacity-100" 
          : "opacity-0 invisible"
      )}
    >
      {showVerifyFirst ? (
        // Step 1: Verify resume button
        <button
          onClick={handleVerifyClick}
          className={cn(
            "pointer-events-auto flex h-11 items-center gap-2 px-5 rounded-md",
            "bg-primary text-primary-foreground font-semibold text-base hover:bg-primary-hover",
            "shadow-overlay",
            "touch-manipulation"
          )}
          aria-label={t('floatingUpload.verifyAriaLabel')}
        >
          <Eye aria-hidden="true" className="w-5 h-5" />
          <span>{t('floatingUpload.step1Verify')}</span>
          <ArrowDown aria-hidden="true" className="w-4 h-4" />
        </button>
      ) : (
        // Step 2: Scan button
        <button
          onClick={handleScanClick}
          className={cn(
            "pointer-events-auto flex h-11 items-center gap-2 px-5 rounded-md",
            "bg-primary text-primary-foreground font-semibold text-base hover:bg-primary-hover",
            "shadow-overlay",
            "touch-manipulation"
          )}
          aria-label={t('floatingUpload.scanAriaLabel')}
        >
          <Zap aria-hidden="true" className="w-5 h-5" />
          <span>{t('floatingUpload.step2Scan')}</span>
        </button>
      )}
    </div>
  );
}

// New component for "See Report" floating button
interface FloatingSeeReportButtonProps {
  isVisible?: boolean;
}

export function FloatingSeeReportButton({ isVisible = false }: FloatingSeeReportButtonProps) {
  const { t } = useTranslation();
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
        "fixed z-help bottom-24 left-0 right-0 flex justify-center pointer-events-none",
        "transition-opacity duration-base",
        showButton 
          ? "opacity-100" 
          : "opacity-0 invisible"
      )}
    >
      <button
        onClick={handleClick}
        className={cn(
          "pointer-events-auto flex h-11 items-center gap-2 px-5 rounded-md",
          "bg-primary text-primary-foreground font-semibold text-base hover:bg-primary-hover",
          "shadow-overlay",
          "touch-manipulation"
        )}
        aria-label={t('floatingUpload.seeReportAriaLabel')}
      >
        <FileText aria-hidden="true" className="w-5 h-5" />
        <span>{t('floatingUpload.seeReport')}</span>
      </button>
    </div>
  );
}