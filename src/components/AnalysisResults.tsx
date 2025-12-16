import { 
  CheckCircle2, AlertCircle, Lightbulb, Zap, AlertTriangle, ArrowRight, 
  TrendingUp, Gauge, User, Briefcase, Target, BarChart3, Brain, Copy, Check,
  Linkedin, Eye, Search, Star, MessageSquare, Sparkles, FileText, BookOpen, Layout, FileStack,
  ChevronUp, Menu
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect } from "react";

export interface LinkedInAnalysis {
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
  profileVisibilityTips?: string[];
  featuredSectionIdeas?: string[];
  recommendationStrategy?: string;
}

export interface AnalysisData {
  industry?: string;
  experienceLevel?: string;
  hasLinkedIn?: boolean;
  atsScore?: {
    score: number;
    breakdown: {
      keywordMatch: number;
      formatting: number;
      structure: number;
      relevance: number;
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
  linkedInAnalysis?: LinkedInAnalysis;
}

interface AnalysisResultsProps {
  data: AnalysisData;
}

// Safe array access helper
const safeArray = <T,>(arr: T[] | undefined | null): T[] => arr ?? [];

// Calculate resume strength score based on analysis
function calculateResumeScore(data: AnalysisData): { score: number; label: string; color: string } {
  let score = 50;
  
  const bullets = safeArray(data.optimizedBullets);
  const verbs = safeArray(data.actionVerbs);
  const keywords = safeArray(data.keywords);
  const flags = safeArray(data.redFlags);
  
  score += Math.min(bullets.length * 3, 15);
  score += Math.min(verbs.length * 2, 10);
  score += Math.min(keywords.length * 1.5, 15);
  score -= Math.min(flags.length * 8, 30);
  
  if (data.summaryRewrite?.professionalSummary) score += 5;
  if (data.skillsGap && safeArray(data.skillsGap.missingTechnical).length < 3) score += 5;
  
  score = Math.max(0, Math.min(100, Math.round(score)));
  
  let label: string;
  let color: string;
  
  if (score >= 80) {
    label = "Excellent";
    color = "text-success";
  } else if (score >= 65) {
    label = "Good";
    color = "text-primary";
  } else if (score >= 50) {
    label = "Fair";
    color = "text-warning";
  } else {
    label = "Needs Work";
    color = "text-destructive";
  }
  
  return { score, label, color };
}

function CopyButton({ text, label }: { text: string; label: string }) {
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
          Copied!
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
        aria-label="Toggle navigation"
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
            Jump to Section
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
      aria-label="Back to top"
    >
      <ChevronUp className="w-5 h-5 text-foreground" />
    </button>
  );
}

export function AnalysisResults({ data }: AnalysisResultsProps) {
  const [activeSection, setActiveSection] = useState("overview");
  
  // Safe array access
  const optimizedBullets = safeArray(data.optimizedBullets);
  const actionVerbs = safeArray(data.actionVerbs);
  const keywords = safeArray(data.keywords);
  const redFlags = safeArray(data.redFlags);
  const linkedIn = data.linkedInAnalysis;
  
  const stats = [
    { label: "Bullets Improved", value: optimizedBullets.length, icon: TrendingUp },
    { label: "Verb Upgrades", value: actionVerbs.length, icon: Zap },
    { label: "Keywords Added", value: keywords.length, icon: Lightbulb },
    { label: "Issues Found", value: redFlags.length, icon: AlertTriangle },
  ];

  const resumeScore = calculateResumeScore(data);
  
  // Build sections for navigation
  const sections = [
    { id: "overview", label: "Overview", icon: Gauge },
    ...(linkedIn ? [{ id: "linkedin", label: "LinkedIn", icon: Linkedin }] : []),
    ...(data.summaryRewrite?.professionalSummary ? [{ id: "summary", label: "Summary", icon: User }] : []),
    ...(data.industryInsights?.whatRecruitersLookFor ? [{ id: "industry", label: "Industry", icon: Target }] : []),
    ...(data.skillsGap && (safeArray(data.skillsGap.missingTechnical).length > 0 || safeArray(data.skillsGap.missingSoft).length > 0) ? [{ id: "skills", label: "Skills Gap", icon: Brain }] : []),
    ...(optimizedBullets.length > 0 ? [{ id: "bullets", label: "Bullets", icon: CheckCircle2 }] : []),
    ...(actionVerbs.length > 0 ? [{ id: "verbs", label: "Verbs", icon: Zap }] : []),
    ...(keywords.length > 0 ? [{ id: "keywords", label: "Keywords", icon: Lightbulb }] : []),
    ...(redFlags.length > 0 ? [{ id: "redflags", label: "Red Flags", icon: AlertTriangle }] : []),
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
            <h1 className="text-2xl font-bold mb-2">Resume Booster Analysis</h1>
            <p className="text-sm text-gray-600">Generated on {new Date().toLocaleDateString()}</p>
          </div>

          {/* Header with stats */}
          <div className="text-center space-y-8" id="overview">
            <div className="no-print">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-sm text-success mb-4 animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                Analysis Complete {data.hasLinkedIn && "+ LinkedIn"}
              </div>
              <h2 className="text-3xl md:text-4xl font-bold animate-fade-in" style={{ animationDelay: "0.1s" }}>
                Your {data.hasLinkedIn ? "Full Profile" : "Resume"} Breakdown
              </h2>
              <p className="text-muted-foreground mt-3 max-w-lg mx-auto animate-fade-in" style={{ animationDelay: "0.2s" }}>
                Here is what we found and how to fix it. Apply these changes to increase your interview chances.
              </p>
              
              {/* Industry & Experience Badge */}
              {data.industry && (
                <div className="flex items-center justify-center gap-3 mt-4 flex-wrap animate-fade-in" style={{ animationDelay: "0.3s" }}>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium">
                    <Briefcase className="w-3 h-3" />
                    {data.industry}
                  </span>
                  {data.experienceLevel && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-medium capitalize">
                      <User className="w-3 h-3" />
                      {data.experienceLevel} level
                    </span>
                  )}
                  {data.hasLinkedIn && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0A66C2]/10 text-[#0A66C2] text-xs font-medium">
                      <Linkedin className="w-3 h-3" />
                      LinkedIn included
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
                    <span className="text-sm font-medium text-muted-foreground">Resume Strength</span>
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
                    {resumeScore.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {resumeScore.score >= 65 
                      ? "Above average for your industry" 
                      : "Apply our suggestions to improve"}
                  </span>
                </div>
              </div>
            </div>

            {/* ATS Score Section */}
            {data.atsScore && (
              <div className="max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: "0.5s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-muted-foreground">ATS Compatibility Score</span>
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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {Object.entries(data.atsScore.breakdown).map(([key, value]) => (
                        <div key={key} className="text-center p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                          <div className="text-lg font-bold text-foreground tabular-nums">{value}</div>
                          <div className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {safeArray(data.atsScore.improvements).length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top Improvements</span>
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

            {/* Resume Length Recommendation */}
            {data.resumeLength && (
              <div className="max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: "0.6s" }}>
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 hover:border-primary/30 transition-all duration-300">
                  <div className="flex items-center gap-2 mb-4">
                    <FileStack className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium">Recommended Resume Length</span>
                    <span className="ml-auto px-3 py-1 rounded-full bg-primary/10 text-primary text-lg font-bold tabular-nums">
                      {data.resumeLength.recommendedPages} {data.resumeLength.recommendedPages === 1 ? 'Page' : 'Pages'}
                    </span>
                  </div>
                  
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Assessment</span>
                      <p className="text-sm text-foreground mt-1">{data.resumeLength.currentAssessment}</p>
                    </div>
                    
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why This Length?</span>
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
                      <span className="text-sm font-medium">Readability</span>
                      <span className={cn(
                        "ml-auto px-2 py-0.5 rounded-full text-xs font-bold",
                        data.readabilityMetrics.grade === "A" ? "bg-success/20 text-success" :
                        data.readabilityMetrics.grade === "B" ? "bg-primary/20 text-primary" :
                        data.readabilityMetrics.grade === "C" ? "bg-warning/20 text-warning" :
                        "bg-destructive/20 text-destructive"
                      )}>
                        Grade {data.readabilityMetrics.grade}
                      </span>
                    </div>
                    
                    <div className="space-y-3 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Jargon Level</span>
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
                      <span className="text-sm font-medium">Format & Structure</span>
                    </div>
                    
                    {safeArray(data.formatRecommendations.currentIssues).length > 0 && (
                      <div className="mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-destructive">Issues</span>
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
                        <span className="text-xs font-semibold uppercase tracking-wide text-success">Recommendations</span>
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
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended Section Order</span>
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
                  <h3 className="text-xl font-bold">LinkedIn Profile Optimization</h3>
                  <p className="text-sm text-muted-foreground">Personalized recommendations to boost your profile visibility</p>
                </div>
              </div>

              {/* Headline Optimization */}
              {linkedIn.headlineOptimization && (
                <ResultCard
                  icon={User}
                  title="Headline Optimization"
                  subtitle="Your headline is prime real estate - make it count"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-destructive">Current</span>
                      </div>
                      <p className="text-sm text-foreground">{linkedIn.headlineOptimization.current || "No headline found"}</p>
                    </div>
                    
                    <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-success">Improved</span>
                        <CopyButton text={linkedIn.headlineOptimization.improved} label="Copy Headline" />
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
                  title="About Section Rewrite"
                  subtitle="A compelling About section that tells your professional story"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="p-4 rounded-xl bg-muted/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your New About Section</span>
                      <CopyButton text={linkedIn.aboutSectionRewrite} label="Copy About" />
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
                  title="Experience Descriptions"
                  subtitle="Optimize your role descriptions for maximum impact"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    {linkedIn.experienceOptimization!.map((exp, index) => (
                      <div key={index} className="p-4 rounded-xl bg-muted/30">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-foreground">{exp.role}</span>
                          <CopyButton text={exp.improved} label="Copy" />
                        </div>
                        {exp.issue && (
                          <div className="flex items-start gap-2 mb-3 p-2 rounded-lg bg-warning/5 border border-warning/20">
                            <AlertTriangle className="w-3 h-3 text-warning mt-0.5 shrink-0" />
                            <p className="text-xs text-warning">{exp.issue}</p>
                          </div>
                        )}
                        <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                          <span className="text-xs font-semibold uppercase tracking-wide text-success">Improved</span>
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
                  title="Skills Optimization"
                  subtitle="Update your skills to match what recruiters search for"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-5">
                    {safeArray(linkedIn.skillsToAdd).length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-3 flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3" />
                          Skills to Add
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
                          Consider Removing
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
                  title="SEO Keywords"
                  subtitle="Keywords recruiters use to find candidates like you"
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
                    Tip: Sprinkle these keywords naturally throughout your headline, about, and experience sections.
                  </p>
                </ResultCard>
              )}

              {/* Profile Visibility Tips */}
              {safeArray(linkedIn.profileVisibilityTips).length > 0 && (
                <ResultCard
                  icon={Eye}
                  title="Profile Visibility Tips"
                  subtitle="Actionable steps to increase your profile views"
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
                  title="Featured Section Ideas"
                  subtitle="Content to showcase at the top of your profile"
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
                  title="Recommendation Strategy"
                  subtitle="How to get quality recommendations that matter"
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
              <span className="text-sm font-medium text-muted-foreground">Resume Analysis</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* Summary & LinkedIn Rewrite */}
          {data.summaryRewrite?.professionalSummary && (
            <div id="summary">
              <ResultCard
                icon={User}
                title="Professional Summary & LinkedIn"
                subtitle="Ready-to-use summary and headline optimized for your profile"
                iconColor="text-primary"
                bgColor="bg-primary/10"
                borderColor="border-primary/20"
              >
                <div className="space-y-6">
                  <div className="p-4 rounded-xl bg-muted/30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Professional Summary
                      </span>
                      <CopyButton text={data.summaryRewrite.professionalSummary} label="Copy Summary" />
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">
                      {data.summaryRewrite.professionalSummary}
                    </p>
                  </div>
                  
                  {data.summaryRewrite.linkedInHeadline && (
                    <div className="p-4 rounded-xl bg-muted/30">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          LinkedIn Headline
                        </span>
                        <CopyButton text={data.summaryRewrite.linkedInHeadline} label="Copy Headline" />
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
                title={`${data.industry || "Industry"} Insights`}
                subtitle="Tailored advice based on what recruiters in your field prioritize"
                iconColor="text-cyan-500"
                bgColor="bg-cyan-500/10"
                borderColor="border-cyan-500/20"
              >
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-muted/30">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      What Recruiters Look For
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">
                      {data.industryInsights.whatRecruitersLookFor}
                    </p>
                  </div>
                  
                  {data.industryInsights.competitiveAdvantage && (
                    <div className="p-4 rounded-xl bg-success/5 border border-success/20">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-2">
                        Your Competitive Edge
                      </h4>
                      <p className="text-sm text-foreground leading-relaxed">
                        {data.industryInsights.competitiveAdvantage}
                      </p>
                    </div>
                  )}
                  
                  {data.industryInsights.commonMistakes && (
                    <div className="p-4 rounded-xl bg-warning/5 border border-warning/20">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-warning mb-2">
                        Common Mistakes to Avoid
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
                title="Skills Gap Analysis"
                subtitle="Key skills missing from your resume that recruiters expect"
                iconColor="text-violet-500"
                bgColor="bg-violet-500/10"
                borderColor="border-violet-500/20"
              >
                <div className="space-y-5">
                  {safeArray(data.skillsGap.missingTechnical).length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                        Technical Skills to Add
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
                        Soft Skills to Highlight
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
              title="Quantification Opportunities"
              subtitle="Turn vague statements into impressive metrics"
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
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-500">Example</span>
                      <p className="text-sm font-medium text-foreground mt-1">{opp.example}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ResultCard>
          )}

          {/* ATS-Optimized Bullets */}
          {optimizedBullets.length > 0 && (
            <div id="bullets">
              <ResultCard
                icon={CheckCircle2}
                title="ATS-Optimized Bullet Points"
                subtitle="These rewrites add metrics and action verbs that ATS systems love"
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
                              BEFORE
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {bullet.original}
                          </p>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-success/20 text-success">
                              AFTER
                            </span>
                            <CopyButton text={bullet.improved} label="Copy" />
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
                title="Stronger Action Verbs"
                subtitle="Replace weak verbs with powerful alternatives that grab attention"
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
                title="Recommended Keywords"
                subtitle="Add these keywords to improve ATS matching and recruiter interest"
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
                  Tip: Naturally incorporate these keywords into your experience bullets and skills section.
                </p>
              </ResultCard>
            </div>
          )}

          {/* Red Flags */}
          {redFlags.length > 0 && (
            <div id="redflags">
              <ResultCard
                icon={AlertTriangle}
                title="Red Flags to Fix"
                subtitle="Address these issues to prevent recruiters from passing on your resume"
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

          {/* Empty State - Show when no meaningful data */}
          {optimizedBullets.length === 0 && actionVerbs.length === 0 && keywords.length === 0 && redFlags.length === 0 && !data.summaryRewrite?.professionalSummary && (
            <div className="text-center py-12 px-6 rounded-2xl bg-card/50 border border-border/50">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Analysis Processing</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                We could not extract detailed recommendations from your resume. This might happen if the resume format is unusual or if there was an issue during processing.
              </p>
            </div>
          )}

          {/* Bottom CTA */}
          <div className="text-center pt-8 space-y-4">
            <p className="text-muted-foreground">
              Apply these changes to your resume {data.hasLinkedIn && "and LinkedIn profile "}and watch your interview rate improve!
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span>This analysis has been saved. Use the share link above to access it anytime.</span>
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
    <div className="rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 overflow-hidden animate-fade-in hover:border-primary/20 transition-all duration-300">
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
