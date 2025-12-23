import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface FloatingUploadButtonProps {
  hasContent?: boolean;
}

export function FloatingUploadButton({ hasContent = false }: FloatingUploadButtonProps) {
  const isMobile = useIsMobile();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!hasContent) {
      setIsVisible(false);
      return;
    }

    const handleScroll = () => {
      // Find the free scan button container
      const scanButton = document.querySelector('[data-scan-button="true"]');
      if (!scanButton) return;

      const rect = scanButton.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // Show floating button when scan button is not visible
      const isScanButtonVisible = rect.top < viewportHeight - 50 && rect.bottom > 50;
      setIsVisible(!isScanButtonVisible);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [hasContent]);

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
        "fixed z-50 flex items-center gap-2 px-5 py-3 rounded-full",
        "bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground font-bold text-sm",
        "shadow-xl shadow-success/40 hover:shadow-2xl hover:shadow-success/50",
        "transition-all duration-300 touch-manipulation",
        "animate-pulse-subtle",
        isMobile 
          ? "bottom-20 left-1/2 -translate-x-1/2" 
          : "bottom-6 right-6",
        isVisible 
          ? "translate-y-0 opacity-100" 
          : "translate-y-24 opacity-0 pointer-events-none"
      )}
      aria-label="Scroll to free scan button"
    >
      <Zap className="w-4 h-4 fill-current" />
      <span>Scan Now – FREE</span>
    </button>
  );
}