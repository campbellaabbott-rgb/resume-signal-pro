import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AISummaryProps {
  candidateName?: string | null;
  atsScore: number;
  formatGrade: string;
  industry: string;
  experienceLevel: string;
  topStrength: string;
  redFlagsCount: number;
  quickWins?: { fix: string; timeEstimate: string; impact: string }[];
  improvementPotential?: { level: string; estimatedScoreIncrease: number; topPriority: string };
  resumeHash?: string;
}

export function AISummary({
  candidateName,
  atsScore,
  formatGrade,
  industry,
  experienceLevel,
  topStrength,
  redFlagsCount,
  quickWins,
  improvementPotential,
  resumeHash
}: AISummaryProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasAttemptedRef = useRef(false);

  useEffect(() => {
    hasAttemptedRef.current = false;
    setSummary(null);

    // Cache is only safe to use when we have a resume-specific key;
    // without it, different resumes with the same score/industry would collide.
    const cacheKey = resumeHash ? `ai_summary_${resumeHash}_${industry}` : null;
    const cached = cacheKey ? localStorage.getItem(cacheKey) : null;

    if (cached) {
      try {
        const { summary: cachedSummary, timestamp } = JSON.parse(cached);
        // Cache valid for 1 hour
        if (Date.now() - timestamp < 60 * 60 * 1000) {
          setSummary(cachedSummary);
          hasAttemptedRef.current = true;
          return;
        }
      } catch (e) {
        // Invalid cache, continue to fetch
      }
    }

    const generateSummary = async () => {
      if (hasAttemptedRef.current) return;

      setIsLoading(true);
      hasAttemptedRef.current = true;

      try {
        const { data, error } = await supabase.functions.invoke('generate-summary', {
          body: {
            candidateName,
            atsScore,
            formatGrade,
            industry,
            experienceLevel,
            topStrength,
            redFlagsCount,
            quickWins,
            improvementPotential
          }
        });

        if (error) {
          console.error('Summary generation error:', error);
          return;
        }

        if (data?.summary) {
          setSummary(data.summary);
          if (cacheKey) {
            localStorage.setItem(cacheKey, JSON.stringify({
              summary: data.summary,
              timestamp: Date.now()
            }));
          }
        }
      } catch (err) {
        console.error('Failed to generate summary:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // Small delay to not block initial render
    const timer = setTimeout(generateSummary, 500);
    return () => clearTimeout(timer);
  }, [resumeHash, atsScore, industry]);

  if (!summary && !isLoading) return null;

  const displayName = candidateName?.split(' ')[0] || null;
  
  return (
    <div className={cn(
      "rounded-2xl p-5 mb-6 border-2 transition-all duration-500",
      "bg-gradient-to-br from-primary/5 via-primary/3 to-transparent",
      "border-primary/20"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "p-2 rounded-xl shrink-0",
          "bg-primary/10"
        )}>
          {isLoading ? (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          ) : (
            <Sparkles className="w-5 h-5 text-primary" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="font-semibold text-foreground">
              {displayName ? `${displayName}'s ${t('aiSummary.title')}` : t('aiSummary.yourTitle')}
            </h4>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('aiSummary.aiCoach')}
            </span>
          </div>
          
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-muted/50 rounded animate-pulse w-full" />
              <div className="h-4 bg-muted/50 rounded animate-pulse w-3/4" />
              <p className="text-xs text-muted-foreground/60 mt-1">{t('aiSummary.crafting')}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
