import { useEffect, useState } from "react";
import { 
  Sparkles, RefreshCw, Loader2, Zap, HelpCircle, X,
  Briefcase, TrendingUp, AlertTriangle, CheckCircle2, FileCheck, Target, Award
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ScoreHeroProps {
  candidateName?: string | null;
  currentRole?: string;
  industry: string;
  atsScoreEstimate: number;
  experienceLevel: { level: string; yearsEstimate: string };
  formatGrade: string;
  redFlagsCount: number;
  keywordsCount: number;
  quickWinsCount: number;
  quantificationScore?: number;
  bulletImpactScore?: number;
  isCached?: boolean;
  onForceReanalyze?: () => void;
  isLoading?: boolean;
  eliteSignalsCount?: number;
}

const getExperienceLevelLabel = (level: string) => {
  if (level === "entry") return "Entry Level";
  if (level === "mid") return "Mid Level";
  if (level === "senior") return "Senior";
  return "Executive";
};

// Reframes the existing, already-calibrated score into outcome language —
// deliberately hedged ("likely", "at risk") rather than a fabricated precise
// probability. The score itself doesn't change; this only translates the same
// tier thresholds RadialGauge already uses into what actually matters to the
// person reading it: will this get filtered out before a human sees it.
const getOutcomeMessage = (score: number): { text: string; status: "success" | "warning" | "destructive" } => {
  if (score >= 85) return { text: "Strong candidate for clearing automated screening", status: "success" };
  if (score >= 70) return { text: "Likely to clear most automated screens", status: "success" };
  if (score >= 50) return { text: "At risk of being filtered by stricter ATS systems", status: "warning" };
  return { text: "High risk of being filtered before a human sees it", status: "destructive" };
};

// SVG radial gauge component
function RadialGauge({ score, size = 140, strokeWidth = 10 }: { score: number; size?: number; strokeWidth?: number }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Show 270 degrees of arc (3/4 circle)
  const arcLength = circumference * 0.75;
  const offset = arcLength - (arcLength * animatedScore) / 100;

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  // Bands match the scoring rubric in free-keyword-scan/index.ts (85/70/50) so the
  // visual treatment doesn't soften a score the model has already judged as weak.
  const getColor = () => {
    if (score >= 70) return "hsl(var(--success))";
    if (score >= 50) return "hsl(var(--warning))";
    return "hsl(var(--destructive))";
  };

  const getLabel = () => {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 50) return "Needs Improvement";
    return "Poor";
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform rotate-[135deg]"
      >
        {/* Background arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Score arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
          style={{ filter: `drop-shadow(0 0 6px ${getColor()}40)` }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-bold tabular-nums transition-colors duration-500"
          style={{ color: getColor() }}
        >
          {animatedScore}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-0.5">
          {getLabel()}
        </span>
      </div>
    </div>
  );
}

// Mini stat pill
function StatPill({ 
  icon: Icon, 
  label, 
  value, 
  status 
}: { 
  icon: typeof Award; 
  label: string; 
  value: string; 
  status: "success" | "warning" | "destructive" | "muted";
}) {
  const statusColors = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  };

  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className={cn("flex items-center gap-1", statusColors[status])}>
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider truncate">
        {label}
      </span>
    </div>
  );
}

export function ScoreHero({
  candidateName,
  currentRole,
  industry,
  atsScoreEstimate,
  experienceLevel,
  formatGrade,
  redFlagsCount,
  keywordsCount,
  quickWinsCount,
  quantificationScore,
  bulletImpactScore,
  isCached,
  onForceReanalyze,
  isLoading,
  eliteSignalsCount = 0,
}: ScoreHeroProps) {
  const { t } = useTranslation();

  const gradeStatus = (grade: string): "success" | "warning" | "destructive" => {
    if (grade === "A" || grade === "B") return "success";
    if (grade === "C") return "warning";
    return "destructive";
  };

  const firstName = candidateName?.split(" ")[0];
  const displayIndustry = industry.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="mb-6">
      {/* Cached notice */}
      {isCached && onForceReanalyze && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 mb-4 rounded-lg border border-border bg-card/50">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span>Showing saved results</span>
          </div>
          <div className="h-3.5 w-px bg-border" />
          <button
            onClick={() => {
              supabase.functions.invoke('track-ab-event', {
                body: {
                  testName: 'cache_reanalyze',
                  variant: 'button_click',
                  eventType: 'conversion',
                  visitorId: localStorage.getItem('ab_visitor_id') || crypto.randomUUID(),
                  metadata: { source: 'score_hero' }
                }
              }).catch(console.error);
              onForceReanalyze();
            }}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Re-analyze
          </button>
        </div>
      )}

      {/* Main hero card */}
      <div className="rounded-2xl border border-border bg-card p-6">
        {/* Top row: badge */}
        <div className="flex items-center justify-between mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            Analysis Complete
          </div>
          {eliteSignalsCount > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 text-warning text-xs font-semibold">
              <Award className="w-3.5 h-3.5" />
              {eliteSignalsCount} elite signal{eliteSignalsCount > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Center: Gauge + info */}
        <div className="flex items-center gap-6 sm:gap-8">
          {/* Radial gauge */}
          <div className="shrink-0">
            <RadialGauge score={atsScoreEstimate} />
          </div>

          {/* Info block */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg sm:text-xl font-bold text-foreground mb-1 truncate">
              {firstName
                ? `${firstName}, here's your score`
                : "Your Resume Score"
              }
            </h3>
            {(() => {
              const outcome = getOutcomeMessage(atsScoreEstimate);
              const outcomeColor = outcome.status === "success" ? "text-success" : outcome.status === "warning" ? "text-warning" : "text-destructive";
              return (
                <p className={cn("text-sm font-medium mb-2", outcomeColor)}>
                  {outcome.text}
                </p>
              );
            })()}
            {currentRole && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-lg bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
                <Briefcase className="w-3 h-3" />
                <span className="text-muted-foreground">Current Role:</span>
                <span className="font-semibold truncate max-w-[200px]">{currentRole}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground mb-3">
              <span className="text-foreground/80">{displayIndustry}</span>
              <span className="text-border">•</span>
              <span>{getExperienceLevelLabel(experienceLevel.level)}</span>
            </div>

            {/* Quick status row */}
            <div className="flex items-center gap-3 text-xs">
              {redFlagsCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                  <AlertTriangle className="w-3 h-3" />
                  {redFlagsCount} issue{redFlagsCount > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  No red flags
                </span>
              )}
              {quickWinsCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  <TrendingUp className="w-3 h-3" />
                  {quickWinsCount} quick fix{quickWinsCount > 1 ? "es" : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Bottom stats strip */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
            <StatPill
              icon={FileCheck}
              label="Format"
              value={formatGrade}
              status={gradeStatus(formatGrade)}
            />
            <StatPill
              icon={Target}
              label="Keywords"
              value={`${keywordsCount}`}
              status={keywordsCount > 6 ? "destructive" : keywordsCount > 3 ? "warning" : "success"}
            />
            <StatPill
              icon={TrendingUp}
              label="Metrics"
              value={quantificationScore !== undefined ? `${quantificationScore}%` : "—"}
              status={
                quantificationScore === undefined ? "muted"
                : quantificationScore >= 60 ? "success"
                : quantificationScore >= 40 ? "warning"
                : "destructive"
              }
            />
            <StatPill
              icon={Briefcase}
              label="Impact"
              value={bulletImpactScore !== undefined ? `${bulletImpactScore}%` : "—"}
              status={
                bulletImpactScore === undefined ? "muted"
                : bulletImpactScore >= 60 ? "success"
                : bulletImpactScore >= 40 ? "warning"
                : "destructive"
              }
            />
            {/* 5th stat only on sm+ */}
            <div className="hidden sm:flex">
              <StatPill
                icon={AlertTriangle}
                label="Flags"
                value={`${redFlagsCount}`}
                status={redFlagsCount === 0 ? "success" : redFlagsCount <= 2 ? "warning" : "destructive"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
