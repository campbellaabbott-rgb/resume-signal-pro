// Returning user insights component
// Shows progress tracking and personalized insights for returning users

import { useEffect, useRef } from "react";
import { TrendingUp, TrendingDown, Trophy, History, Target, Sparkles, Minus } from "lucide-react";
import { useScanHistory } from "@/hooks/use-scan-history";
import { useOptimizationTracking } from "@/hooks/use-optimization-tracking";
import { cn } from "@/lib/utils";

interface ReturningUserInsightsProps {
  currentScore: number;
  currentIndustry?: string | null;
  className?: string;
}

export function ReturningUserInsights({ 
  currentScore, 
  currentIndustry,
  className 
}: ReturningUserInsightsProps) {
  const { 
    isReturningUser, 
    getScoreTrend, 
    getBestScore, 
    getAverageScore,
    totalScans,
    history
  } = useScanHistory();
  const { trackReturningUserDetected } = useOptimizationTracking();
  const hasTracked = useRef(false);

  // Track returning user detection
  useEffect(() => {
    if (isReturningUser && totalScans >= 2 && !hasTracked.current) {
      const latestScore = history.entries[0]?.atsScore;
      trackReturningUserDetected(totalScans, latestScore);
      hasTracked.current = true;
    }
  }, [isReturningUser, totalScans, history.entries, trackReturningUserDetected]);

  // Don't show anything for first-time users
  if (!isReturningUser || totalScans < 2) {
    return null;
  }

  const trend = getScoreTrend();
  const bestScore = getBestScore();
  const avgScore = getAverageScore();
  
  // Calculate days since first scan
  const daysSinceFirst = history.firstScanAt 
    ? Math.floor((Date.now() - new Date(history.firstScanAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const isNewBest = currentScore === bestScore && trend && trend.change > 0;

  return (
    <div className={cn(
      "rounded-xl border bg-gradient-to-br from-primary/5 to-primary/10 p-4 mb-6",
      className
    )}>
      {/* Welcome back header */}
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium text-foreground">
          Welcome back! This is scan #{totalScans}
        </span>
        {daysSinceFirst > 0 && (
          <span className="text-xs text-muted-foreground">
            · {daysSinceFirst} days tracking
          </span>
        )}
      </div>

      {/* Score comparison */}
      {trend && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {/* Score change */}
          <div className={cn(
            "rounded-lg p-3 text-center",
            trend.isImproving 
              ? "bg-green-500/10 border border-green-500/20" 
              : trend.change === 0 
                ? "bg-muted/50 border border-border/50"
                : "bg-amber-500/10 border border-amber-500/20"
          )}>
            <div className="flex items-center justify-center gap-1 mb-1">
              {trend.isImproving ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : trend.change === 0 ? (
                <Minus className="w-4 h-4 text-muted-foreground" />
              ) : (
                <TrendingDown className="w-4 h-4 text-amber-500" />
              )}
              <span className={cn(
                "text-lg font-bold",
                trend.isImproving ? "text-green-500" : trend.change === 0 ? "text-muted-foreground" : "text-amber-500"
              )}>
                {trend.change > 0 ? '+' : ''}{trend.change}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">vs. last scan</p>
          </div>

          {/* Best score */}
          <div className={cn(
            "rounded-lg p-3 text-center",
            isNewBest 
              ? "bg-primary/10 border border-primary/30 ring-2 ring-primary/20" 
              : "bg-muted/50 border border-border/50"
          )}>
            <div className="flex items-center justify-center gap-1 mb-1">
              <Trophy className={cn(
                "w-4 h-4",
                isNewBest ? "text-primary" : "text-muted-foreground"
              )} />
              <span className={cn(
                "text-lg font-bold",
                isNewBest ? "text-primary" : "text-foreground"
              )}>
                {bestScore}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isNewBest ? "New personal best!" : "Personal best"}
            </p>
          </div>

          {/* Average over time */}
          <div className="rounded-lg p-3 text-center bg-muted/50 border border-border/50 hidden sm:block">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="w-4 h-4 text-muted-foreground" />
              <span className="text-lg font-bold text-foreground">{avgScore}</span>
            </div>
            <p className="text-xs text-muted-foreground">Average score</p>
          </div>
        </div>
      )}

      {/* Personalized insight */}
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-muted-foreground">
          {getPersonalizedInsight(currentScore, trend, bestScore, totalScans)}
        </p>
      </div>
    </div>
  );
}

// Generate personalized insight based on user's history
function getPersonalizedInsight(
  currentScore: number,
  trend: { change: number; isImproving: boolean; previousScore: number } | null,
  bestScore: number | null,
  totalScans: number
): string {
  // New personal best
  if (trend && trend.change > 0 && currentScore === bestScore) {
    if (trend.change >= 10) {
      return `Amazing progress! You've jumped ${trend.change} points to your best score yet. Your resume improvements are really paying off.`;
    }
    return `You've reached a new personal best! Keep refining to push past ${currentScore} points.`;
  }

  // Significant improvement
  if (trend && trend.change >= 10) {
    return `Great work! A ${trend.change}-point improvement shows your optimizations are working. You're on track to hit your target score.`;
  }

  // Moderate improvement
  if (trend && trend.change > 0) {
    const gap = bestScore ? bestScore - currentScore : 0;
    if (gap > 0) {
      return `You're making progress (+${trend.change} points). You're ${gap} points away from your best score of ${bestScore}.`;
    }
    return `Steady progress! You've improved ${trend.change} points. Small wins add up to big results.`;
  }

  // No change
  if (trend && trend.change === 0) {
    return `Same score as last time. Try adding quantified achievements or industry keywords to boost your score.`;
  }

  // Score declined
  if (trend && trend.change < 0) {
    if (bestScore && bestScore > currentScore) {
      return `Your score dropped ${Math.abs(trend.change)} points. Your best was ${bestScore} — focus on the keyword suggestions to get back on track.`;
    }
    return `Score dropped ${Math.abs(trend.change)} points. Check if you removed any key sections or keywords from your resume.`;
  }

  // Fallback for returning users
  if (totalScans > 2) {
    return `You've scanned ${totalScans} times! Consistent optimization is the key to standing out.`;
  }

  return `Welcome back! Compare your results to see how your resume has evolved.`;
}
