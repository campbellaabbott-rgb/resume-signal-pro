import { ArrowDown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScanGuideArrowProps {
  isVisible: boolean;
  message?: string;
}

export function ScanGuideArrow({ isVisible, message = "Scroll down to scan" }: ScanGuideArrowProps) {
  if (!isVisible) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-4 animate-fade-in">
      {/* Pulsing arrow container */}
      <div className="relative flex flex-col items-center">
        {/* Message */}
        <p className="text-sm font-medium text-primary mb-2 animate-pulse">
          {message}
        </p>
        
        {/* Triple bouncing arrows */}
        <div className="flex flex-col items-center gap-0">
          <ChevronDown 
            className="w-6 h-6 text-primary animate-bounce" 
            style={{ animationDelay: '0ms' }}
          />
          <ChevronDown 
            className="w-6 h-6 text-primary/70 animate-bounce -mt-3" 
            style={{ animationDelay: '100ms' }}
          />
          <ChevronDown 
            className="w-6 h-6 text-primary/40 animate-bounce -mt-3" 
            style={{ animationDelay: '200ms' }}
          />
        </div>
      </div>
    </div>
  );
}

// Inline arrow that points to the scan button area
export function InlineScanArrow({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-success", className)}>
      <ArrowDown className="w-5 h-5 animate-bounce" />
      <span className="text-sm font-medium">Tap below to scan</span>
      <ArrowDown className="w-5 h-5 animate-bounce" />
    </div>
  );
}
