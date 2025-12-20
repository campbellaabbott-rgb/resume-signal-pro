import { useState, useEffect } from "react";
import { Upload } from "lucide-react";
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
      // Show button when upload section is scrolled out of view (above viewport)
      const shouldShow = rect.bottom < 100;
      setIsVisible(shouldShow);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial state

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
        "fixed bottom-20 right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full",
        "bg-success text-success-foreground font-semibold text-sm",
        "shadow-lg shadow-success/30 hover:shadow-xl hover:shadow-success/40",
        "transition-all duration-300 touch-manipulation",
        isVisible 
          ? "translate-y-0 opacity-100" 
          : "translate-y-16 opacity-0 pointer-events-none"
      )}
      aria-label="Upload your resume"
    >
      <Upload className="w-4 h-4" />
      <span>Upload Resume</span>
    </button>
  );
}