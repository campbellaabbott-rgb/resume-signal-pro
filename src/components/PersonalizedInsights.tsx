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
  BookOpen
} from "lucide-react";
import { 
  getIndustryAdvice, 
  getExperienceAdvice, 
  getPersonalizedPriorities,
  type IndustryConfig,
  type ExperienceLevelConfig 
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
            </p>
          </div>
        </div>
      </div>

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
