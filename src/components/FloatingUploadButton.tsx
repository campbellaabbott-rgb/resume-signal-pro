import { useState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function FloatingUploadButton() {
  const isMobile = useIsMobile();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isMobile) return;

    const handleScroll = () => {
      const uploadSection = document.getElementById('upload');
      if (!uploadSection) return;

      const rect = uploadSection.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      
      // Show button when upload section is not fully visible
      // Either scrolled past it OR not yet scrolled to it (below fold)
      const isUploadVisible = rect.top < viewportHeight - 100 && rect.bottom > 100;
      setIsVisible(!isUploadVisible && window.scrollY > 200);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [isMobile]);

  const handleClick = () => {
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isMobile) return null;

  return (
    <button
      onClick={handleClick}
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-6 py-4 rounded-full",
        "bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground font-bold text-base",
        "shadow-xl shadow-success/40 hover:shadow-2xl hover:shadow-success/50",
        "transition-all duration-300 touch-manipulation",
        "animate-pulse-subtle",
        isVisible 
          ? "translate-y-0 opacity-100" 
          : "translate-y-24 opacity-0 pointer-events-none"
      )}
      aria-label="Scan your resume now"
    >
      <Sparkles className="w-5 h-5" />
      <span>Scan My Resume FREE</span>
    </button>
  );
}