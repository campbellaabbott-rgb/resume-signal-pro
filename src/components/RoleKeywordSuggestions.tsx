import { useTranslation } from "react-i18next";
// Role-specific keyword suggestions component
// Shows keywords tailored to detected/target job title

import { CheckCircle2, XCircle, Target, ChevronDown, ChevronUp, Star, Zap, Award, Briefcase } from "lucide-react";
import { useState } from "react";
import { findRoleConfig, analyzeRoleKeywords, RoleKeyword, RoleKeywordConfig } from "@/config/role-keywords";
import { cn } from "@/lib/utils";

interface RoleKeywordSuggestionsProps {
  currentRole?: string | null;
  targetRole?: string | null;
  resumeText?: string;
  className?: string;
}

const categoryConfig = {
  core: { icon: Target, label: 'Core', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' },
  advanced: { icon: Zap, label: 'Advanced', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  differentiator: { icon: Star, label: 'Standout', color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
};

export function RoleKeywordSuggestions({
  const { t } = useTranslation(); 
  currentRole,
  targetRole,
  resumeText,
  className 
}: RoleKeywordSuggestionsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Use target role if available, otherwise current role
  const roleToAnalyze = targetRole || currentRole;
  
  if (!roleToAnalyze || !resumeText) {
    return null;
  }

  const { present, missing, config } = analyzeRoleKeywords(roleToAnalyze, resumeText);
  
  // If no matching role config, don't render
  if (!config) {
    return null;
  }

  const coreMissing = missing.filter(k => k.category === 'core');
  const advancedMissing = missing.filter(k => k.category === 'advanced');
  const differentiatorMissing = missing.filter(k => k.category === 'differentiator');
  
  const presentCount = present.length;
  const totalCount = config.keywords.length;
  const coveragePercent = Math.round((presentCount / totalCount) * 100);
  
  // Determine status
  const hasCoreGaps = coreMissing.length > 0;
  const hasAdvancedGaps = advancedMissing.length > 0;

  return (
    <div className={cn(
      "rounded-xl border p-4",
      hasCoreGaps 
        ? "bg-primary/5 border-primary/20" 
        : hasAdvancedGaps 
          ? "bg-amber-500/5 border-amber-500/20"
          : "bg-success/5 border-success/20",
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-sm">{t('roleKeywords.title', { role: config.title })}</h4>
            {targetRole && targetRole !== currentRole && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{t('roleKeywords.targetRole')}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {hasCoreGaps 
              ? `Missing ${coreMissing.length} core keyword${coreMissing.length > 1 ? 's' : ''} that ${config.title}s are expected to have`
              : hasAdvancedGaps
                ? `Good foundation! Add ${advancedMissing.length} advanced keyword${advancedMissing.length > 1 ? 's' : ''} to stand out`
                : 'Excellent role-specific keyword coverage!'
            }
          </p>
        </div>
        
        {/* Coverage badge */}
        <div className="flex flex-col items-end">
          <span className={cn(
            "text-2xl font-bold",
            coveragePercent >= 75 ? "text-success" : coveragePercent >= 50 ? "text-amber-500" : "text-primary"
          )}>
            {presentCount}/{totalCount}
          </span>
          <span className="text-xs text-muted-foreground">{t('roleKeywords.keywords')}</span>
        </div>
      </div>

      {/* Core missing keywords - priority */}
      {coreMissing.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Target className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">
              Core keywords to add
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {coreMissing.map((keyword) => (
              <RoleKeywordBadge key={keyword.keyword} keyword={keyword} isMissing />
            ))}
          </div>
        </div>
      )}

      {/* Advanced missing keywords */}
      {advancedMissing.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-amber-500">
              Advanced skills to highlight
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {advancedMissing.slice(0, 4).map((keyword) => (
              <RoleKeywordBadge key={keyword.keyword} keyword={keyword} isMissing />
            ))}
            {advancedMissing.length > 4 && (
              <span className="text-xs text-muted-foreground px-2 py-1">
                +{advancedMissing.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Differentiator suggestions */}
      {differentiatorMissing.length > 0 && coreMissing.length === 0 && (
        <div className="mb-3 p-2.5 rounded-lg bg-purple-500/5 border border-purple-500/20">
          <div className="flex items-center gap-1.5 mb-2">
            <Star className="w-3.5 h-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-purple-500">
              Stand out from other candidates
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {differentiatorMissing.slice(0, 3).map((keyword) => (
              <RoleKeywordBadge key={keyword.keyword} keyword={keyword} isMissing />
            ))}
          </div>
        </div>
      )}

      {/* Found keywords - collapsible */}
      {presentCount > 0 && (
        <div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            <span>{presentCount} role-specific keywords found</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          
          {isExpanded && (
            <div className="mt-2 flex flex-wrap gap-1.5 animate-fade-in">
              {present.map((keyword) => (
                <RoleKeywordBadge key={keyword.keyword} keyword={keyword} isMissing={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual keyword badge with tooltip
function RoleKeywordBadge({ 
  keyword, 
  isMissing 
}: { 
  keyword: RoleKeyword; 
  isMissing: boolean;
}) {
  const config = categoryConfig[keyword.category];
  const Icon = config.icon;
  
  return (
    <div 
      className={cn(
        "group relative inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors cursor-help",
        isMissing
          ? cn(config.bg, config.color, "border", config.border)
          : "bg-success/10 text-success border border-success/30"
      )}
      title={keyword.reason}
    >
      {isMissing ? (
        <XCircle className="w-3 h-3" />
      ) : (
        <CheckCircle2 className="w-3 h-3" />
      )}
      <span>{keyword.keyword}</span>
      <Icon className="w-3 h-3 opacity-60" />
      
      {/* Hover tooltip with reason */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded bg-popover border border-border shadow-lg text-xs text-popover-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
        {keyword.reason}
      </div>
    </div>
  );
}
