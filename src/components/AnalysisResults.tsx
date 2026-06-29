import { 
  CheckCircle2, AlertCircle, Lightbulb, Zap, AlertTriangle, ArrowRight, 
  TrendingUp, Gauge, User, Briefcase, Target, BarChart3, Brain, Copy, Check,
  Linkedin, Eye, Search, Star, MessageSquare, Sparkles, FileText, BookOpen, Layout, FileStack,
  ChevronUp, Menu, FileWarning, ListChecks, Users, Hash, Clock, Calendar, Link, Award, Image, Camera
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect } from "react";

export interface LinkedInAnalysis {
  profileScore?: {
    overall: number;
    breakdown: {
      headline: number;
      about: number;
      experience: number;
      skills: number;
      engagement: number;
    };
  };
  completenessChecklist?: {
    hasPhoto: boolean;
    hasBanner: boolean;
    hasCustomUrl: boolean;
    hasCertifications: boolean;
    hasRecommendations: boolean;
    hasProjects: boolean;
    missingItems: string[];
  };
  headlineOptimization?: {
    current: string;
    improved: string;
    whyBetter: string;
  };
  aboutSectionRewrite?: string;
  experienceOptimization?: {
    role: string;
    issue: string;
    improved: string;
  }[];
  skillsToAdd?: string[];
  skillsToRemove?: string[];
  seoKeywords?: string[];
  contentStrategy?: {
    postIdeas: {
      topic: string;
      hook: string;
      format: "text" | "carousel" | "poll" | "video" | "article";
    }[];
    postingFrequency: string;
    bestTimes: string;
    engagementTips: string[];
    hashtagStrategy: string[];
  };
  connectionStrategy?: {
    targetConnections: string[];
    connectionMessageTemplate: string;
    networkingTips: string[];
    groupsToJoin: string[];
  };
  profileVisibilityTips?: string[];
  featuredSectionIdeas?: string[];
  recommendationStrategy?: string;
}

export interface AnalysisData {
  industry?: string;
  experienceLevel?: string;
  hasLinkedIn?: boolean;
  hasJobDescription?: boolean;
  jobDescriptionAlignment?: {
    matchScore: number;
    extractedKeywords: string[];
    missingKeywords: string[];
    suggestedEdits: {
      section: string;
      currentText: string;
      suggestedText: string;
      jdAlignment: string;
    }[];
    roleMatchAnalysis: string;
    gapAnalysis: string;
    toneAnalysis?: {
      jdTone: string;
      resumeTone: string;
      toneMatch: boolean;
      toneGuidance: string;
      phraseSwaps: {
        current: string;
        suggested: string;
        reason: string;
      }[];
    };
    companyInsights?: {
      companyName: string;
      companyType: string;
      cultureSignals: string[];
      valueKeywords: string[];
      languageToUse: {
        value: string;
        resumeLanguage: string;
        bulletExample: string;
      }[];
      redFlagsForThisCompany: string[];
    };
  };
  atsScore?: {
    score: number;
    breakdown: {
      jobTitleMatch: number;
      skillsMatch: number;
      actionVerbUsage: number;
      keywordCoverage: number;
      formattingScore: number;
    };
    improvements: string[];
  };
  readabilityMetrics?: {
    grade: string;
    bulletPointClarity: string;
    jargonLevel: string;
    suggestions: string[];
  };
  formatRecommendations?: {
    currentIssues: string[];
    recommendations: string[];
    sectionOrder: string[];
  };
  atsParsingIssues?: {
    detectedIssues: string[];
    severity: string;
    criticalFixes: string[];
  };
  summaryRewrite?: {
    professionalSummary: string;
    linkedInHeadline: string;
  };
  optimizedBullets?: {
    original: string;
    improved: string;
    reason: string;
  }[];
  quantificationOpportunities?: {
    context: string;
    suggestion: string;
    example: string;
  }[];
  achievementMetrics?: {
    roleType: string;
    typicalMetrics: {
      category: string;
      metricName: string;
      howToMeasure: string;
      exampleRange: string;
      bulletExample: string;
    }[];
    missingFromResume: string[];
    quickWins: string[];
  };
  skillsGap?: {
    missingTechnical: string[];
    missingSoft: string[];
    recommendations: string;
  };
  industryInsights?: {
    whatRecruitersLookFor: string;
    competitiveAdvantage: string;
    commonMistakes: string;
  };
  actionVerbs?: {
    weak: string;
    strong: string;
  }[];
  keywords?: string[];
  redFlags?: string[];
  resumeLength?: {
    recommendedPages: number;
    currentAssessment: string;
    reasoning: string;
  };
  actionPlan?: string[];
  linkedInAnalysis?: LinkedInAnalysis;
}

interface AnalysisResultsProps {
  data: AnalysisData;
}

// Safe array access helper
const safeArray = <T,>(arr: T[] | undefined | null): T[] => arr ?? [];

// Resume strength score — uses the AI's own computed atsScore (job title match,
// skills match, action verbs, keyword coverage, formatting) when available, since
// that reflects actual resume quality rather than how many items the AI happened
// to return. Only falls back to a rough proxy when atsScore is missing entirely,
// and that fallback has no inflated baseline — it starts at 0, not 50.
function calculateResumeScore(data: AnalysisData): { score: number; label: string; color: string } {
  let score: number;

  if (data.atsScore?.score !== undefined) {
    score = data.atsScore.score;
  } else {
    const bullets = safeArray(data.optimizedBullets);
    const verbs = safeArray(data.actionVerbs);
    const keywords = safeArray(data.keywords);
    const flags = safeArray(data.redFlags);

    score = 0;
    score += Math.min(bullets.length * 5, 25);
    score += Math.min(verbs.length * 3, 15);
    score += Math.min(keywords.length * 2, 20);
    score -= Math.min(flags.length * 8, 30);

    if (data.summaryRewrite?.professionalSummary) score += 5;
    if (data.skillsGap && safeArray(data.skillsGap.missingTechnical).length < 3) score += 5;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label: string;
  let color: string;
  
  if (score >= 85) {
    label = "excellent";
    color = "text-success";
  } else if (score >= 70) {
    label = "good";
    color = "text-success";
  } else if (score >= 50) {
    label = "needsImprovement";
    color = "text-warning";
  } else {
    label = "poor";
    color = "text-destructive";
  }
  
  return { score, label, color };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-200 hover:scale-105 active:scale-95"
    >
      {copied ? (
        <>
          <Check className="w-3 h-3" />
          {t('analysisResults.copied')}
        </>
      ) : (
        <>
          <Copy className="w-3 h-3" />
          {label}
        </>
      )}
    </button>
  );
}

// Section Navigation Component
function SectionNav({ sections, activeSection }: { sections: { id: string; label: string; icon: React.ElementType }[]; activeSection: string }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setIsOpen(false);
    }
  };
  
  return (
    <div className="fixed bottom-6 right-6 z-50 no-print">
      {/* Mobile toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden p-3 rounded-full bg-card border border-border shadow-lg hover:shadow-xl transition-all duration-200"
        aria-label={t('analysisResults.toggleNavigation')}
      >
        <Menu className="w-5 h-5 text-foreground" />
      </button>

      {/* Navigation panel */}
      <div className={cn(
        "absolute bottom-full right-0 mb-3 p-2 rounded-xl bg-card/95 backdrop-blur-md border border-border shadow-xl transition-all duration-300",
        "md:relative md:bottom-auto md:mb-0 md:opacity-100 md:scale-100 md:pointer-events-auto",
        isOpen ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none md:opacity-100 md:scale-100 md:pointer-events-auto"
      )}>
        <div className="flex flex-col gap-1 min-w-[180px]">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-1.5">
            {t('analysisResults.jumpToSection')}
          </span>
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200 text-left",
                  activeSection === section.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Back to top button
function BackToTop() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  
  useEffect(() => {
    const handleScroll = () => {
      setShow(window.scrollY > 500);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  
  if (!show) return null;
  
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 left-6 z-50 p-3 rounded-full bg-card border border-border shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-110 no-print"
      aria-label={t('analysisResults.backToTop')}
    >
      <ChevronUp className="w-5 h-5 text-foreground" />
    </button>
  );
}

export function AnalysisResults({ data }: AnalysisResultsProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState("overview");
  
  // Safe array access
  const optimizedBullets = safeArray(data.optimizedBullets);
  const actionVerbs = safeArray(data.actionVerbs);
  const keywords = safeArray(data.keywords);
  const redFlags = safeArray(data.redFlags);
  const actionPlan = safeArray(data.actionPlan);
  const linkedIn = data.linkedInAnalysis;
  
  const stats = [
    { label: t('analysisResults.stats.bulletsImproved'), value: optimizedBullets.length, icon: TrendingUp },
    { label: t('analysisResults.stats.verbUpgrades'), value: actionVerbs.length, icon: Zap },
    { label: t('analysisResults.stats.keywordsAdded'), value: keywords.length, icon: Lightbulb },
    { label: t('analysisResults.stats.issuesFound'), value: redFlags.length, icon: AlertTriangle },
  ];

  const resumeScore = calculateResumeScore(data);
  
  // Build sections for navigation
  const sections = [
    { id: "overview", label: t('analysisResults.nav.overview'), icon: Gauge },
    ...(data.jobDescriptionAlignment ? [{ id: "jdalignment", label: t('analysisResults.nav.jdMatch'), icon: Target }] : []),
    ...(linkedIn ? [{ id: "linkedin", label: t('analysisResults.nav.linkedin'), icon: Linkedin }] : []),
    ...(data.atsParsingIssues && safeArray(data.atsParsingIssues.detectedIssues).length > 0 ? [{ id: "parsing", label: t('analysisResults.nav.parsingIssues'), icon: FileWarning }] : []),
    ...(data.summaryRewrite?.professionalSummary ? [{ id: "summary", label: t('analysisResults.nav.summary'), icon: User }] : []),
    ...(data.industryInsights?.whatRecruitersLookFor ? [{ id: "industry", label: t('analysisResults.nav.industry'), icon: Target }] : []),
    ...(data.skillsGap && (safeArray(data.skillsGap.missingTechnical).length > 0 || safeArray(data.skillsGap.missingSoft).length > 0) ? [{ id: "skills", label: t('analysisResults.nav.skillsGap'), icon: Brain }] : []),
    ...(data.achievementMetrics ? [{ id: "metrics", label: t('analysisResults.nav.metricsGuide'), icon: TrendingUp }] : []),
    ...(optimizedBullets.length > 0 ? [{ id: "bullets", label: t('analysisResults.nav.bullets'), icon: CheckCircle2 }] : []),
    ...(actionVerbs.length > 0 ? [{ id: "verbs", label: t('analysisResults.nav.verbs'), icon: Zap }] : []),
    ...(keywords.length > 0 ? [{ id: "keywords", label: t('analysisResults.nav.keywords'), icon: Lightbulb }] : []),
    ...(redFlags.length > 0 ? [{ id: "redflags", label: t('analysisResults.nav.redFlags'), icon: AlertTriangle }] : []),
    ...(actionPlan.length > 0 ? [{ id: "actionplan", label: t('analysisResults.nav.actionPlan'), icon: ListChecks }] : []),
  ];
  
  // Track active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const sectionElements = sections.map(s => document.getElementById(s.id));
      const scrollPosition = window.scrollY + 200;
      
      for (let i = sectionElements.length - 1; i >= 0; i--) {
        const element = sectionElements[i];
        if (element && element.offsetTop <= scrollPosition) {
          setActiveSection(sections[i].id);
          break;
        }
      }
    };
    
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [sections]);

  return (
    <section className="py-16 md:py-24 relative print-section" id="analysis-results">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-transparent pointer-events-none" />
      
      <div className="container relative">
        <div className="max-w-4xl mx-auto space-y-10">
          {/* Print-only header */}
          <div className="hidden print:block print-header">
            <h1 className="text-2xl font-bold mb-2">{t('analysisResults.printTitle')}</h1>
            <p className="text-sm text-gray-600">{t('analysisResults.generatedOn', { date: new Date().toLocaleDateString() })}</p>
          </div>

          {/* Header with stats */}
          <div className="text-center space-y-8" id="overview">
            <div className="no-print">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-sm text-success mb-4 animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                {data.hasLinkedIn ? t('analysisResults.analysisCompleteWithLinkedIn') : t('analysisResults.analysisComplete')}
              </div>
              <h2 className="text-3xl md:text-4xl font-bold animate-fade-in" style={{ animationDelay: "0.1s" }}>
                {data.hasLinkedIn ? t('analysisResults.fullProfileBreakdown') : t('analysisResults.resumeBreakdown')}
              </h2>
              <p className="text-muted-foreground mt-3 max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "0.2s" }}>
                {t('analysisResults.heroSubtitle')}
              </p>
              
              {/* Industry & Experience Badge */}
              {(data.industry || data.jobDescriptionAlignment) && (
                <div className="flex items-center justify-center gap-3 mt-4 flex-wrap animate-fade-in" style={{ animationDelay: "0.3s" }}>
                  {data.industry && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium">
                      <Briefcase className="w-3 h-3" />
                      {data.industry}
                    </span>
                  )}
                  {data.experienceLevel && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium capitalize">
                      <User className="w-3 h-3" />
                      {t('analysisResults.experienceLevel', { level: data.experienceLevel })}
                    </span>
                  )}
                  {data.hasLinkedIn && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0A66C2]/10 text-[#0A66C2] text-xs font-medium">
                      <Linkedin className="w-3 h-3" />
                      {t('analysisResults.linkedInIncluded')}
                    </span>
                  )}
                  {data.jobDescriptionAlignment && (
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold",
                      data.jobDescriptionAlignment.matchScore >= 70
                        ? "bg-success/10 text-success border border-success/20"
                        : data.jobDescriptionAlignment.matchScore >= 50
                          ? "bg-warning/10 text-warning border border-warning/20"
                          : "bg-destructive/10 text-destructive border border-destructive/20"
                    )}>
                      <Target className="w-3.5 h-3.5" />
                      {t('analysisResults.jdMatchPercent', { score: data.jobDescriptionAlignment.matchScore })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Resume Strength Score */}
            <div className="max-w-md mx-auto animate-fade-in" style={{ animationDelay: "0.4s" }}>
              <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-muted-foreground">{t('analysisResults.resumeStrength')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-2xl font-bold tabular-nums", resumeScore.color)}>
                      {resumeScore.score}
                    </span>
                    <span className="text-muted-foreground">/100</span>
                  </div>
                </div>
                <Progress
                  value={resumeScore.score}
                  className="h-3 bg-muted"
                />
                <div className="flex justify-between items-center mt-3">
                  <span className={cn("text-sm font-medium", resumeScore.color)}>
                    {t(`analysisResults.scoreLabels.${resumeScore.label}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resumeScore.score >= 70
                      ? t('analysisResults.aboveAverage')
                      : t('analysisResults.applySuggestions')}
                  </span>
                </div>
              </div>
            </div>

            {/* JD Match Score - Prominent Display */}
            {data.jobDescriptionAlignment && (
              <div className="max-w-md mx-auto animate-fade-in" style={{ animationDelay: "0.45s" }}>
                <div className={cn(
                  "p-6 rounded-2xl backdrop-blur-sm border transition-all duration-300",
                  data.jobDescriptionAlignment.matchScore >= 70 
                    ? "bg-success/5 border-success/30 hover:border-success/50" 
                    : data.jobDescriptionAlignment.matchScore >= 50 
                      ? "bg-warning/5 border-warning/30 hover:border-warning/50"
                      : "bg-destructive/5 border-destructive/30 hover:border-destructive/50"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className={cn(
                        "w-5 h-5",
                        data.jobDescriptionAlignment.matchScore >= 70 
                          ? "text-success" 
                          : data.jobDescriptionAlignment.matchScore >= 50 
                            ? "text-warning"
                            : "text-destructive"
                      )} />
                      <span className="text-sm font-medium text-muted-foreground">{t('analysisResults.jobDescriptionMatch')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-3xl font-bold tabular-nums",
                        data.jobDescriptionAlignment.matchScore >= 70 
                          ? "text-success" 
                          : data.jobDescriptionAlignment.matchScore >= 50 
                            ? "text-warning"
                            : "text-destructive"
                      )}>
                        {data.jobDescriptionAlignment.matchScore}%
                      </span>
                    </div>
                  </div>
                  <Progress 
                    value={data.jobDescriptionAlignment.matchScore} 
                    className={cn(
                      "h-3",
                      data.jobDescriptionAlignment.matchScore >= 70 
                        ? "[&>div]:bg-success" 
                        : data.jobDescriptionAlignment.matchScore >= 50 
                          ? "[&>div]:bg-warning"
                          : "[&>div]:bg-destructive"
                    )}
                  />
                  <p className="text-xs text-muted-foreground mt-3">
                    {data.jobDescriptionAlignment.matchScore >= 70
                      ? t('analysisResults.strongAlignment')
                      : data.jobDescriptionAlignment.matchScore >= 50
                        ? t('analysisResults.moderateAlignment')
                        : t('analysisResults.lowAlignment')}
                  </p>
                </div>
              </div>
            )}

            {/* ATS Score Section */}
            {data.atsScore && (
              <div className="max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: "0.5s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-muted-foreground">{t('analysisResults.atsCompatibilityScore')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-2xl font-bold tabular-nums", data.atsScore.score >= 70 ? "text-success" : data.atsScore.score >= 50 ? "text-warning" : "text-destructive")}>
                        {data.atsScore.score}
                      </span>
                      <span className="text-muted-foreground">/100</span>
                    </div>
                  </div>
                  <Progress value={data.atsScore.score} className="h-3 bg-muted mb-4" />
                  
                  {data.atsScore.breakdown && (
                    <div className="space-y-2 mb-4">
                      {[
                        { key: 'jobTitleMatch', label: t('analysisResults.breakdown.jobTitleMatch'), max: 15, value: data.atsScore.breakdown.jobTitleMatch },
                        { key: 'skillsMatch', label: t('analysisResults.breakdown.skillsMatch'), max: 30, value: data.atsScore.breakdown.skillsMatch },
                        { key: 'actionVerbUsage', label: t('analysisResults.breakdown.actionVerbUsage'), max: 15, value: data.atsScore.breakdown.actionVerbUsage },
                        { key: 'keywordCoverage', label: t('analysisResults.breakdown.keywordCoverage'), max: 20, value: data.atsScore.breakdown.keywordCoverage },
                        { key: 'formattingScore', label: t('analysisResults.breakdown.formattingScore'), max: 20, value: data.atsScore.breakdown.formattingScore },
                      ].map(({ key, label, max, value }) => (
                        <div key={key} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                          <span className="text-sm text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "font-bold tabular-nums",
                              value / max >= 0.7 ? "text-success" : value / max >= 0.5 ? "text-warning" : "text-destructive"
                            )}>
                              {value}
                            </span>
                            <span className="text-muted-foreground text-sm">/{max}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {safeArray(data.atsScore.improvements).length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.topImprovements')}</span>
                      <ul className="space-y-1">
                        {data.atsScore.improvements.slice(0, 3).map((item, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                            <ArrowRight className="w-3 h-3 text-primary mt-1 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Job Description Alignment Section */}
            {data.jobDescriptionAlignment && (
              <div className="max-w-2xl mx-auto animate-fade-in" id="jdalignment" style={{ animationDelay: "0.52s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-success/30 hover:border-success/50 transition-all duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-success" />
                      <span className="text-sm font-medium">{t('analysisResults.jobDescriptionMatch')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-2xl font-bold tabular-nums", data.jobDescriptionAlignment.matchScore >= 70 ? "text-success" : data.jobDescriptionAlignment.matchScore >= 50 ? "text-warning" : "text-destructive")}>
                        {data.jobDescriptionAlignment.matchScore}%
                      </span>
                    </div>
                  </div>
                  <Progress value={data.jobDescriptionAlignment.matchScore} className="h-3 bg-muted mb-4" />
                  
                  {/* Role Match Analysis */}
                  <p className="text-sm text-muted-foreground mb-4">{data.jobDescriptionAlignment.roleMatchAnalysis}</p>
                  
                  {/* Extracted Keywords */}
                  {safeArray(data.jobDescriptionAlignment.extractedKeywords).length > 0 && (
                    <div className="mb-4">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('analysisResults.jdKeywordsFound')}</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {safeArray(data.jobDescriptionAlignment.extractedKeywords).map((kw, i) => (
                          <span key={i} className="px-2 py-1 rounded-lg bg-success/10 text-success text-xs font-medium">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Missing Keywords */}
                  {safeArray(data.jobDescriptionAlignment.missingKeywords).length > 0 && (
                    <div className="mb-4">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('analysisResults.missingFromResume')}</span>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {safeArray(data.jobDescriptionAlignment.missingKeywords).map((kw, i) => (
                          <span key={i} className="px-2 py-1 rounded-lg bg-warning/10 text-warning text-xs font-medium">{kw}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Suggested Edits */}
                  {safeArray(data.jobDescriptionAlignment.suggestedEdits).length > 0 && (
                    <div className="space-y-3 mt-4">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('analysisResults.suggestedEdits')}</span>
                      {safeArray(data.jobDescriptionAlignment.suggestedEdits).map((edit, i) => (
                        <div key={i} className="p-3 rounded-xl bg-muted/30 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-primary">{edit.section}</span>
                            <span className="text-xs text-muted-foreground">→ {edit.jdAlignment}</span>
                          </div>
                          <p className="text-xs text-destructive line-through">{edit.currentText}</p>
                          <p className="text-xs text-success">{edit.suggestedText}</p>
                          <CopyButton text={edit.suggestedText} label={t('analysisResults.copy')} />
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Gap Analysis */}
                  {data.jobDescriptionAlignment.gapAnalysis && (
                    <div className="mt-4 p-3 rounded-xl bg-warning/5 border border-warning/20">
                      <span className="text-xs font-medium text-warning">{t('analysisResults.gapAnalysis')}</span>
                      <p className="text-sm text-muted-foreground mt-1">{data.jobDescriptionAlignment.gapAnalysis}</p>
                    </div>
                  )}
                  
                  {/* Tone Analysis Section */}
                  {data.jobDescriptionAlignment.toneAnalysis && (
                    <div className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
                      <div className="flex items-center gap-2 mb-3">
                        <MessageSquare className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">{t('analysisResults.voiceToneMatch')}</span>
                        {data.jobDescriptionAlignment.toneAnalysis.toneMatch ? (
                          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold bg-success/20 text-success">
                            ✓ {t('analysisResults.goodMatch')}
                          </span>
                        ) : (
                          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold bg-warning/20 text-warning">
                            {t('analysisResults.needsAdjustment')}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-muted/30 text-center">
                          <span className="text-xs text-muted-foreground block">{t('analysisResults.jdTone')}</span>
                          <span className="text-sm font-semibold capitalize">{data.jobDescriptionAlignment.toneAnalysis.jdTone}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30 text-center">
                          <span className="text-xs text-muted-foreground block">{t('analysisResults.resumeTone')}</span>
                          <span className="text-sm font-semibold capitalize">{data.jobDescriptionAlignment.toneAnalysis.resumeTone}</span>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-4">{data.jobDescriptionAlignment.toneAnalysis.toneGuidance}</p>
                      
                      {/* Phrase Swaps */}
                      {safeArray(data.jobDescriptionAlignment.toneAnalysis.phraseSwaps).length > 0 && (
                        <div className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('analysisResults.phraseAdjustments')}</span>
                          {safeArray(data.jobDescriptionAlignment.toneAnalysis.phraseSwaps).map((swap, i) => (
                            <div key={i} className="p-2 rounded-lg bg-muted/20 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-destructive line-through">{swap.current}</span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span className="text-xs text-success font-medium">{swap.suggested}</span>
                              </div>
                              <p className="text-xs text-muted-foreground italic">{swap.reason}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Company Insights Section */}
                  {data.jobDescriptionAlignment.companyInsights && (
                    <div className="mt-4 p-4 rounded-xl bg-accent/10 border border-accent/20">
                      <div className="flex items-center gap-2 mb-3">
                        <Briefcase className="w-4 h-4 text-accent-foreground" />
                        <span className="text-sm font-semibold text-foreground">
                          {data.jobDescriptionAlignment.companyInsights.companyName !== 'Unknown'
                            ? t('analysisResults.companyCultureFit', { company: data.jobDescriptionAlignment.companyInsights.companyName })
                            : t('analysisResults.genericCultureFit')}
                        </span>
                        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-medium bg-muted capitalize">
                          {data.jobDescriptionAlignment.companyInsights.companyType}
                        </span>
                      </div>
                      
                      {/* Culture Signals */}
                      {safeArray(data.jobDescriptionAlignment.companyInsights.cultureSignals).length > 0 && (
                        <div className="mb-3">
                          <span className="text-xs text-muted-foreground">{t('analysisResults.cultureSignalsDetected')}</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {safeArray(data.jobDescriptionAlignment.companyInsights.cultureSignals).map((signal, i) => (
                              <span key={i} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                                {signal}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Value Keywords to Mirror */}
                      {safeArray(data.jobDescriptionAlignment.companyInsights.valueKeywords).length > 0 && (
                        <div className="mb-3">
                          <span className="text-xs text-muted-foreground">{t('analysisResults.keywordsToMirror')}</span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {safeArray(data.jobDescriptionAlignment.companyInsights.valueKeywords).map((kw, i) => (
                              <span key={i} className="px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">
                                "{kw}"
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* How to Show Company Values */}
                      {safeArray(data.jobDescriptionAlignment.companyInsights.languageToUse).length > 0 && (
                        <div className="space-y-2 mb-3">
                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('analysisResults.showTheseValues')}</span>
                          {safeArray(data.jobDescriptionAlignment.companyInsights.languageToUse).map((item, i) => (
                            <div key={i} className="p-2 rounded-lg bg-success/5 border border-success/10">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-primary">{item.value}</span>
                                <span className="text-xs text-muted-foreground">→ {item.resumeLanguage}</span>
                              </div>
                              <p className="text-xs text-success italic">"{item.bulletExample}"</p>
                              <CopyButton text={item.bulletExample} label={t('analysisResults.copy')} />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Culture Red Flags */}
                      {safeArray(data.jobDescriptionAlignment.companyInsights.redFlagsForThisCompany).length > 0 && (
                        <div className="p-2 rounded-lg bg-destructive/5 border border-destructive/10">
                          <span className="text-xs font-medium text-destructive flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            {t('analysisResults.mayNotResonate')}
                          </span>
                          <ul className="mt-1 space-y-0.5">
                            {safeArray(data.jobDescriptionAlignment.companyInsights.redFlagsForThisCompany).map((flag, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                                <span className="text-destructive">•</span>
                                {flag}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ATS Parsing Issues Section */}
            {data.atsParsingIssues && safeArray(data.atsParsingIssues.detectedIssues).length > 0 && (
              <div className="max-w-2xl mx-auto animate-fade-in" id="parsing" style={{ animationDelay: "0.55s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-warning/30 hover:border-warning/50 transition-all duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <FileWarning className="w-5 h-5 text-warning" />
                      <span className="text-sm font-medium">{t('analysisResults.formattingParsingIssues')}</span>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-xs font-bold uppercase",
                      data.atsParsingIssues.severity === "high" ? "bg-destructive/20 text-destructive" :
                      data.atsParsingIssues.severity === "medium" ? "bg-warning/20 text-warning" :
                      "bg-success/20 text-success"
                    )}>
                      {t('analysisResults.severitySuffix', { severity: data.atsParsingIssues.severity })}
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground mb-4">
                    {t('analysisResults.formattingIssuesWarning')}
                  </p>

                  <div className="space-y-4">
                    {/* Detected Issues */}
                    <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                      <span className="text-xs font-semibold uppercase tracking-wide text-warning flex items-center gap-1.5 mb-2">
                        <AlertTriangle className="w-3 h-3" />
                        {t('analysisResults.detectedIssues')}
                      </span>
                      <ul className="space-y-2">
                        {data.atsParsingIssues.detectedIssues.map((issue, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                            <span className="text-warning mt-0.5">•</span>
                            {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    {/* Critical Fixes */}
                    {safeArray(data.atsParsingIssues.criticalFixes).length > 0 && (
                      <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                        <span className="text-xs font-semibold uppercase tracking-wide text-success flex items-center gap-1.5 mb-2">
                          <CheckCircle2 className="w-3 h-3" />
                          {t('analysisResults.criticalFixes')}
                        </span>
                        <ul className="space-y-2">
                          {data.atsParsingIssues.criticalFixes.map((fix, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <ArrowRight className="w-3 h-3 text-success mt-1 shrink-0" />
                              {fix}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {data.resumeLength && (
              <div className="max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: "0.6s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <FileStack className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium">{t('analysisResults.recommendedLength')}</span>
                    <span className="ml-auto px-3 py-1 rounded-full bg-primary/10 text-primary text-lg font-bold tabular-nums">
                      {t('analysisResults.pageCount', { count: data.resumeLength.recommendedPages })}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.currentAssessment')}</span>
                      <p className="text-sm text-foreground mt-1">{data.resumeLength.currentAssessment}</p>
                    </div>

                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.whyThisLength')}</span>
                      <p className="text-sm text-muted-foreground mt-1">{data.resumeLength.reasoning}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Readability & Format Grid */}
            {(data.readabilityMetrics || data.formatRecommendations) && (
              <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
                {/* Readability Metrics */}
                {data.readabilityMetrics && (
                  <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300 animate-fade-in">
                    <div className="flex items-center gap-2 mb-4">
                      <BookOpen className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium">{t('analysisResults.readability')}</span>
                      <span className={cn(
                        "ml-auto px-2 py-0.5 rounded-full text-xs font-bold",
                        data.readabilityMetrics.grade === "A" ? "bg-success/20 text-success" :
                        data.readabilityMetrics.grade === "B" ? "bg-primary/20 text-primary" :
                        data.readabilityMetrics.grade === "C" ? "bg-warning/20 text-warning" :
                        "bg-destructive/20 text-destructive"
                      )}>
                        {t('analysisResults.gradeSuffix', { grade: data.readabilityMetrics.grade })}
                      </span>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{t('analysisResults.jargonLevel')}</span>
                        <span className={cn(
                          "font-medium capitalize",
                          data.readabilityMetrics.jargonLevel === "low" ? "text-success" :
                          data.readabilityMetrics.jargonLevel === "moderate" ? "text-warning" :
                          "text-destructive"
                        )}>
                          {data.readabilityMetrics.jargonLevel}
                        </span>
                      </div>
                      {data.readabilityMetrics.bulletPointClarity && (
                        <p className="text-xs text-muted-foreground">
                          {data.readabilityMetrics.bulletPointClarity}
                        </p>
                      )}
                    </div>
                    
                    {safeArray(data.readabilityMetrics.suggestions).length > 0 && (
                      <div className="space-y-1.5">
                        {data.readabilityMetrics.suggestions.slice(0, 3).map((s, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <Lightbulb className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                            {s}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Format Recommendations */}
                {data.formatRecommendations && (
                  <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300 animate-fade-in">
                    <div className="flex items-center gap-2 mb-4">
                      <Layout className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium">{t('analysisResults.formatStructure')}</span>
                    </div>

                    {safeArray(data.formatRecommendations.currentIssues).length > 0 && (
                      <div className="mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-destructive">{t('analysisResults.issues')}</span>
                        <ul className="mt-1.5 space-y-1">
                          {data.formatRecommendations.currentIssues.slice(0, 2).map((issue, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <AlertCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                              {issue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {safeArray(data.formatRecommendations.recommendations).length > 0 && (
                      <div className="mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-success">{t('analysisResults.recommendations')}</span>
                        <ul className="mt-1.5 space-y-1">
                          {data.formatRecommendations.recommendations.slice(0, 2).map((rec, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <CheckCircle2 className="w-3 h-3 text-success mt-0.5 shrink-0" />
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    {safeArray(data.formatRecommendations.sectionOrder).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.recommendedSectionOrder')}</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {data.formatRecommendations.sectionOrder.map((section, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-xs">
                              {i + 1}. {section}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.map((stat, index) => {
                const StatIcon = stat.icon;
                return (
                  <div 
                    key={stat.label}
                    className="p-4 rounded-xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300 hover:scale-105 animate-fade-in"
                    style={{ animationDelay: `${0.7 + index * 0.1}s` }}
                  >
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <StatIcon className="w-4 h-4 text-primary" />
                      <span className="text-2xl font-bold text-foreground tabular-nums">{stat.value}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* LinkedIn Analysis Section */}
          {linkedIn && (
            <div className="space-y-6" id="linkedin">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-[#0A66C2]/10">
                  <Linkedin className="w-6 h-6 text-[#0A66C2]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">{t('analysisResults.linkedInProfileOptimization')}</h3>
                  <p className="text-sm text-muted-foreground">{t('analysisResults.linkedInOptimizationSubtitle')}</p>
                </div>
              </div>

              {/* Profile Score */}
              {linkedIn.profileScore && (
                <div className="p-6 rounded-2xl bg-gradient-to-br from-[#0A66C2]/5 to-[#0A66C2]/10 border border-[#0A66C2]/20">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-5 h-5 text-[#0A66C2]" />
                      <span className="font-semibold">{t('analysisResults.linkedInProfileScore')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-3xl font-bold tabular-nums",
                        linkedIn.profileScore.overall >= 80 ? "text-success" :
                        linkedIn.profileScore.overall >= 60 ? "text-[#0A66C2]" :
                        linkedIn.profileScore.overall >= 40 ? "text-warning" : "text-destructive"
                      )}>
                        {linkedIn.profileScore.overall}
                      </span>
                      <span className="text-muted-foreground">/100</span>
                    </div>
                  </div>
                  <Progress value={linkedIn.profileScore.overall} className="h-3 mb-4" />
                  
                  <div className="grid grid-cols-5 gap-2">
                    {Object.entries(linkedIn.profileScore.breakdown).map(([key, value]) => (
                      <div key={key} className="text-center p-2 rounded-lg bg-card/50">
                        <div className={cn(
                          "text-lg font-bold tabular-nums",
                          value >= 16 ? "text-success" : value >= 12 ? "text-[#0A66C2]" : value >= 8 ? "text-warning" : "text-destructive"
                        )}>
                          {value}/20
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">{key}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completeness Checklist */}
              {linkedIn.completenessChecklist && (
                <ResultCard
                  icon={ListChecks}
                  title={t('analysisResults.profileCompleteness')}
                  subtitle={t('analysisResults.profileCompletenessSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    {[
                      { key: "hasPhoto", label: t('analysisResults.checklist.profilePhoto'), icon: Camera },
                      { key: "hasBanner", label: t('analysisResults.checklist.bannerImage'), icon: Image },
                      { key: "hasCustomUrl", label: t('analysisResults.checklist.customUrl'), icon: Link },
                      { key: "hasCertifications", label: t('analysisResults.checklist.certifications'), icon: Award },
                      { key: "hasRecommendations", label: t('analysisResults.checklist.recommendations'), icon: MessageSquare },
                      { key: "hasProjects", label: t('analysisResults.checklist.projects'), icon: FileStack },
                    ].map(({ key, label, icon: Icon }) => {
                      const hasItem = linkedIn.completenessChecklist?.[key as keyof typeof linkedIn.completenessChecklist];
                      return (
                        <div key={key} className={cn(
                          "flex items-center gap-2 p-3 rounded-lg border transition-colors",
                          hasItem 
                            ? "bg-success/5 border-success/20" 
                            : "bg-warning/5 border-warning/20"
                        )}>
                          <Icon className={cn("w-4 h-4", hasItem ? "text-success" : "text-warning")} />
                          <span className="text-sm">{label}</span>
                          {hasItem ? (
                            <CheckCircle2 className="w-4 h-4 text-success ml-auto" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-warning ml-auto" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {safeArray(linkedIn.completenessChecklist.missingItems).length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.whatsMissing')}</span>
                      {linkedIn.completenessChecklist.missingItems.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-warning/5 border border-warning/20">
                          <AlertTriangle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
                          <span className="text-xs text-foreground">{item}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </ResultCard>
              )}

              {/* Content Strategy */}
              {linkedIn.contentStrategy && (
                <ResultCard
                  icon={FileText}
                  title={t('analysisResults.contentStrategy')}
                  subtitle={t('analysisResults.contentStrategySubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-5">
                    {/* Posting Schedule */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Calendar className="w-4 h-4 text-[#0A66C2]" />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.frequency')}</span>
                        </div>
                        <p className="text-sm text-foreground">{linkedIn.contentStrategy.postingFrequency}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="w-4 h-4 text-[#0A66C2]" />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.bestTimes')}</span>
                        </div>
                        <p className="text-sm text-foreground">{linkedIn.contentStrategy.bestTimes}</p>
                      </div>
                    </div>

                    {/* Post Ideas */}
                    {safeArray(linkedIn.contentStrategy.postIdeas).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">{t('analysisResults.contentIdeas')}</span>
                        <div className="space-y-3">
                          {linkedIn.contentStrategy.postIdeas.map((idea, i) => (
                            <div key={i} className="p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-sm text-foreground">{idea.topic}</span>
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-xs font-medium",
                                  idea.format === "carousel" ? "bg-purple-500/20 text-purple-500" :
                                  idea.format === "poll" ? "bg-amber-500/20 text-amber-500" :
                                  idea.format === "video" ? "bg-red-500/20 text-red-500" :
                                  idea.format === "article" ? "bg-blue-500/20 text-blue-500" :
                                  "bg-muted text-muted-foreground"
                                )}>
                                  {idea.format}
                                </span>
                              </div>
                              <div className="flex items-start gap-2">
                                <Sparkles className="w-3 h-3 text-[#0A66C2] mt-1 shrink-0" />
                                <p className="text-xs text-muted-foreground italic">"{idea.hook}"</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hashtags */}
                    {safeArray(linkedIn.contentStrategy.hashtagStrategy).length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <Hash className="w-4 h-4 text-[#0A66C2]" />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.hashtagsToUse')}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.contentStrategy.hashtagStrategy.map((tag, i) => (
                            <span key={i} className="px-3 py-1.5 rounded-full bg-[#0A66C2]/10 border border-[#0A66C2]/20 text-sm text-[#0A66C2]">
                              #{tag.replace(/^#/, "")}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Engagement Tips */}
                    {safeArray(linkedIn.contentStrategy.engagementTips).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">{t('analysisResults.engagementTips')}</span>
                        <ul className="space-y-2">
                          {linkedIn.contentStrategy.engagementTips.map((tip, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <Lightbulb className="w-4 h-4 text-[#0A66C2] mt-0.5 shrink-0" />
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </ResultCard>
              )}

              {/* Connection Strategy */}
              {linkedIn.connectionStrategy && (
                <ResultCard
                  icon={Users}
                  title={t('analysisResults.connectionStrategy')}
                  subtitle={t('analysisResults.connectionStrategySubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-5">
                    {/* Target Connections */}
                    {safeArray(linkedIn.connectionStrategy.targetConnections).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">{t('analysisResults.whoToConnectWith')}</span>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.connectionStrategy.targetConnections.map((target, i) => (
                            <span key={i} className="px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-sm text-success">
                              {target}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Connection Message Template */}
                    {linkedIn.connectionStrategy.connectionMessageTemplate && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.connectionRequestTemplate')}</span>
                          <CopyButton text={linkedIn.connectionStrategy.connectionMessageTemplate} label={t('analysisResults.copyTemplate')} />
                        </div>
                        <div className="p-4 rounded-xl bg-muted/30 border border-border">
                          <p className="text-sm text-foreground whitespace-pre-line">{linkedIn.connectionStrategy.connectionMessageTemplate}</p>
                        </div>
                      </div>
                    )}

                    {/* Groups to Join */}
                    {safeArray(linkedIn.connectionStrategy.groupsToJoin).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">{t('analysisResults.groupsToJoin')}</span>
                        <div className="space-y-2">
                          {linkedIn.connectionStrategy.groupsToJoin.map((group, i) => (
                            <div key={i} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                              <Users className="w-4 h-4 text-[#0A66C2]" />
                              <span className="text-sm text-foreground">{group}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Networking Tips */}
                    {safeArray(linkedIn.connectionStrategy.networkingTips).length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">{t('analysisResults.networkingTips')}</span>
                        <ul className="space-y-2">
                          {linkedIn.connectionStrategy.networkingTips.map((tip, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <ArrowRight className="w-4 h-4 text-[#0A66C2] mt-0.5 shrink-0" />
                              {tip}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </ResultCard>
              )}

              {/* Headline Optimization */}
              {linkedIn.headlineOptimization && (
                <ResultCard
                  icon={User}
                  title={t('analysisResults.headlineOptimization')}
                  subtitle={t('analysisResults.headlineOptimizationSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-destructive">{t('analysisResults.current')}</span>
                      </div>
                      <p className="text-sm text-foreground">{linkedIn.headlineOptimization.current || t('analysisResults.noHeadlineFound')}</p>
                    </div>

                    <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-success">{t('analysisResults.improved')}</span>
                        <CopyButton text={linkedIn.headlineOptimization.improved} label={t('analysisResults.copyHeadline')} />
                      </div>
                      <p className="text-sm font-medium text-foreground">{linkedIn.headlineOptimization.improved}</p>
                    </div>
                    
                    {linkedIn.headlineOptimization.whyBetter && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30">
                        <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground">{linkedIn.headlineOptimization.whyBetter}</p>
                      </div>
                    )}
                  </div>
                </ResultCard>
              )}

              {/* About Section Rewrite */}
              {linkedIn.aboutSectionRewrite && (
                <ResultCard
                  icon={FileText}
                  title={t('analysisResults.aboutSectionRewrite')}
                  subtitle={t('analysisResults.aboutSectionRewriteSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="p-4 rounded-xl bg-muted/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('analysisResults.yourNewAboutSection')}</span>
                      <CopyButton text={linkedIn.aboutSectionRewrite} label={t('analysisResults.copyAbout')} />
                    </div>
                    <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                      {linkedIn.aboutSectionRewrite}
                    </p>
                  </div>
                </ResultCard>
              )}

              {/* Experience Optimization */}
              {safeArray(linkedIn.experienceOptimization).length > 0 && (
                <ResultCard
                  icon={Briefcase}
                  title={t('analysisResults.experienceDescriptions')}
                  subtitle={t('analysisResults.experienceDescriptionsSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    {linkedIn.experienceOptimization!.map((exp, index) => (
                      <div key={index} className="p-4 rounded-xl bg-muted/30">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-foreground">{exp.role}</span>
                          <CopyButton text={exp.improved} label={t('analysisResults.copy')} />
                        </div>
                        {exp.issue && (
                          <div className="flex items-start gap-2 mb-3 p-2 rounded-lg bg-warning/5 border border-warning/20">
                            <AlertTriangle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
                            <p className="text-xs text-warning">{exp.issue}</p>
                          </div>
                        )}
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <span className="text-xs font-semibold uppercase tracking-wide text-success">{t('analysisResults.improved')}</span>
                          <p className="text-sm text-foreground mt-1">{exp.improved}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ResultCard>
              )}

              {/* Skills Optimization */}
              {(safeArray(linkedIn.skillsToAdd).length > 0 || safeArray(linkedIn.skillsToRemove).length > 0) && (
                <ResultCard
                  icon={Star}
                  title={t('analysisResults.skillsOptimization')}
                  subtitle={t('analysisResults.skillsOptimizationSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-5">
                    {safeArray(linkedIn.skillsToAdd).length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-3 flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3" />
                          {t('analysisResults.skillsToAdd')}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.skillsToAdd!.map((skill, index) => (
                            <span key={index} className="px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-sm font-medium text-success">
                              + {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {safeArray(linkedIn.skillsToRemove).length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-destructive mb-3 flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" />
                          {t('analysisResults.considerRemoving')}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.skillsToRemove!.map((skill, index) => (
                            <span key={index} className="px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/20 text-sm font-medium text-destructive line-through">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </ResultCard>
              )}

              {/* SEO Keywords */}
              {safeArray(linkedIn.seoKeywords).length > 0 && (
                <ResultCard
                  icon={Search}
                  title={t('analysisResults.seoKeywords')}
                  subtitle={t('analysisResults.seoKeywordsSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="flex flex-wrap gap-2">
                    {linkedIn.seoKeywords!.map((keyword, index) => (
                      <span key={index} className="px-4 py-2 rounded-full bg-[#0A66C2]/10 border border-[#0A66C2]/20 text-sm font-medium text-[#0A66C2]">
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    {t('analysisResults.seoKeywordsTip')}
                  </p>
                </ResultCard>
              )}

              {/* Profile Visibility Tips */}
              {safeArray(linkedIn.profileVisibilityTips).length > 0 && (
                <ResultCard
                  icon={Eye}
                  title={t('analysisResults.profileVisibilityTips')}
                  subtitle={t('analysisResults.profileVisibilityTipsSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <ul className="space-y-3">
                    {linkedIn.profileVisibilityTips!.map((tip, index) => (
                      <li key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="w-6 h-6 rounded-full bg-[#0A66C2]/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-[#0A66C2]">{index + 1}</span>
                        </div>
                        <span className="text-sm text-foreground">{tip}</span>
                      </li>
                    ))}
                  </ul>
                </ResultCard>
              )}

              {/* Featured Section Ideas */}
              {safeArray(linkedIn.featuredSectionIdeas).length > 0 && (
                <ResultCard
                  icon={Star}
                  title={t('analysisResults.featuredSectionIdeas')}
                  subtitle={t('analysisResults.featuredSectionIdeasSubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-3">
                    {linkedIn.featuredSectionIdeas!.map((idea, index) => (
                      <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <Sparkles className="w-4 h-4 text-[#0A66C2] mt-0.5 shrink-0" />
                        <span className="text-sm text-foreground">{idea}</span>
                      </div>
                    ))}
                  </div>
                </ResultCard>
              )}

              {/* Recommendation Strategy */}
              {linkedIn.recommendationStrategy && (
                <ResultCard
                  icon={MessageSquare}
                  title={t('analysisResults.recommendationStrategy')}
                  subtitle={t('analysisResults.recommendationStrategySubtitle')}
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="p-4 rounded-xl bg-muted/30">
                    <p className="text-sm leading-relaxed text-foreground">{linkedIn.recommendationStrategy}</p>
                  </div>
                </ResultCard>
              )}
            </div>
          )}

          {/* Divider between LinkedIn and Resume sections */}
          {linkedIn && (
            <div className="flex items-center gap-4 py-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-sm font-medium text-muted-foreground">{t('analysisResults.resumeAnalysis')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* Summary & LinkedIn Rewrite */}
          {data.summaryRewrite?.professionalSummary && (
            <div id="summary">
              <ResultCard
                icon={User}
                title={t('analysisResults.professionalSummaryLinkedIn')}
                subtitle={t('analysisResults.professionalSummaryLinkedInSubtitle')}
                iconColor="text-primary"
                bgColor="bg-primary/10"
                borderColor="border-primary/20"
              >
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-muted/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('analysisResults.professionalSummary')}
                      </span>
                      <CopyButton text={data.summaryRewrite.professionalSummary} label={t('analysisResults.copySummary')} />
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">
                      {data.summaryRewrite.professionalSummary}
                    </p>
                  </div>

                  {data.summaryRewrite.linkedInHeadline && (
                    <div className="p-4 rounded-xl bg-muted/30">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('analysisResults.linkedInHeadline')}
                        </span>
                        <CopyButton text={data.summaryRewrite.linkedInHeadline} label={t('analysisResults.copyHeadline')} />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {data.summaryRewrite.linkedInHeadline}
                      </p>
                    </div>
                  )}
                </div>
              </ResultCard>
            </div>
          )}

          {/* Industry Insights */}
          {data.industryInsights?.whatRecruitersLookFor && (
            <div id="industry">
              <ResultCard
                icon={Target}
                title={t('analysisResults.industryInsightsTitle', { industry: data.industry || t('analysisResults.industryFallback') })}
                subtitle={t('analysisResults.industryInsightsSubtitle')}
                iconColor="text-cyan-500"
                bgColor="bg-cyan-500/10"
                borderColor="border-cyan-500/20"
              >
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-muted/30">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      {t('analysisResults.whatRecruitersLookFor')}
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">
                      {data.industryInsights.whatRecruitersLookFor}
                    </p>
                  </div>

                  {data.industryInsights.competitiveAdvantage && (
                    <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-2">
                        {t('analysisResults.yourCompetitiveEdge')}
                      </h4>
                      <p className="text-sm text-foreground leading-relaxed">
                        {data.industryInsights.competitiveAdvantage}
                      </p>
                    </div>
                  )}

                  {data.industryInsights.commonMistakes && (
                    <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-warning mb-2">
                        {t('analysisResults.commonMistakesToAvoid')}
                      </h4>
                      <p className="text-sm text-foreground leading-relaxed">
                        {data.industryInsights.commonMistakes}
                      </p>
                    </div>
                  )}
                </div>
              </ResultCard>
            </div>
          )}

          {/* Skills Gap Analysis */}
          {data.skillsGap && (safeArray(data.skillsGap.missingTechnical).length > 0 || safeArray(data.skillsGap.missingSoft).length > 0) && (
            <div id="skills">
              <ResultCard
                icon={Brain}
                title={t('analysisResults.skillsGapAnalysis')}
                subtitle={t('analysisResults.skillsGapAnalysisSubtitle')}
                iconColor="text-violet-500"
                bgColor="bg-violet-500/10"
                borderColor="border-violet-500/20"
              >
                <div className="space-y-5">
                  {safeArray(data.skillsGap.missingTechnical).length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        {t('analysisResults.technicalSkillsToAdd')}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {data.skillsGap.missingTechnical.map((skill, index) => (
                          <span
                            key={index}
                            className="px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-sm font-medium text-violet-400"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {safeArray(data.skillsGap.missingSoft).length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        {t('analysisResults.softSkillsToHighlight')}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {data.skillsGap.missingSoft.map((skill, index) => (
                          <span
                            key={index}
                            className="px-3 py-1.5 rounded-full bg-muted text-sm font-medium text-foreground"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {data.skillsGap.recommendations && (
                    <div className="p-4 rounded-xl bg-muted/30 mt-4">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {data.skillsGap.recommendations}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ResultCard>
            </div>
          )}

          {/* Quantification Opportunities */}
          {safeArray(data.quantificationOpportunities).length > 0 && (
            <ResultCard
              icon={BarChart3}
              title={t('analysisResults.quantificationOpportunities')}
              subtitle={t('analysisResults.quantificationOpportunitiesSubtitle')}
              iconColor="text-emerald-500"
              bgColor="bg-emerald-500/10"
              borderColor="border-emerald-500/20"
            >
              <div className="space-y-4">
                {data.quantificationOpportunities!.map((opp, index) => (
                  <div key={index} className="p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                    <p className="text-sm text-muted-foreground mb-2">
                      <span className="font-medium text-foreground">"{opp.context}"</span>
                    </p>
                    <p className="text-sm text-muted-foreground mb-3">
                      → {opp.suggestion}
                    </p>
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500">{t('analysisResults.example')}</span>
                      <p className="text-sm font-medium text-foreground mt-1">{opp.example}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* Achievement Metrics - Role-Specific Quantification Guide */}
          {data.achievementMetrics && (
            <div id="metrics">
              <ResultCard
                icon={TrendingUp}
                title={t('analysisResults.metricsForRole', { role: data.achievementMetrics.roleType })}
                subtitle={t('analysisResults.metricsForRoleSubtitle')}
                iconColor="text-violet-500"
                bgColor="bg-violet-500/10"
                borderColor="border-violet-500/20"
              >
                <div className="space-y-4">
                  {/* Quick Wins */}
                  {safeArray(data.achievementMetrics.quickWins).length > 0 && (
                    <div className="p-4 rounded-xl bg-success/10 border border-success/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-success" />
                        <span className="text-sm font-semibold text-success">{t('analysisResults.quickWinsTitle')}</span>
                      </div>
                      <ul className="space-y-1.5">
                        {safeArray(data.achievementMetrics.quickWins).map((win, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                            <CheckCircle2 className="w-3.5 h-3.5 text-success mt-0.5 shrink-0" />
                            {win}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Missing Metrics */}
                  {safeArray(data.achievementMetrics.missingFromResume).length > 0 && (
                    <div className="p-4 rounded-xl bg-warning/10 border border-warning/30">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-warning" />
                        <span className="text-sm font-semibold text-warning">{t('analysisResults.missingFromResumeTitle')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {safeArray(data.achievementMetrics.missingFromResume).map((metric, i) => (
                          <span key={i} className="px-2 py-1 rounded-lg bg-warning/20 text-warning text-xs font-medium">
                            {metric}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Typical Metrics for Role */}
                  {safeArray(data.achievementMetrics.typicalMetrics).length > 0 && (
                    <div className="space-y-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('analysisResults.keyMetricsForRole', { role: data.achievementMetrics.roleType })}
                      </span>
                      {safeArray(data.achievementMetrics.typicalMetrics).map((metric, i) => (
                        <div key={i} className="p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-500/20 text-violet-600 dark:text-violet-400">
                                {metric.category}
                              </span>
                              <span className="text-sm font-semibold text-foreground">{metric.metricName}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{metric.exampleRange}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">
                            <span className="font-medium">{t('analysisResults.howToMeasure')}</span> {metric.howToMeasure}
                          </p>
                          <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                            <p className="text-sm text-foreground">{metric.bulletExample}</p>
                            <div className="mt-2">
                              <CopyButton text={metric.bulletExample} label={t('analysisResults.copyExample')} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ResultCard>
            </div>
          )}

          {/* ATS-Optimized Bullets */}
          {optimizedBullets.length > 0 && (
            <div id="bullets">
              <ResultCard
                icon={CheckCircle2}
                title={t('analysisResults.atsOptimizedBullets')}
                subtitle={t('analysisResults.atsOptimizedBulletsSubtitle')}
                iconColor="text-success"
                bgColor="bg-success/10"
                borderColor="border-success/20"
              >
                <div className="space-y-6">
                  {optimizedBullets.map((bullet, index) => (
                    <div key={index} className="group">
                      <div className="grid md:grid-cols-2 gap-4 p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                              {t('analysisResults.before')}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {bullet.original}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                              {t('analysisResults.after')}
                            </span>
                            <CopyButton text={bullet.improved} label={t('analysisResults.copy')} />
                          </div>
                          <p className="text-sm text-foreground leading-relaxed font-medium">
                            {bullet.improved}
                          </p>
                        </div>
                      </div>
                      
                      {bullet.reason && (
                        <div className="flex items-start gap-2 mt-3 px-4">
                          <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                          <p className="text-xs text-muted-foreground italic">
                            {bullet.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ResultCard>
            </div>
          )}

          {/* Action Verbs */}
          {actionVerbs.length > 0 && (
            <div id="verbs">
              <ResultCard
                icon={Zap}
                title={t('analysisResults.strongerActionVerbs')}
                subtitle={t('analysisResults.strongerActionVerbsSubtitle')}
                iconColor="text-warning"
                bgColor="bg-warning/10"
                borderColor="border-warning/20"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {actionVerbs.map((verb, index) => (
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
            </div>
          )}

          {/* Keywords */}
          {keywords.length > 0 && (
            <div id="keywords">
              <ResultCard
                icon={Lightbulb}
                title={t('analysisResults.recommendedKeywords')}
                subtitle={t('analysisResults.recommendedKeywordsSubtitle')}
                iconColor="text-primary"
                bgColor="bg-primary/10"
                borderColor="border-primary/20"
              >
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword, index) => (
                    <span
                      key={index}
                      className="px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm font-medium text-primary hover:bg-primary/20 transition-colors cursor-default"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  {t('analysisResults.recommendedKeywordsTip')}
                </p>
              </ResultCard>
            </div>
          )}

          {/* Red Flags */}
          {redFlags.length > 0 && (
            <div id="redflags">
              <ResultCard
                icon={AlertTriangle}
                title={t('analysisResults.redFlagsToFix')}
                subtitle={t('analysisResults.redFlagsToFixSubtitle')}
                iconColor="text-destructive"
                bgColor="bg-destructive/10"
                borderColor="border-destructive/20"
              >
                <ul className="space-y-3">
                  {redFlags.map((flag, index) => (
                    <li 
                      key={index} 
                      className="flex items-start gap-3 p-3 rounded-xl bg-destructive/5 border border-destructive/10 hover:bg-destructive/10 transition-colors"
                    >
                      <AlertCircle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
                      <span className="text-sm text-foreground leading-relaxed">{flag}</span>
                    </li>
                  ))}
                </ul>
            </ResultCard>
            </div>
          )}

          {/* Action Plan / Sprint Checklist */}
          {actionPlan.length > 0 && (
            <div id="actionplan">
              <ResultCard
                icon={ListChecks}
                title={t('analysisResults.actionPlan')}
                subtitle={t('analysisResults.actionPlanSubtitle')}
                iconColor="text-success"
                bgColor="bg-success/10"
                borderColor="border-success/20"
              >
                <div className="space-y-3">
                  {actionPlan.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 p-4 rounded-xl bg-success/5 border border-success/10 hover:bg-success/10 transition-colors group"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/20 text-success font-bold text-sm shrink-0">
                        {index + 1}
                      </div>
                      <span className="text-sm text-foreground leading-relaxed pt-1">{item}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4">
                  {t('analysisResults.actionPlanTip')}
                </p>
              </ResultCard>
            </div>
          )}

          {/* Empty State - Show when no meaningful data */}
          {optimizedBullets.length === 0 && actionVerbs.length === 0 && keywords.length === 0 && redFlags.length === 0 && !data.summaryRewrite?.professionalSummary && (
            <div className="text-center py-12 px-6 rounded-2xl bg-card/50 border border-border/50">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t('analysisResults.analysisProcessing')}</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                {t('analysisResults.analysisProcessingDescription')}
              </p>
            </div>
          )}

          {/* Bottom CTA */}
          <div className="text-center pt-8 space-y-4">
            <p className="text-muted-foreground">
              {data.hasLinkedIn ? t('analysisResults.bottomCtaWithLinkedIn') : t('analysisResults.bottomCta')}
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span>{t('analysisResults.analysisSaved')}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Navigation and Back to Top */}
      {sections.length > 3 && <SectionNav sections={sections} activeSection={activeSection} />}
      <BackToTop />
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
    <div className="rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 overflow-hidden animate-fade-in hover:border-primary/20 transition-all duration-300 pdf-keep-together">
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
      
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
