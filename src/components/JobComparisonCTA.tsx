import { ArrowRight, Briefcase, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface JobComparisonCTAProps {
  jobTitles: string[];
  onGetStarted: (jobTitle?: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function JobComparisonCTA({ 
  jobTitles, 
  onGetStarted, 
  isLoading,
  className 
}: JobComparisonCTAProps) {
  const { t } = useTranslation();
  if (!jobTitles.length) return null;

  // Show up to 3 job CTAs
  const displayedJobs = jobTitles.slice(0, 3);
  const remainingCount = jobTitles.length - 3;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4 text-primary" />
        <span>{t('jobComparisonCTA.compareToRoles')}</span>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {displayedJobs.map((title, index) => (
          <Button
            key={index}
            variant="outline"
            size="sm"
            onClick={() => onGetStarted(title)}
            disabled={isLoading}
            className="group border-primary/30 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <Briefcase className="w-3.5 h-3.5 mr-1.5 text-primary" />
            <span className="truncate max-w-[200px]">{title}</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
          </Button>
        ))}
        
        {remainingCount > 0 && (
          <span className="inline-flex items-center text-xs text-muted-foreground px-2">
            +{remainingCount} more
          </span>
        )}
      </div>
    </div>
  );
}
