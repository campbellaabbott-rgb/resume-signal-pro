import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingUploadButtonProps {
  hasContent?: boolean;
}

export function FloatingUploadButton({ hasContent = false }: FloatingUploadButtonProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);

  useEffect(() => {
    if (!hasContent) {
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
  }, [hasContent]);

  useEffect(() => {
    if (!hasContent || justUploaded) return;

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
  }, [hasContent, justUploaded]);

  const handleClick = () => {
    const scanButton = document.querySelector('[data-scan-button="true"]');
    if (scanButton) {
      scanButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (!hasContent) return null;

  return (
    <button
      onClick={handleClick}
      className={cn(
        "fixed z-50 flex items-center gap-2 px-6 py-4 rounded-full",
        "bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground font-bold text-base",
        "shadow-xl shadow-success/40 hover:shadow-2xl hover:shadow-success/50",
        "transition-all duration-300 touch-manipulation",
        justUploaded && "animate-bounce",
        // Center on all devices for better visibility
        "bottom-24 left-1/2 -translate-x-1/2",
        isVisible 
          ? "translate-y-0 opacity-100" 
          : "translate-y-24 opacity-0 pointer-events-none"
      )}
      aria-label="Scroll to free scan button"
    >
      <Zap className="w-5 h-5 fill-current" />
      <span>Scan Now – FREE</span>
    </button>
  );
}