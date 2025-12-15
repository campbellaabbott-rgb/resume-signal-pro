import { CheckCircle2, AlertCircle, Lightbulb, Zap, AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AnalysisData {
  optimizedBullets: {
    original: string;
    improved: string;
    reason: string;
  }[];
  actionVerbs: {
    weak: string;
    strong: string;
  }[];
  keywords: string[];
  redFlags: string[];
}

interface AnalysisResultsProps {
  data: AnalysisData;
}

export function AnalysisResults({ data }: AnalysisResultsProps) {
  // Calculate stats
  const stats = [
    { label: "Bullets Improved", value: data.optimizedBullets.length, icon: TrendingUp },
    { label: "Verb Upgrades", value: data.actionVerbs.length, icon: Zap },
    { label: "Keywords Added", value: data.keywords.length, icon: Lightbulb },
    { label: "Issues Found", value: data.redFlags.length, icon: AlertTriangle },
  ];

  return (
    <section className="py-16 md:py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-transparent pointer-events-none" />
      
      <div className="container relative">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Header with stats */}
          <div className="text-center space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-sm text-success mb-4">
                <CheckCircle2 className="w-4 h-4" />
                Analysis Complete
              </div>
              <h2 className="text-3xl md:text-4xl font-bold">Your Resume Breakdown</h2>
              <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
                Here's what we found and how to fix it. Apply these changes to increase your interview chances.
              </p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.map((stat) => {
                const StatIcon = stat.icon;
                return (
                  <div 
                    key={stat.label}
                    className="p-4 rounded-xl bg-card/50 backdrop-blur-sm border border-border/50"
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <StatIcon className="w-4 h-4 text-primary" />
                      <span className="text-2xl font-bold text-foreground">{stat.value}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ATS-Optimized Bullets */}
          <ResultCard
            icon={CheckCircle2}
            title="ATS-Optimized Bullet Points"
            subtitle="These rewrites add metrics and action verbs that ATS systems love"
            iconColor="text-success"
            bgColor="bg-success/10"
            borderColor="border-success/20"
          >
            <div className="space-y-6">
              {data.optimizedBullets.map((bullet, index) => (
                <div key={index} className="group">
                  <div className="grid md:grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                    {/* Before */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                          BEFORE
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {bullet.original}
                      </p>
                    </div>
                    
                    {/* After */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                          AFTER
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed font-medium">
                        {bullet.improved}
                      </p>
                    </div>
                  </div>
                  
                  {/* Reason */}
                  <div className="flex items-start gap-2 mt-3 px-4">
                    <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground italic">
                      {bullet.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ResultCard>

          {/* Action Verbs */}
          <ResultCard
            icon={Zap}
            title="Stronger Action Verbs"
            subtitle="Replace weak verbs with powerful alternatives that grab attention"
            iconColor="text-warning"
            bgColor="bg-warning/10"
            borderColor="border-warning/20"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.actionVerbs.map((verb, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors group"
                >
                  <span className="text-sm text-muted-foreground line-through shrink-0">
                    {verb.weak}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-warning transition-colors shrink-0" />
                  <span className="text-sm font-semibold text-warning">
                    {verb.strong}
                  </span>
                </div>
              ))}
            </div>
          </ResultCard>

          {/* Keywords */}
          <ResultCard
            icon={Lightbulb}
            title="Recommended Keywords"
            subtitle="Add these keywords to improve ATS matching and recruiter interest"
            iconColor="text-primary"
            bgColor="bg-primary/10"
            borderColor="border-primary/20"
          >
            <div className="flex flex-wrap gap-2">
              {data.keywords.map((keyword, index) => (
                <span
                  key={index}
                  className="px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm font-medium text-primary hover:bg-primary/20 transition-colors cursor-default"
                >
                  {keyword}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              💡 Tip: Naturally incorporate these keywords into your experience bullets and skills section.
            </p>
          </ResultCard>

          {/* Red Flags */}
          {data.redFlags.length > 0 && (
            <ResultCard
              icon={AlertTriangle}
              title="Red Flags to Fix"
              subtitle="Address these issues to prevent recruiters from passing on your resume"
              iconColor="text-destructive"
              bgColor="bg-destructive/10"
              borderColor="border-destructive/20"
            >
              <ul className="space-y-3">
                {data.redFlags.map((flag, index) => (
                  <li 
                    key={index} 
                    className="flex items-start gap-3 p-3 rounded-xl bg-destructive/5 border border-destructive/10"
                  >
                    <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground leading-relaxed">{flag}</span>
                  </li>
                ))}
              </ul>
            </ResultCard>
          )}

          {/* Bottom CTA */}
          <div className="text-center pt-8 space-y-4">
            <p className="text-muted-foreground">
              Apply these changes to your resume and watch your interview rate improve!
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span>This analysis has been saved. Use the share link above to access it anytime.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ResultCardProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  children: React.ReactNode;
}

function ResultCard({ icon: Icon, title, subtitle, iconColor, bgColor, borderColor, children }: ResultCardProps) {
  return (
    <div className="rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className={cn("px-6 py-5 border-b", borderColor, bgColor)}>
        <div className="flex items-center gap-3">
          <div className={cn("p-2.5 rounded-xl", bgColor, iconColor)}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}