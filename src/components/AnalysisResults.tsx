import { CheckCircle2, AlertCircle, Lightbulb, Zap, AlertTriangle } from "lucide-react";
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
  return (
    <section className="py-16">
      <div className="container">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-sm text-success mb-4">
              <CheckCircle2 className="w-4 h-4" />
              Analysis Complete
            </div>
            <h2 className="text-2xl md:text-3xl font-bold">Your Resume Breakdown</h2>
          </div>

          {/* ATS-Optimized Bullets */}
          <ResultCard
            icon={CheckCircle2}
            title="ATS-Optimized Bullet Points"
            iconColor="text-success"
          >
            <div className="space-y-6">
              {data.optimizedBullets.map((bullet, index) => (
                <div key={index} className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-muted-foreground mt-1">BEFORE</span>
                    <p className="text-sm text-muted-foreground line-through">{bullet.original}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono text-primary mt-1">AFTER</span>
                    <p className="text-sm text-foreground">{bullet.improved}</p>
                  </div>
                  <p className="text-xs text-muted-foreground pl-14 italic">
                    Why: {bullet.reason}
                  </p>
                  {index < data.optimizedBullets.length - 1 && (
                    <div className="border-t border-border pt-4" />
                  )}
                </div>
              ))}
            </div>
          </ResultCard>

          {/* Action Verbs */}
          <ResultCard
            icon={Zap}
            title="Stronger Action Verbs"
            iconColor="text-warning"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.actionVerbs.map((verb, index) => (
                <div
                  key={index}
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                >
                  <span className="text-sm text-muted-foreground line-through">{verb.weak}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-sm font-medium text-primary">{verb.strong}</span>
                </div>
              ))}
            </div>
          </ResultCard>

          {/* Keywords */}
          <ResultCard
            icon={Lightbulb}
            title="Recommended Keywords"
            iconColor="text-primary"
          >
            <p className="text-sm text-muted-foreground mb-4">
              Consider adding these keywords to improve ATS matching:
            </p>
            <div className="flex flex-wrap gap-2">
              {data.keywords.map((keyword, index) => (
                <span
                  key={index}
                  className="px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </ResultCard>

          {/* Red Flags */}
          {data.redFlags.length > 0 && (
            <ResultCard
              icon={AlertTriangle}
              title="Red Flags Recruiters May Notice"
              iconColor="text-destructive"
            >
              <ul className="space-y-3">
                {data.redFlags.map((flag, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <span className="text-sm text-foreground">{flag}</span>
                  </li>
                ))}
              </ul>
            </ResultCard>
          )}
        </div>
      </div>
    </section>
  );
}

interface ResultCardProps {
  icon: React.ElementType;
  title: string;
  iconColor: string;
  children: React.ReactNode;
}

function ResultCard({ icon: Icon, title, iconColor, children }: ResultCardProps) {
  return (
    <div className="rounded-xl bg-card border border-border p-6 md:p-8 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <div className={cn("p-2 rounded-lg bg-muted", iconColor)}>
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}
