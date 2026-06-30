import { useTranslation } from "react-i18next";
// Industry-specific keyword suggestions component
// Shows which important industry keywords are present/missing in the resume

import { CheckCircle2, XCircle, Sparkles, ChevronDown, ChevronUp, AlertTriangle, Award, Wrench, Brain, Workflow } from "lucide-react";
import { useState } from "react";
import { findIndustryConfig, analyzeKeywordPresence, IndustryKeyword } from "@/config/industry-keywords";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface IndustryKeywordSuggestionsProps {
  industry: string;
  resumeText?: string;
  className?: string;
}

const categoryIcons: Record<string, typeof Award> = {
  technical: Brain,
  soft: Sparkles,
  certification: Award,
  tool: Wrench,
  methodology: Workflow,
};

const categoryLabels: Record<string, string> = {
  technical: 'Technical',
  soft: 'Soft Skill',
  certification: 'Certification',
  tool: 'Tool',
  methodology: 'Methodology',
};

export function IndustryKeywordSuggestions({
  industry, 
  resumeText,
  className 
}: IndustryKeywordSuggestionsProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  
  const config = findIndustryConfig(industry);
  
  // If no matching industry config, don't render
  if (!config) {
    return null;
  }

  // Analyze keywords if resume text provided
  const analysis = resumeText 
    ? analyzeKeywordPresence(industry, resumeText)
    : { present: [], missing: config.keywords };
  
  const criticalMissing = analysis.missing.filter(k => k.importance === 'critical');
  const highMissing = analysis.missing.filter(k => k.importance === 'high');
  const presentCount = analysis.present.length;
  const totalCount = config.keywords.length;
  const coveragePercent = Math.round((presentCount / totalCount) * 100);

  // Determine overall status
  const hasCriticalGaps = criticalMissing.length > 0;
  const hasHighGaps = highMissing.length > 0;

  return (
    <div className={cn(
      "rounded-xl border p-4",
      hasCriticalGaps 
        ? "bg-destructive/5 border-destructive/20" 
        : hasHighGaps 
          ? "bg-warning/5 border-warning/20"
          : "bg-success/5 border-success/20",
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className={cn(
              "w-4 h-4",
              hasCriticalGaps ? "text-destructive" : hasHighGaps ? "text-warning" : "text-success"
            )} />
            <h4 className="font-semibold text-sm">{t('industryKeywords.title', { industry: config.name })}</h4>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-medium",
              hasCriticalGaps 
                ? "bg-destructive/10 text-destructive" 
                : hasHighGaps 
                  ? "bg-warning/10 text-warning"
                  : "bg-success/10 text-success"
            )}>{t('industryKeywords.found', { present: presentCount, total: totalCount })}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {hasCriticalGaps 
              ? `${criticalMissing.length} keyword${criticalMissing.length > 1 ? 's' : ''} not explicitly stated — ATS optimization opportunity`
              : hasHighGaps
                ? `Good coverage — ${highMissing.length} high-impact keyword${highMissing.length > 1 ? 's' : ''} could strengthen your match`
                : 'Great keyword coverage for your industry!'
            }
          </p>
        </div>
        
        {/* Coverage indicator */}
        <div className="flex flex-col items-end">
          <span className={cn(
            "text-2xl font-bold",
            coveragePercent >= 70 ? "text-success" : coveragePercent >= 40 ? "text-warning" : "text-destructive"
          )}>
            {coveragePercent}%
          </span>
          <span className="text-xs text-muted-foreground">{t('industryKeywords.coverage')}</span>
        </div>
      </div>

      {/* Critical missing keywords - always show */}
      {criticalMissing.length > 0 && (
        <div className="mb-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-xs font-semibold text-warning uppercase tracking-wider">
              Not Explicitly Stated (ATS Opportunity)
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {criticalMissing.map((keyword) => (
              <KeywordBadge key={keyword.keyword} keyword={keyword} isMissing />
            ))}
          </div>
        </div>
      )}

      {/* High priority missing - show top 5 */}
      {highMissing.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            High-impact keywords to add:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {highMissing.slice(0, 5).map((keyword) => (
              <KeywordBadge key={keyword.keyword} keyword={keyword} isMissing />
            ))}
            {highMissing.length > 5 && (
              <span className="text-xs text-muted-foreground px-2 py-1">
                +{highMissing.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Present keywords - collapsed by default */}
      {presentCount > 0 && (
        <div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            <span>{presentCount} keywords found in your resume</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          
          {isExpanded && (
            <div className="mt-2 flex flex-wrap gap-1.5 animate-fade-in">
              {analysis.present.map((keyword) => (
                <KeywordBadge key={keyword.keyword} keyword={keyword} isMissing={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual keyword badge component
function KeywordBadge({ 
  keyword, 
  isMissing 
}: { 
  keyword: IndustryKeyword; 
  isMissing: boolean;
}) {
  const Icon = categoryIcons[keyword.category] || Sparkles;
  
  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors",
      isMissing
        ? keyword.importance === 'critical'
          ? "bg-destructive/10 text-destructive border border-destructive/30"
          : keyword.importance === 'high'
            ? "bg-warning/10 text-warning border border-warning/30"
            : "bg-muted text-muted-foreground border border-border"
        : "bg-success/10 text-success border border-success/30"
    )}>
      {isMissing ? (
        <XCircle className="w-3 h-3" />
      ) : (
        <CheckCircle2 className="w-3 h-3" />
      )}
      <span>{keyword.keyword}</span>
      <Icon className="w-3 h-3 opacity-60" />
    </div>
  );
}
