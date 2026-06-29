import { cn } from "@/lib/utils";
import { TrendingUp, Users, Award, Target } from "lucide-react";
import { INDUSTRY_CONFIGS, EXPERIENCE_CONFIGS } from "@/config/personalization";
import { useTranslation } from "react-i18next";

interface PeerBenchmarkProps {
  score: number;
  industry?: string;
  experienceLevel?: string;
  targetRole?: string;
}

// Generate percentile based on score and industry benchmarks
function calculatePercentile(score: number, avgScore: number, topScore: number): number {
  if (score >= topScore) return 99;
  if (score <= avgScore - 20) return 15;
  
  // Linear interpolation between avg (50th percentile) and top (95th percentile)
  if (score >= avgScore) {
    const range = topScore - avgScore;
    const position = (score - avgScore) / range;
    return Math.round(50 + position * 45);
  } else {
    // Below average
    const range = avgScore - (avgScore - 20);
    const position = (score - (avgScore - 20)) / range;
    return Math.round(15 + position * 35);
  }
}

// Get comparison message based on percentile — translated strings resolved by the caller
function getComparisonTone(percentile: number): "success" | "warning" | "neutral" {
  if (percentile >= 70) return "success";
  if (percentile >= 45) return "neutral";
  return "warning";
}

export function PeerBenchmark({ score, industry, experienceLevel, targetRole }: PeerBenchmarkProps) {
  const { t } = useTranslation();
  // Get industry benchmarks (fallback to technology if not found)
  const industryConfig = industry && INDUSTRY_CONFIGS[industry]
    ? INDUSTRY_CONFIGS[industry]
    : INDUSTRY_CONFIGS.technology;

  const { avgScore, topScore } = industryConfig.industryBenchmarks;
  const percentile = calculatePercentile(score, avgScore, topScore);
  const cohortLabel = `${experienceLevel ? `${experienceLevel} ` : ""}${industryConfig.name} resumes`;
  const topPct = Math.max(1, 100 - percentile);
  const comparisonTone = getComparisonTone(percentile);
  const comparisonMessage = percentile >= 70
    ? t('peerBenchmark.topPct', { pct: topPct, cohort: cohortLabel })
    : percentile >= 45
      ? t('peerBenchmark.aroundAverage', { cohort: cohortLabel })
      : t('peerBenchmark.belowAverage', { cohort: cohortLabel });
  const comparison = { message: comparisonMessage, tone: comparisonTone };

  // Calculate how many points needed to reach next tier
  const pointsToTop = Math.max(0, topScore - score);
  const pointsToAverage = Math.max(0, avgScore - score);
  
  // Get experience-level specific insight
  const expConfig = experienceLevel && EXPERIENCE_CONFIGS[experienceLevel]
    ? EXPERIENCE_CONFIGS[experienceLevel]
    : null;

  return (
    <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 space-y-6">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg">{t('peerBenchmark.howYouCompare')}</h3>
        {industry && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
            {industryConfig.name}
          </span>
        )}
      </div>

      {/* Percentile Display */}
      <div className="text-center py-4">
        <div className="relative inline-flex items-center justify-center">
          <div className={cn(
            "w-28 h-28 rounded-full flex items-center justify-center border-4",
            percentile >= 70 ? "border-success bg-success/10" :
            percentile >= 40 ? "border-primary bg-primary/10" :
            "border-warning bg-warning/10"
          )}>
            <div>
              <span className={cn(
                "text-3xl font-bold",
                percentile >= 70 ? "text-success" :
                percentile >= 40 ? "text-primary" :
                "text-warning"
              )}>
                {percentile}
              </span>
              <span className="text-sm text-muted-foreground">th</span>
            </div>
          </div>
          <div className="absolute -bottom-2">
            <span className="text-xs font-medium bg-background px-2 py-0.5 rounded-full border text-muted-foreground">
              {t('peerBenchmark.percentile')}
            </span>
          </div>
        </div>
        <p className={cn(
          "mt-6 text-sm font-medium",
          comparison.tone === "success" ? "text-success" :
          comparison.tone === "warning" ? "text-warning" :
          "text-muted-foreground"
        )}>
          {comparison.message}
        </p>
      </div>

      {/* Benchmark Comparison Bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('peerBenchmark.industryAverage', { score: avgScore })}</span>
          <span>{t('peerBenchmark.topPerformers', { score: topScore })}</span>
        </div>
        <div className="relative h-3 bg-muted rounded-full overflow-hidden">
          {/* Average marker */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/50 z-10"
            style={{ left: `${(avgScore / 100) * 100}%` }}
          />
          {/* Top marker */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-success/50 z-10"
            style={{ left: `${(topScore / 100) * 100}%` }}
          />
          {/* Your score */}
          <div 
            className={cn(
              "absolute top-0 bottom-0 rounded-full transition-all duration-500",
              score >= topScore ? "bg-success" :
              score >= avgScore ? "bg-primary" :
              "bg-warning"
            )}
            style={{ width: `${score}%` }}
          />
          {/* Score indicator */}
          <div 
            className="absolute -top-1.5 w-6 h-6 rounded-full bg-background border-2 border-primary shadow-md flex items-center justify-center transition-all duration-500"
            style={{ left: `calc(${score}% - 12px)` }}
          >
            <span className="text-[10px] font-bold text-primary">{score}</span>
          </div>
        </div>
      </div>

      {/* Insights Grid */}
      <div className="grid grid-cols-2 gap-3">
        {score < avgScore && (
          <div className="p-3 rounded-xl bg-warning/5 border border-warning/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-warning" />
              <span className="text-xs font-semibold text-warning">{t('peerBenchmark.toAverage')}</span>
            </div>
            <span className="text-lg font-bold text-foreground">+{pointsToAverage} pts</span>
          </div>
        )}
        
        {score < topScore && (
          <div className="p-3 rounded-xl bg-success/5 border border-success/20">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-success" />
              <span className="text-xs font-semibold text-success">{t('peerBenchmark.toTopTier')}</span>
            </div>
            <span className="text-lg font-bold text-foreground">+{pointsToTop} pts</span>
          </div>
        )}

        {score >= topScore && (
          <div className="col-span-2 p-3 rounded-xl bg-success/5 border border-success/20 text-center">
            <div className="flex items-center justify-center gap-2">
              <Award className="w-5 h-5 text-success" />
              <span className="font-semibold text-success">{t('peerBenchmark.topPerformer')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Experience-level insight */}
      {expConfig && (
        <div className="p-3 rounded-xl bg-muted/50 border border-border">
          <div className="flex items-start gap-2">
            <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div>
              <span className="text-xs font-semibold text-primary capitalize">{t('peerBenchmark.levelTip', { level: experienceLevel })}</span>
              <p className="text-sm text-muted-foreground mt-0.5">
                {expConfig.keyMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Target role mention */}
      {targetRole && (
        <div className="text-center pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {t('peerBenchmark.benchmarkedAgainst', { role: targetRole })}
          </p>
        </div>
      )}
    </div>
  );
}
