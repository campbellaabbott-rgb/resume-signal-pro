import { 
  AlertTriangle, CheckCircle2, ArrowRight, FileWarning, 
  TrendingUp, Zap, Lightbulb, Target, BarChart3, FileText,
  ListChecks, Gauge, Linkedin, Briefcase
} from "lucide-react";
import { cn } from "@/lib/utils";

const sampleATSScore = {
  overall: 72,
  breakdown: [
    { name: "Job Title Match", score: 12, max: 15 },
    { name: "Skills Match", score: 22, max: 30 },
    { name: "Action Verb Usage", score: 11, max: 15 },
    { name: "Keyword Coverage", score: 14, max: 20 },
    { name: "Formatting Score", score: 13, max: 20 },
  ]
};

const sampleJDMatch = {
  matchPercentage: 78,
  matchingSkills: ["Product Management", "Agile/Scrum", "Stakeholder Management", "Data Analysis"],
  missingKeywords: ["OKRs", "Product Roadmap", "A/B Testing"],
  alignmentSuggestion: "Add specific metrics around product launches and mention experience with OKRs to strengthen alignment with this Senior PM role."
};

const sampleParsingIssues = {
  detectedIssues: [
    "Contact info may not parse in older ATS",
    "Job dates are not in preferred structure",
    "Special bullets hinder scanning"
  ],
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

const sampleResumeLength = {
  currentPages: 3,
  recommendedPages: 2,
  reasoning: "With 8 years of experience, a 2-page resume is optimal. Consider condensing older roles."
};

const sampleActionPlan = [
  "Add 3-5 quantified achievements to your most recent role",
  "Replace passive phrases with strong action verbs",
  "Include 'cross-functional' and 'stakeholder management' keywords",
  "Fix date formatting for ATS compatibility"
];

const sampleRedFlags = [
  "Employment gap of 8 months not addressed",
  "Generic objective statement instead of targeted summary"
];

const sampleLinkedIn = {
  headlineSuggestion: "Senior Product Manager | B2B SaaS | Driving 40% Revenue Growth",
  aboutImprovement: "Your About section lacks quantified achievements. Add metrics like team size, revenue impact, or user growth.",
  profileStrength: 78,
  recommendations: [
    "Add featured section showcasing key projects",
    "Request 2-3 recommendations from colleagues",
    "Include industry-specific keywords in headline"
  ]
};

function getScoreColor(score: number, max: number) {
  const pct = (score / max) * 100;
  if (pct >= 70) return "text-success";
  if (pct >= 50) return "text-warning";
  return "text-destructive";
}

function getMatchColor(pct: number) {
  if (pct >= 70) return "text-success";
  if (pct >= 50) return "text-warning";
  return "text-destructive";
}

function getMatchBgColor(pct: number) {
  if (pct >= 70) return "bg-success";
  if (pct >= 50) return "bg-warning";
  return "bg-destructive";
}

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
          {/* ATS Score Breakdown */}
          <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-primary/30 hover:border-primary/50 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gauge className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">ATS Compatibility Score</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-primary">{sampleATSScore.overall}</span>
                <span className="text-sm text-muted-foreground">/100</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {sampleATSScore.breakdown.map((item, i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                  <div className={cn("text-lg font-bold", getScoreColor(item.score, item.max))}>
                    {item.score}/{item.max}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-tight">{item.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* JD Match Score */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-primary/10 to-card/50 backdrop-blur-sm border border-primary/30 hover:border-primary/50 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">Job Description Match</span>
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Optional</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("text-2xl font-bold", getMatchColor(sampleJDMatch.matchPercentage))}>
                  {sampleJDMatch.matchPercentage}%
                </span>
                <span className="text-sm text-muted-foreground">match</span>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="h-2 bg-muted rounded-full mb-4 overflow-hidden">
              <div 
                className={cn("h-full rounded-full transition-all", getMatchBgColor(sampleJDMatch.matchPercentage))}
                style={{ width: `${sampleJDMatch.matchPercentage}%` }}
              />
            </div>
            
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                <span className="text-xs font-semibold text-success mb-2 block">Matching Skills</span>
                <div className="flex flex-wrap gap-1">
                  {sampleJDMatch.matchingSkills.slice(0, 3).map((skill, i) => (
                    <span key={i} className="text-xs bg-success/10 text-success px-2 py-0.5 rounded">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                <span className="text-xs font-semibold text-warning mb-2 block">Missing Keywords</span>
                <div className="flex flex-wrap gap-1">
                  {sampleJDMatch.missingKeywords.map((keyword, i) => (
                    <span key={i} className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded">
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                <span className="text-xs font-semibold text-primary mb-2 block">Alignment Tip</span>
                <p className="text-xs text-foreground leading-relaxed">{sampleJDMatch.alignmentSuggestion}</p>
              </div>
            </div>
          </div>

          {/* Two column grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* ATS Parsing Issues */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-warning/30 hover:border-warning/50 transition-all duration-300">
              <div className="flex items-center gap-2 mb-4">
                <FileWarning className="w-5 h-5 text-warning" />
                <span className="text-sm font-semibold">Formatting Issues</span>
              </div>
              
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <span className="text-xs font-semibold text-warning mb-2 block">Detected</span>
                  <ul className="space-y-1.5">
                    {sampleParsingIssues.detectedIssues.slice(0, 2).map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <span className="text-warning">•</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
                
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <span className="text-xs font-semibold text-success mb-2 block">Fixes</span>
                  <ul className="space-y-1.5">
                    {sampleParsingIssues.criticalFixes.slice(0, 2).map((fix, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                        <ArrowRight className="w-3 h-3 text-success mt-0.5 shrink-0" />
                        {fix}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Bullet Improvement */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">ATS-Optimized Bullets</span>
              </div>
              
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <span className="text-xs font-semibold text-destructive">Before</span>
                  <p className="text-xs text-foreground mt-1 line-through opacity-70">{sampleBullet.original}</p>
                </div>
                
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <span className="text-xs font-semibold text-success">After</span>
                  <p className="text-xs text-foreground mt-1 font-medium">{sampleBullet.improved}</p>
                </div>
                
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lightbulb className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  {sampleBullet.reason}
                </div>
              </div>
            </div>
          </div>

          {/* Three column grid */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Resume Length */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">Resume Length</span>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-bold text-warning">{sampleResumeLength.currentPages}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-2xl font-bold text-success">{sampleResumeLength.recommendedPages}</span>
                <span className="text-xs text-muted-foreground">pages</span>
              </div>
              <p className="text-xs text-muted-foreground">{sampleResumeLength.reasoning}</p>
            </div>

            {/* Action Plan */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-primary/20 hover:border-primary/40 transition-all duration-300">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks className="w-5 h-5 text-primary" />
                <span className="text-sm font-semibold">Action Plan</span>
              </div>
              <ol className="space-y-2">
                {sampleActionPlan.slice(0, 3).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 font-medium">
                      {i + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>

            {/* Red Flags */}
            <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-destructive/20 hover:border-destructive/30 transition-all duration-300">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                <span className="text-sm font-semibold">Red Flags</span>
              </div>
              <ul className="space-y-2">
                {sampleRedFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <Target className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* LinkedIn Analysis Preview */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-[#0077B5]/10 to-card/50 backdrop-blur-sm border border-[#0077B5]/30 hover:border-[#0077B5]/50 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Linkedin className="w-5 h-5 text-[#0077B5]" />
                <span className="text-sm font-semibold">LinkedIn Analysis</span>
                <span className="text-xs bg-[#0077B5]/20 text-[#0077B5] px-2 py-0.5 rounded-full">Included Free</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-lg font-bold text-[#0077B5]">{sampleLinkedIn.profileStrength}%</span>
                <span className="text-xs text-muted-foreground">strength</span>
              </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <span className="text-xs font-semibold text-success mb-1 block">Suggested Headline</span>
                  <p className="text-xs text-foreground font-medium">{sampleLinkedIn.headlineSuggestion}</p>
                </div>
                
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <span className="text-xs font-semibold text-warning mb-1 block">About Section</span>
                  <p className="text-xs text-foreground">{sampleLinkedIn.aboutImprovement}</p>
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-[#0077B5]/5 border border-[#0077B5]/20">
                <span className="text-xs font-semibold text-[#0077B5] mb-2 block">Profile Recommendations</span>
                <ul className="space-y-2">
                  {sampleLinkedIn.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                      <CheckCircle2 className="w-3 h-3 text-[#0077B5] mt-0.5 shrink-0" />
                      {rec}
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
              Plus: Skills Gap, Industry Insights, Action Verbs, Keywords & Summary Rewrite
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
