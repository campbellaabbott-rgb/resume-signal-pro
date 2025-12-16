import { 
  AlertTriangle, CheckCircle2, ArrowRight, FileWarning, 
  TrendingUp, Zap, Lightbulb, Target, BarChart3 
} from "lucide-react";
import { cn } from "@/lib/utils";

const sampleParsingIssues = {
  detectedIssues: [
    "Contact info may not parse in older ATS",
    "Job dates are not in preferred structure",
    "Special bullets hinder scanning"
  ],
  severity: "medium",
  criticalFixes: [
    "Use Month Year format (e.g., Jan 2020 - Present)",
    "Replace fancy bullets with standard hyphens or dots",
    "Move email and phone to a single line"
  ]
};

const sampleBullet = {
  original: "Responsible for managing the sales team",
  improved: "Led 12-person sales team to exceed quarterly targets by 34%, generating $2.1M in new revenue",
  reason: "Added team size, measurable outcome, and specific revenue impact"
};

const sampleKeywords = ["Cross-functional collaboration", "Revenue growth", "Agile methodology", "Stakeholder management"];

const sampleRedFlags = [
  "Employment gap of 8 months not addressed",
  "Generic objective statement instead of targeted summary"
];

export function AnalysisPreview() {
  return (
    <section className="py-20 relative overflow-hidden" id="preview">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />
      
      <div className="container relative">
        <div className="text-center mb-12">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-xs font-medium text-primary mb-4">
            <BarChart3 className="w-3 h-3" />
            Sample Analysis
          </span>
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            See What You'll Get
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Here's a preview of the detailed, actionable feedback in every analysis
          </p>
        </div>

        <div className="max-w-4xl mx-auto grid gap-6">
          {/* ATS Parsing Issues Preview */}
          <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-warning/30 hover:border-warning/50 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileWarning className="w-5 h-5 text-warning" />
                <span className="text-sm font-semibold">Formatting & Parsing Issues</span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">NEW</span>
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-bold uppercase",
                "bg-warning/20 text-warning"
              )}>
                {sampleParsingIssues.severity} severity
              </span>
            </div>
            
            <p className="text-xs text-muted-foreground mb-4">
              These formatting issues may cause ATS systems to incorrectly parse or reject your resume.
            </p>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                <span className="text-xs font-semibold uppercase tracking-wide text-warning flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="w-3 h-3" />
                  Detected Issues
                </span>
                <ul className="space-y-2">
                  {sampleParsingIssues.detectedIssues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <span className="text-warning mt-0.5">•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                <span className="text-xs font-semibold uppercase tracking-wide text-success flex items-center gap-1.5 mb-2">
                  <CheckCircle2 className="w-3 h-3" />
                  Critical Fixes
                </span>
                <ul className="space-y-2">
                  {sampleParsingIssues.criticalFixes.map((fix, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <ArrowRight className="w-3 h-3 text-success mt-1 shrink-0" />
                      {fix}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Two column grid for other previews */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Bullet Improvement Preview */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">ATS-Optimized Bullets</span>
              </div>
              
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <span className="text-xs font-semibold text-destructive">Before</span>
                  <p className="text-sm text-foreground mt-1 line-through opacity-70">{sampleBullet.original}</p>
                </div>
                
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <span className="text-xs font-semibold text-success">After</span>
                  <p className="text-sm text-foreground mt-1 font-medium">{sampleBullet.improved}</p>
                </div>
                
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lightbulb className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  {sampleBullet.reason}
                </div>
              </div>
            </div>

            {/* Keywords & Red Flags Preview */}
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-5 h-5 text-primary" />
                  <span className="text-sm font-semibold">Recommended Keywords</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sampleKeywords.map((keyword, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-full bg-primary/10 text-xs text-primary font-medium">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-destructive/20 hover:border-destructive/30 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  <span className="text-sm font-semibold">Red Flags</span>
                </div>
                <ul className="space-y-2">
                  {sampleRedFlags.map((flag, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <Target className="w-3 h-3 text-destructive mt-1 shrink-0" />
                      {flag}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Plus more indicator */}
          <div className="text-center pt-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 text-sm text-muted-foreground">
              <Zap className="w-4 h-4 text-primary" />
              Plus 5 more sections: Skills Gap, Industry Insights, Action Verbs, Summary Rewrite & more
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}