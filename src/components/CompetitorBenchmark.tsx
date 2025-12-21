// Competitor Benchmark - Shows what top resumes in the role typically include
import { Award, BarChart3, CheckCircle2, FileText, Link, Trophy, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { type RoleConfig } from "@/config/personalization";
import { Progress } from "@/components/ui/progress";

interface CompetitorBenchmarkProps {
  roleConfig: RoleConfig;
  userHasPortfolio?: boolean;
  userHasCertifications?: boolean;
  userHasMetrics?: boolean;
  userBulletCount?: number;
  className?: string;
}

export function CompetitorBenchmark({ 
  roleConfig, 
  userHasPortfolio = false,
  userHasCertifications = false,
  userHasMetrics = false,
  userBulletCount = 3,
  className 
}: CompetitorBenchmarkProps) {
  const benchmark = roleConfig.topResumeElements;
  
  if (!benchmark) {
    return null;
  }

  // Calculate user's competitive standing
  const checklistItems = [
    { 
      label: 'Portfolio/GitHub links', 
      userHas: userHasPortfolio, 
      topRate: benchmark.portfolioRate,
      icon: Link
    },
    { 
      label: 'Certifications', 
      userHas: userHasCertifications, 
      topRate: benchmark.certificationRate,
      icon: Award
    },
    { 
      label: 'Quantified achievements', 
      userHas: userHasMetrics, 
      topRate: benchmark.metricsRate,
      icon: BarChart3
    },
  ];

  const matchedItems = checklistItems.filter(item => item.userHas).length;
  const competitiveScore = Math.round((matchedItems / checklistItems.length) * 100);
  
  const bulletStatus = userBulletCount >= benchmark.avgBulletCount 
    ? 'optimal' 
    : userBulletCount >= benchmark.avgBulletCount - 1 
      ? 'close' 
      : 'low';

  return (
    <div className={cn("p-4 rounded-xl bg-gradient-to-br from-primary/5 via-background to-background border border-primary/20", className)}>
      <h4 className="font-semibold text-foreground flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-amber-500" />
        How Top {roleConfig.name}s Stand Out
      </h4>
      
      <p className="text-xs text-muted-foreground mb-4">
        Based on analysis of successful {roleConfig.name} resumes that get interviews
      </p>
      
      {/* Competitive Score */}
      <div className="p-3 rounded-lg bg-card border border-border mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Your Competitive Standing</span>
          <span className={cn(
            "text-lg font-bold",
            competitiveScore >= 67 ? "text-success" : 
            competitiveScore >= 34 ? "text-amber-500" : 
            "text-destructive"
          )}>
            {competitiveScore}%
          </span>
        </div>
        <Progress 
          value={competitiveScore} 
          className="h-2" 
        />
        <p className="text-xs text-muted-foreground mt-2">
          {competitiveScore >= 67 
            ? "🏆 You have elements that top candidates include!" 
            : competitiveScore >= 34 
              ? "📊 Add a few more elements to compete with top candidates"
              : "⚡ Add these elements to match top performers"}
        </p>
      </div>
      
      {/* What Top Resumes Include */}
      <div className="space-y-4">
        {/* Sections */}
        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Sections top {roleConfig.name}s always include:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {benchmark.sections.map((section, i) => (
              <span 
                key={i} 
                className="px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
              >
                {section}
              </span>
            ))}
          </div>
        </div>
        
        {/* Differentiators */}
        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            What makes top resumes stand out:
          </p>
          <div className="space-y-1.5">
            {benchmark.differentiators.map((diff, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-amber-500">★</span>
                <span>{diff}</span>
              </div>
            ))}
          </div>
        </div>
        
        {/* Benchmark Stats */}
        <div className="pt-3 border-t border-border">
          <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            What % of top candidates include:
          </p>
          <div className="space-y-3">
            {checklistItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-16">
                      <Progress value={item.topRate} className="h-1.5" />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{item.topRate}%</span>
                    {item.userHas ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/30" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Bullet Count Benchmark */}
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Avg bullets per role:</span>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs font-medium",
                bulletStatus === 'optimal' ? "text-success" :
                bulletStatus === 'close' ? "text-amber-500" :
                "text-destructive"
              )}>
                You: {userBulletCount}
              </span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs font-medium text-primary">
                Top: {benchmark.avgBulletCount}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Action Items */}
      {competitiveScore < 100 && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs font-semibold text-amber-600 mb-1.5">💡 Quick wins to compete:</p>
          <div className="space-y-1">
            {!userHasPortfolio && benchmark.portfolioRate >= 50 && (
              <p className="text-xs text-muted-foreground">
                • Add portfolio/GitHub links ({benchmark.portfolioRate}% of top candidates include them)
              </p>
            )}
            {!userHasCertifications && benchmark.certificationRate >= 40 && (
              <p className="text-xs text-muted-foreground">
                • List relevant certifications ({benchmark.certificationRate}% of top candidates have them)
              </p>
            )}
            {!userHasMetrics && (
              <p className="text-xs text-muted-foreground">
                • Add metrics to your bullets ({benchmark.metricsRate}% of top resumes quantify achievements)
              </p>
            )}
            {bulletStatus !== 'optimal' && (
              <p className="text-xs text-muted-foreground">
                • Add {benchmark.avgBulletCount - userBulletCount} more bullet points per role
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
