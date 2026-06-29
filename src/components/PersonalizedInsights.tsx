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
  getRoleAdvice,
  type IndustryConfig,
  type ExperienceLevelConfig,
  type GeographicConfig,
  type RoleConfig
} from "@/config/personalization";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SkillsGapAnalysis } from "./SkillsGapAnalysis";
import { CompetitorBenchmark } from "./CompetitorBenchmark";

interface PersonalizedInsightsProps {
  industry: string;
  experienceLevel?: { level: string; yearsEstimate: string };
  atsScore: number;
  hasJobDescription: boolean;
  currentRole?: string;
  className?: string;
  // New props for enhanced personalization
  detectedSkills?: string[];
  userHasPortfolio?: boolean;
  userHasCertifications?: boolean;
  userHasMetrics?: boolean;
  userBulletCount?: number;
}

export function PersonalizedInsights({
  industry,
  experienceLevel,
  atsScore,
  hasJobDescription,
  currentRole,
  className,
  detectedSkills = [],
  userHasPortfolio = false,
  userHasCertifications = false,
  userHasMetrics = false,
  userBulletCount = 3
}: PersonalizedInsightsProps) {
  const { t } = useTranslation();
  const industryConfig = getIndustryAdvice(industry);
  const expConfig = getExperienceAdvice(experienceLevel?.level || 'mid', t);
  const geoConfig = getGeographicAdvice(undefined, t);
  const roleConfig = getRoleAdvice(currentRole || '');
  const priorities = getPersonalizedPriorities(
    industry, 
    experienceLevel?.level || 'mid', 
    atsScore, 
    hasJobDescription
  );
  
  const levelLabel = {
    entry: t('personalizedInsights.levels.entry'),
    mid: t('personalizedInsights.levels.mid'),
    senior: t('personalizedInsights.levels.senior'),
    executive: t('personalizedInsights.levels.executive')
  }[expConfig.level] || t('personalizedInsights.levels.professional');

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
            <h3 className="font-semibold text-foreground">{t('personalizedInsights.personalizedForYou')}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {roleConfig && <><span className="font-medium text-primary">{roleConfig.name}</span> {t('personalizedInsights.in')} </>}
              <span className="font-medium text-primary">{industryConfig.name}</span>
              {' • '}<span className="font-medium text-primary">{levelLabel}</span>
              {experienceLevel?.yearsEstimate && ` (${experienceLevel.yearsEstimate})`}
              {' • '}<span className="font-medium text-primary">{geoConfig.name}</span> {t('personalizedInsights.formatSuffix')}
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                {t('personalizedInsights.autoDetected')}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Role-Specific Advice */}
      {roleConfig && (
        <div className="p-4 rounded-lg bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20">
          <h4 className="font-semibold text-foreground flex items-center gap-2 mb-3">
            <Briefcase className="w-4 h-4 text-amber-500" />
            {t('personalizedInsights.resumeTipsFor', { name: roleConfig.name })}
          </h4>

          <div className="space-y-4">
            {/* Must-have keywords */}
            <div>
              <p className="text-xs font-medium text-foreground mb-2">{t('personalizedInsights.mustHaveKeywordsFor', { name: roleConfig.name })}</p>
              <div className="flex flex-wrap gap-1">
                {roleConfig.mustHaveKeywords.map((keyword, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 text-xs font-medium">
                    {keyword}
                  </span>
                ))}
              </div>
            </div>

            {/* Role-specific tips */}
            <div className="space-y-2">
              {roleConfig.resumeTips.slice(0, 3).map((tip, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>

            {/* Role-specific bullet examples */}
            {roleConfig.bulletExamples.length > 0 && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium text-foreground mb-2">{t('personalizedInsights.bulletExampleFor', { name: roleConfig.name })}</p>
                <div className="p-3 rounded-lg bg-card border border-border space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded">{t('personalizedInsights.weak')}</span>
                    <p className="text-xs text-muted-foreground line-through">{roleConfig.bulletExamples[0].weak}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded">{t('personalizedInsights.strong')}</span>
                    <p className="text-xs text-foreground">{roleConfig.bulletExamples[0].strong}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Key metrics for role */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-medium text-foreground mb-2">{t('personalizedInsights.keyMetricsToInclude')}</p>
              <div className="flex flex-wrap gap-1">
                {roleConfig.keyMetrics.map((metric, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-success/10 text-success text-xs">
                    {metric}
                  </span>
                ))}
              </div>
            </div>

            {/* Common mistakes for role */}
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-medium text-destructive mb-2">{t('personalizedInsights.commonMistakesFor', { name: roleConfig.name })}</p>
              <div className="space-y-1">
                {roleConfig.commonMistakes.slice(0, 2).map((mistake, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <XCircle className="w-3 h-3 text-destructive mt-0.5 flex-shrink-0" />
                    <span>{mistake}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Skills Gap Analysis */}
      {roleConfig && detectedSkills.length > 0 && (
        <SkillsGapAnalysis 
          roleConfig={roleConfig}
          detectedSkills={detectedSkills}
        />
      )}

      {/* NEW: Competitor Benchmark */}
      {roleConfig && roleConfig.topResumeElements && (
        <CompetitorBenchmark 
          roleConfig={roleConfig}
          userHasPortfolio={userHasPortfolio}
          userHasCertifications={userHasCertifications}
          userHasMetrics={userHasMetrics}
          userBulletCount={userBulletCount}
        />
      )}

      {/* Geographic/Regional Advice section removed - was considered overkill */}

      {/* Industry Benchmark Comparison */}
      {industryConfig.industryBenchmarks && (
        <div className="p-4 rounded-lg bg-card border border-border">
          <h4 className="font-semibold text-foreground flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-primary" />
            {t('personalizedInsights.howYouCompareIn', { name: industryConfig.name })}
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('personalizedInsights.yourScore')}</span>
              <span className={cn(
                "font-bold",
                atsScore >= 70 ? "text-success" : atsScore >= 50 ? "text-amber-500" : "text-destructive"
              )}>{atsScore}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('personalizedInsights.industryAverage', { name: industryConfig.name })}</span>
              <span className="font-medium text-foreground">{industryConfig.industryBenchmarks.avgScore}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('personalizedInsights.topPerformers')}</span>
              <span className="font-medium text-success">{industryConfig.industryBenchmarks.topScore}%</span>
            </div>
            <div className={cn(
              "mt-3 p-2 rounded text-xs",
              benchmarkComparison === 'top' ? "bg-success/10 text-success" :
              benchmarkComparison === 'average' ? "bg-amber-500/10 text-amber-600" :
              "bg-destructive/10 text-destructive"
            )}>
              {benchmarkComparison === 'top' && t('personalizedInsights.benchmarkTop')}
              {benchmarkComparison === 'average' && t('personalizedInsights.benchmarkAverage')}
              {benchmarkComparison === 'below' && t('personalizedInsights.benchmarkBelow')}
            </div>
          </div>
        </div>
      )}

      {/* Priority Actions */}
      <div className="space-y-3">
        <h4 className="font-semibold text-foreground flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          {t('personalizedInsights.yourTopPriorities')}
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
            {t('personalizedInsights.commonIndustryMistakes', { name: industryConfig.name })}
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
            {t('personalizedInsights.industryBulletExamples', { name: industryConfig.name })}
          </h4>
          <div className="space-y-3">
            {industryConfig.bulletExamples.slice(0, 2).map((example, i) => (
              <div key={i} className="p-3 rounded-lg bg-card border border-border space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded">{t('personalizedInsights.weak')}</span>
                  <p className="text-sm text-muted-foreground line-through">{example.weak}</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded">{t('personalizedInsights.strong')}</span>
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
          {t('personalizedInsights.industryResumeTips', { name: industryConfig.name })}
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
            {t('personalizedInsights.keyMetricsFor', { name: industryConfig.name })}
          </h4>
          <p className="text-xs text-muted-foreground">{t('personalizedInsights.includeNumbersHelper')}</p>
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
            {t('personalizedInsights.powerVerbsFor', { name: industryConfig.name })}
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
          {t('personalizedInsights.focusAreasFor', { level: levelLabel })}
        </h4>
        <div className="p-3 rounded-lg bg-card border border-border">
          <p className="text-sm font-medium text-foreground mb-2">
            {expConfig.keyMessage}
          </p>
          <div className="grid sm:grid-cols-2 gap-2 mt-3">
            <div>
              <p className="text-xs font-medium text-success mb-1">✓ {t('personalizedInsights.emphasize')}</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                {expConfig.focusAreas.slice(0, 3).map((area, i) => (
                  <li key={i}>• {area}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-destructive mb-1">✗ {t('personalizedInsights.minimize')}</p>
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
          {t('personalizedInsights.industryKeywordsToInclude')}
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
            <p className="text-xs text-muted-foreground mb-1">{t('personalizedInsights.valuableCertifications')}</p>
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
            {t('personalizedInsights.recommendedLength', { count: expConfig.resumeLengthPages, level: levelLabel.toLowerCase() })}
          </span>
        </div>
      </div>
    </div>
  );
}
