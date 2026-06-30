import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  Target, CheckCircle2, XCircle, AlertTriangle, Lightbulb,
  ChevronDown, ChevronUp, Copy, Check, Sparkles,
  Briefcase, Star, Zap, TrendingUp, FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

export interface MissingSkillDetail {
  skill: string;
  category: "hard_skill" | "soft_skill" | "tool" | "certification" | "methodology";
  importance: "critical" | "important" | "nice_to_have";
  isImplicit: boolean;
  fixSuggestion: string;
}

interface JobKeywordMatcherProps {
  jobTitle?: string;
  jobCompany?: string;
  matchingSkills?: string[];
  missingSkillsDetailed?: MissingSkillDetail[];
  matchScore?: number;
  className?: string;
}

const categoryMeta: Record<MissingSkillDetail["category"], { label: string; icon: typeof Zap }> = {
  hard_skill: { label: "Technical Skills", icon: Zap },
  soft_skill: { label: "Soft Skills", icon: Star },
  tool: { label: "Tools & Software", icon: Briefcase },
  certification: { label: "Certifications", icon: FileText },
  methodology: { label: "Methodologies", icon: TrendingUp },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-muted transition-colors" title={t('jobKeywordMatcher.copySuggestion')}>
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

// This matching is grounded entirely in the same AI call that read the full resume
// and job description together (see free-keyword-scan's missingSkillsDetailed /
// matchingSkills fields) — there is no separate keyword-pattern engine here. That
// means a skill phrased differently in the resume (a synonym, a related tool, an
// implicit demonstration through other experience) is judged correctly instead of
// requiring an exact substring match.
export function JobKeywordMatcher({
  jobTitle,
  jobCompany,
  matchingSkills = [],
  missingSkillsDetailed = [],
  matchScore,
  className
}: JobKeywordMatcherProps) {
  const { t } = useTranslation();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["hard_skill"]));
  const [showAllCritical, setShowAllCritical] = useState(false);

  const criticalMissing = missingSkillsDetailed.filter((m) => m.importance === "critical");
  const importantMissing = missingSkillsDetailed.filter((m) => m.importance === "important");

  const groupedByCategory = missingSkillsDetailed.reduce<Record<string, MissingSkillDetail[]>>((acc, skill) => {
    (acc[skill.category] ??= []).push(skill);
    return acc;
  }, {});

  const overallMatchRate = matchScore ?? 0;

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  if (matchingSkills.length === 0 && missingSkillsDetailed.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with overall score */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              Job Match Analysis
            </h3>
            {jobTitle && (
              <p className="text-sm text-muted-foreground mt-1">
                Matching against: <span className="font-medium text-foreground">{jobTitle}</span>
                {jobCompany && <span className="text-muted-foreground"> at {jobCompany}</span>}
              </p>
            )}
          </div>
          <div className={cn(
            "px-4 py-2 rounded-xl font-bold text-2xl",
            overallMatchRate >= 70 ? "bg-success/10 text-success" :
            overallMatchRate >= 50 ? "bg-warning/10 text-warning" :
            "bg-destructive/10 text-destructive"
          )}>
            {overallMatchRate}%
          </div>
        </div>

        <Progress
          value={overallMatchRate}
          className={cn(
            "h-3",
            overallMatchRate >= 70 ? "[&>div]:bg-success" :
            overallMatchRate >= 50 ? "[&>div]:bg-warning" :
            "[&>div]:bg-destructive"
          )}
        />

        <div className="flex flex-wrap gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span><strong>{matchingSkills.length}</strong>{t('jobKeywordMatcher.matched')}</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-destructive" />
            <span><strong>{criticalMissing.length}</strong>{t('jobKeywordMatcher.criticalGaps')}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span><strong>{importantMissing.length}</strong>{t('jobKeywordMatcher.importantGaps')}</span>
          </div>
        </div>
      </div>

      {/* Critical Missing Skills */}
      {criticalMissing.length > 0 && (
        <div className="p-5 rounded-xl bg-destructive/5 border border-destructive/20">
          <h4 className="font-bold text-destructive flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4" />
            Critical Gaps ({criticalMissing.length})
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            These are essential for this role and genuinely don't appear in your resume — not just phrased
            differently. Address these first.
          </p>
          <div className="space-y-3">
            {criticalMissing.slice(0, showAllCritical ? undefined : 5).map((skill, i) => (
              <div key={i} className="p-3 rounded-lg bg-background border border-border">
                <div className="flex items-start justify-between mb-2 gap-2">
                  <span className="font-semibold text-foreground">{skill.skill}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium shrink-0">
                    {categoryMeta[skill.category]?.label || skill.category.replace("_", " ")}
                  </span>
                </div>
                {skill.isImplicit && (
                  <p className="text-xs text-muted-foreground mb-2 italic">
                    Implied by related experience, but not stated explicitly — ATS keyword scanners won't credit it.
                  </p>
                )}
                {skill.fixSuggestion && (
                  <div className="flex items-start gap-2 mt-2 p-2 rounded bg-success/5 border border-success/20">
                    <Lightbulb className="w-3 h-3 text-success mt-0.5 shrink-0" />
                    <span className="text-xs text-foreground flex-1">{skill.fixSuggestion}</span>
                    <CopyButton text={skill.fixSuggestion} />
                  </div>
                )}
              </div>
            ))}
          </div>
          {criticalMissing.length > 5 && (
            <Button variant="ghost" size="sm" onClick={() => setShowAllCritical(!showAllCritical)} className="mt-3 w-full">
              {showAllCritical ? (
                <>Show Less <ChevronUp className="w-4 h-4 ml-1" /></>
              ) : (
                <>Show All {criticalMissing.length} Critical Gaps <ChevronDown className="w-4 h-4 ml-1" /></>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Matched Skills */}
      {matchingSkills.length > 0 && (
        <div className="p-5 rounded-xl bg-success/5 border border-success/20">
          <h4 className="font-bold text-success flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4" />
            Skills You Already Have ({matchingSkills.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {matchingSkills.map((skill, i) => (
              <span key={i} className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3" />
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      {Object.keys(groupedByCategory).length > 0 && (
        <div className="space-y-3">
          <h4 className="font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Gaps by Category
          </h4>

          {Object.entries(groupedByCategory).map(([category, skills]) => {
            const meta = categoryMeta[category as MissingSkillDetail["category"]];
            const Icon = meta?.icon || Zap;
            const isExpanded = expandedCategories.has(category);

            return (
              <div key={category} className="rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full p-4 flex items-center justify-between bg-card hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{meta?.label || category}</span>
                    <span className="text-xs text-muted-foreground">({skills.length} gap{skills.length > 1 ? "s" : ""})</span>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {isExpanded && (
                  <div className="p-4 pt-2 bg-card border-t border-border space-y-2">
                    {skills.map((skill, i) => (
                      <div key={i} className="p-2 rounded-lg text-sm flex items-start gap-2 bg-muted/50 border border-border">
                        <XCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-foreground">{skill.skill}</span>
                          <span className={cn(
                            "ml-2 text-[10px] px-1.5 py-0.5 rounded-full",
                            skill.importance === "critical" ? "bg-destructive/10 text-destructive" :
                            skill.importance === "important" ? "bg-warning/10 text-warning" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {skill.importance.replace("_", " ")}
                          </span>
                          {skill.fixSuggestion && (
                            <p className="text-xs text-muted-foreground mt-0.5">{skill.fixSuggestion}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Action Summary */}
      {criticalMissing.length > 0 && (
        <div className="p-5 rounded-xl bg-primary/5 border border-primary/20">
          <h4 className="font-bold text-foreground flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-primary" />
            Top {Math.min(3, criticalMissing.length)} Actions to Improve Your Match
          </h4>
          <ol className="space-y-2">
            {criticalMissing.slice(0, 3).map((skill, i) => (
              <li key={i} className="flex items-start gap-3 text-sm">
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div>
                  <span className="font-medium">Add "{skill.skill}"</span>
                  {skill.fixSuggestion && <span className="text-muted-foreground"> — {skill.fixSuggestion}</span>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
