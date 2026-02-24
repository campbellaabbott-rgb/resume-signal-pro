import { Lock, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LockedPremiumInsightProps {
  title: string;
  description: string;
  /** Fake preview content shown blurred behind the lock */
  previewLines?: string[];
  onUnlock: () => void;
  isLoading?: boolean;
  className?: string;
  variant?: "default" | "highlight";
}

export function LockedPremiumInsight({
  title,
  description,
  previewLines = [
    "• Replace 'Responsible for managing...' → 'Drove $2.4M revenue...'",
    "• Add quantified metrics to 4 bullet points in Experience section",
    "• Include 3 missing industry certifications: PMP, CSM, ITIL",
    "• Restructure Summary to lead with strongest achievement",
  ],
  onUnlock,
  isLoading,
  className,
  variant = "default",
}: LockedPremiumInsightProps) {
  return (
    <div className={cn(
      "relative rounded-2xl border overflow-hidden",
      variant === "highlight" 
        ? "border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/5" 
        : "border-border bg-card",
      className
    )}>
      {/* Blurred preview content */}
      <div className="p-5 space-y-2.5 select-none" aria-hidden="true">
        <div className="flex items-center gap-2 mb-3">
          <div className={cn(
            "p-1.5 rounded-lg",
            variant === "highlight" ? "bg-primary/20" : "bg-muted"
          )}>
            <Sparkles className={cn(
              "w-4 h-4",
              variant === "highlight" ? "text-primary" : "text-muted-foreground"
            )} />
          </div>
          <h4 className="font-bold text-foreground">{title}</h4>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wider">
            Premium
          </span>
        </div>
        
        {/* Fake content lines with blur */}
        <div className="space-y-2 blur-[6px] pointer-events-none">
          {previewLines.map((line, i) => (
            <p key={i} className="text-sm text-muted-foreground leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-background via-background/80 to-transparent">
        <div className="text-center space-y-3 px-6 max-w-sm">
          <div className="mx-auto w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
          <Button
            onClick={onUnlock}
            disabled={isLoading}
            size="sm"
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Unlock Full Report
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
