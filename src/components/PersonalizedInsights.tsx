// Personalized insights component that shows tailored advice based on resume analysis
import { 
  Briefcase, 
  GraduationCap, 
  Target, 
  Lightbulb, 
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  BookOpen,
  XCircle,
  ArrowRight,
  BarChart3,
  Globe,
  FileText,
  Camera,
  Info
} from "lucide-react";
import { 
  getIndustryAdvice, 
  getExperienceAdvice, 
  getPersonalizedPriorities,
  getGeographicAdvice,
  type IndustryConfig,
  type ExperienceLevelConfig,
  type GeographicConfig
} from "@/config/personalization";
import { cn } from "@/lib/utils";

interface PersonalizedInsightsProps {
  industry: string;
  experienceLevel?: { level: string; yearsEstimate: string };
  atsScore: number;
  hasJobDescription: boolean;
  className?: string;
}

export function PersonalizedInsights({
  industry,
  experienceLevel,
  atsScore,
  hasJobDescription,
  className
}: PersonalizedInsightsProps) {
  const industryConfig = getIndustryAdvice(industry);
  const expConfig = getExperienceAdvice(experienceLevel?.level || 'mid');
  const geoConfig = getGeographicAdvice();
  const priorities = getPersonalizedPriorities(
    industry, 
    experienceLevel?.level || 'mid', 
    atsScore, 
    hasJobDescription
  );
  
  const levelLabel = {
    entry: 'Entry Level',
    mid: 'Mid-Level',
    senior: 'Senior',
    executive: 'Executive'
  }[expConfig.level] || 'Professional';

  // Calculate where user stands vs industry benchmarks
  const benchmarkComparison = industryConfig.industryBenchmarks 
    ? atsScore >= industryConfig.industryBenchmarks.topScore 
      ? 'top' 
      : atsScore >= industryConfig.industryBenchmarks.avgScore 
        ? 'average' 
        : 'below'
    : 'unknown';

  return (
    <div className={cn("space-y-6", className)}>
      {/* Personalization Header */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Personalized for You</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Analysis tailored for <span className="font-medium text-primary">{industryConfig.name}</span> industry, 
              <span className="font-medium text-primary"> {levelLabel}</span> professional
              {experienceLevel?.yearsEstimate && ` (${experienceLevel.yearsEstimate})`}
              {' • '}<span className="font-medium text-primary">{geoConfig.name}</span> format
            </p>
          </div>
        </div>
      </div>

      {/* Geographic/Regional Advice */}
      <div className="p-4 rounded-lg bg-card border border-border">
        <h4 className="font-semibold text-foreground flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-primary" />
          {geoConfig.name} {geoConfig.documentName} Standards
        </h4>
        
        <div className="space-y-4">
          {/* Document naming */}
          <div className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">In {geoConfig.name}, this document is called a</span>
            <span className="font-semibold text-foreground">{geoConfig.documentName}</span>
          </div>

          {/* Photo requirement */}
          <div className="flex items-center gap-2 text-sm">
            <Camera className="w-4 h-4 text-muted-foreground" />
            <span className={cn(
              "font-medium",
              geoConfig.includePhoto ? "text-success" : "text-muted-foreground"
            )}>
              Photo {geoConfig.includePhoto ? 'recommended' : 'not required'} for {geoConfig.name} applications
            </span>
          </div>

          {/* Length guidelines */}
          <div className="flex items-start gap-2 text-sm">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5" />
            <span className="text-muted-foreground">{geoConfig.lengthGuidelines}</span>
          </div>

          {/* Format preferences */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Format preferences:</p>
            <div className="grid gap-1">
              {geoConfig.formatPreferences.slice(0, 3).map((pref, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="w-3 h-3 text-success mt-0.5 flex-shrink-0" />
                  <span>{pref}</span>
                </div>
              ))}
            </div>
          </div>

          {/* What to include/exclude */}
          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <p className="text-xs font-medium text-success mb-2">✓ Include</p>
              <div className="flex flex-wrap gap-1">
                {geoConfig.includePersonalInfo.slice(0, 4).map((item, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-success/10 text-success text-xs">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-destructive mb-2">✗ Exclude</p>
              <div className="flex flex-wrap gap-1">
                {geoConfig.excludeInfo.slice(0, 4).map((item, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-destructive/10 text-destructive text-xs">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Cultural tips */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-foreground mb-2">Cultural tips for {geoConfig.name}:</p>
            <div className="space-y-1">
              {geoConfig.culturalTips.slice(0, 2).map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Lightbulb className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Terminology differences */}
          {geoConfig.commonTerms && geoConfig.commonTerms.length > 0 && geoConfig.region !== 'us' && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-medium text-foreground mb-2">Terminology to use:</p>
              <div className="space-y-1">
                {geoConfig.commonTerms.map((term, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground line-through">{term.us}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-medium">{term.local}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Industry Benchmark Comparison */}
      {industryConfig.industryBenchmarks && (
        <div className="p-4 rounded-lg bg-card border border-border">
          <h4 className="font-semibold text-foreground flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-primary" />
            How You Compare in {industryConfig.name}
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Your Score</span>
              <span className={cn(
                "font-bold",
                atsScore >= 70 ? "text-success" : atsScore >= 50 ? "text-amber-500" : "text-destructive"
              )}>{atsScore}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{industryConfig.name} Average</span>
              <span className="font-medium text-foreground">{industryConfig.industryBenchmarks.avgScore}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Top Performers</span>
              <span className="font-medium text-success">{industryConfig.industryBenchmarks.topScore}%</span>
            </div>
            <div className={cn(
              "mt-3 p-2 rounded text-xs",
              benchmarkComparison === 'top' ? "bg-success/10 text-success" :
              benchmarkComparison === 'average' ? "bg-amber-500/10 text-amber-600" :
              "bg-destructive/10 text-destructive"
            )}>
              {benchmarkComparison === 'top' && "🏆 You're in the top tier for your industry!"}
              {benchmarkComparison === 'average' && "📊 You're at the industry average—room to stand out."}
              {benchmarkComparison === 'below' && "⚠️ You're below average for your industry—optimization critical."}
            </div>
          </div>
        </div>
      )}

      {/* Priority Actions */}
      <div className="space-y-3">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Your Top Priorities
        </h4>
        <div className="space-y-2">
          {priorities.map((priority, i) => (
            <div 
              key={i}
              className={cn(
                "p-3 rounded-lg border text-sm",
                i === 0 && atsScore < 60 
                  ? "bg-destructive/10 border-destructive/30 text-foreground" 
                  : "bg-card border-border"
              )}
            >
              <div className="flex items-start gap-2">
                {i === 0 && atsScore < 60 ? (
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                )}
                <span>{priority}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Industry-Specific Common Mistakes */}
      {industryConfig.commonMistakes && industryConfig.commonMistakes.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            <XCircle className="w-4 h-4 text-destructive" />
            Common {industryConfig.name} Resume Mistakes
          </h4>
          <div className="grid gap-2">
            {industryConfig.commonMistakes.slice(0, 3).map((mistake, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground p-2 rounded bg-destructive/5 border border-destructive/10">
                <span className="text-destructive font-medium">✗</span>
                <span>{mistake}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Industry-Specific Bullet Examples */}
      {industryConfig.bulletExamples && industryConfig.bulletExamples.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-primary" />
            {industryConfig.name} Bullet Examples
          </h4>
          <div className="space-y-3">
            {industryConfig.bulletExamples.slice(0, 2).map((example, i) => (
              <div key={i} className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded">Weak</span>
                  <p className="text-sm text-muted-foreground line-through">{example.weak}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded">Strong</span>
                  <p className="text-sm text-foreground">{example.strong}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Industry-Specific Tips */}
      <div className="space-y-3">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-primary" />
          {industryConfig.name} Resume Tips
        </h4>
        <div className="grid gap-2">
          {industryConfig.resumeTips.slice(0, 3).map((tip, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <span>{tip}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/70 italic">
          {industryConfig.atsNotes}
        </p>
      </div>

      {/* Key Metrics to Include */}
      {industryConfig.keyMetrics && industryConfig.keyMetrics.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Key Metrics for {industryConfig.name}
          </h4>
          <p className="text-xs text-muted-foreground">Include these numbers in your bullets:</p>
          <div className="flex flex-wrap gap-2">
            {industryConfig.keyMetrics.map((metric, i) => (
              <span 
                key={i}
                className="px-2 py-1 rounded-full bg-success/10 text-success text-xs font-medium"
              >
                {metric}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Strong Action Verbs */}
      {industryConfig.strongActionVerbs && industryConfig.strongActionVerbs.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Power Verbs for {industryConfig.name}
          </h4>
          <div className="flex flex-wrap gap-2">
            {industryConfig.strongActionVerbs.map((verb, i) => (
              <span 
                key={i}
                className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-medium"
              >
                {verb}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience-Level Guidance */}
      <div className="space-y-3">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-primary" />
          {levelLabel} Focus Areas
        </h4>
        <div className="p-3 rounded-lg bg-card border border-border">
          <p className="text-sm font-medium text-foreground mb-2">
            {expConfig.keyMessage}
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mt-3">
            <div>
              <p className="text-xs font-medium text-success mb-1">✓ Emphasize</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {expConfig.focusAreas.slice(0, 3).map((area, i) => (
                  <li key={i}>• {area}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-destructive mb-1">✗ Minimize</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {expConfig.avoidAreas.slice(0, 3).map((area, i) => (
                  <li key={i}>• {area}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-primary mt-3">
            💡 {expConfig.quantificationTip}
          </p>
        </div>
      </div>

      {/* Recommended Keywords */}
      <div className="space-y-3">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          Industry Keywords to Include
        </h4>
        <div className="flex flex-wrap gap-2">
          {industryConfig.keywords.slice(0, 8).map((keyword, i) => (
            <span 
              key={i}
              className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
            >
              {keyword}
            </span>
          ))}
        </div>
        {industryConfig.certifications.length > 0 && industryConfig.certifications[0] !== 'Varies by field' && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">Valuable certifications:</p>
            <div className="flex flex-wrap gap-1">
              {industryConfig.certifications.slice(0, 4).map((cert, i) => (
                <span 
                  key={i}
                  className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs"
                >
                  {cert}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Resume Length Recommendation */}
      <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-muted-foreground">
            Recommended resume length: <span className="font-medium text-foreground">{expConfig.resumeLengthPages} page{expConfig.resumeLengthPages > 1 ? 's' : ''}</span> for {levelLabel.toLowerCase()} professionals
          </span>
        </div>
      </div>
    </div>
  );
}
