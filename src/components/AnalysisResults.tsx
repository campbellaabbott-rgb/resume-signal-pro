import { 
  CheckCircle2, AlertCircle, Lightbulb, Zap, AlertTriangle, ArrowRight, 
  TrendingUp, Gauge, User, Briefcase, Target, BarChart3, Brain, Copy, Check,
  Linkedin, Eye, Search, Star, MessageSquare, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";

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
  optimizedBullets: {
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
  actionVerbs: {
    weak: string;
    strong: string;
  }[];
  keywords: string[];
  redFlags: string[];
  linkedInAnalysis?: LinkedInAnalysis;
}

interface AnalysisResultsProps {
  data: AnalysisData;
}

// Calculate resume strength score based on analysis
function calculateResumeScore(data: AnalysisData): { score: number; label: string; color: string } {
  let score = 50;
  
  score += Math.min(data.optimizedBullets.length * 3, 15);
  score += Math.min(data.actionVerbs.length * 2, 10);
  score += Math.min(data.keywords.length * 1.5, 15);
  score -= Math.min(data.redFlags.length * 8, 30);
  
  if (data.summaryRewrite?.professionalSummary) score += 5;
  if (data.skillsGap && data.skillsGap.missingTechnical.length < 3) score += 5;
  
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
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

export function AnalysisResults({ data }: AnalysisResultsProps) {
  const stats = [
    { label: "Bullets Improved", value: data.optimizedBullets.length, icon: TrendingUp },
    { label: "Verb Upgrades", value: data.actionVerbs.length, icon: Zap },
    { label: "Keywords Added", value: data.keywords.length, icon: Lightbulb },
    { label: "Issues Found", value: data.redFlags.length, icon: AlertTriangle },
  ];

  const resumeScore = calculateResumeScore(data);
  const linkedIn = data.linkedInAnalysis;

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
          <div className="text-center space-y-8">
            <div className="no-print">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 border border-success/20 text-sm text-success mb-4">
                <CheckCircle2 className="w-4 h-4" />
                Analysis Complete {data.hasLinkedIn && "+ LinkedIn"}
              </div>
              <h2 className="text-3xl md:text-4xl font-bold">Your {data.hasLinkedIn ? "Full Profile" : "Resume"} Breakdown</h2>
              <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
                Here is what we found and how to fix it. Apply these changes to increase your interview chances.
              </p>
              
              {/* Industry & Experience Badge */}
              {data.industry && (
                <div className="flex items-center justify-center gap-3 mt-4">
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
            <div className="max-w-md mx-auto">
              <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-muted-foreground">Resume Strength</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-2xl font-bold", resumeScore.color)}>
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
              <div className="max-w-2xl mx-auto">
                <div className="p-6 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
                      <span className="text-sm font-medium text-muted-foreground">ATS Compatibility Score</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-2xl font-bold", data.atsScore.score >= 70 ? "text-success" : data.atsScore.score >= 50 ? "text-warning" : "text-destructive")}>
                        {data.atsScore.score}
                      </span>
                      <span className="text-muted-foreground">/100</span>
                    </div>
                  </div>
                  <Progress value={data.atsScore.score} className="h-3 bg-muted mb-4" />
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {Object.entries(data.atsScore.breakdown).map(([key, value]) => (
                      <div key={key} className="text-center p-2 rounded-lg bg-muted/30">
                        <div className="text-lg font-bold text-foreground">{value}</div>
                        <div className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                      </div>
                    ))}
                  </div>
                  
                  {data.atsScore.improvements.length > 0 && (
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

          {/* LinkedIn Analysis Section */}
          {linkedIn && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-[#0A66C2]/10">
                  <Linkedin className="w-6 h-6 text-[#0A66C2]" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">LinkedIn Profile Optimization</h3>
                  <p className="text-sm text-muted-foreground">Make your profile stand out to recruiters</p>
                </div>
              </div>

              {/* Headline Optimization */}
              {linkedIn.headlineOptimization && (
                <ResultCard
                  icon={Sparkles}
                  title="Headline Optimization"
                  subtitle="Your headline is the first thing recruiters see"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    {linkedIn.headlineOptimization.current && linkedIn.headlineOptimization.current !== "Not provided" && (
                      <div className="p-3 rounded-xl bg-muted/30">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current</span>
                        <p className="text-sm text-muted-foreground mt-1 line-through">{linkedIn.headlineOptimization.current}</p>
                      </div>
                    )}
                    <div className="p-4 rounded-xl bg-[#0A66C2]/5 border border-[#0A66C2]/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#0A66C2]">Optimized Headline</span>
                        <CopyButton text={linkedIn.headlineOptimization.improved} label="Copy" />
                      </div>
                      <p className="text-sm font-medium text-foreground">{linkedIn.headlineOptimization.improved}</p>
                    </div>
                    {linkedIn.headlineOptimization.whyBetter && (
                      <div className="flex items-start gap-2 px-1">
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
                  icon={User}
                  title="About Section Rewrite"
                  subtitle="Tell your story in a compelling way"
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
              {linkedIn.experienceOptimization && linkedIn.experienceOptimization.length > 0 && (
                <ResultCard
                  icon={Briefcase}
                  title="Experience Descriptions"
                  subtitle="Optimize your role descriptions for maximum impact"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-4">
                    {linkedIn.experienceOptimization.map((exp, index) => (
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
              {((linkedIn.skillsToAdd && linkedIn.skillsToAdd.length > 0) || (linkedIn.skillsToRemove && linkedIn.skillsToRemove.length > 0)) && (
                <ResultCard
                  icon={Star}
                  title="Skills Optimization"
                  subtitle="Update your skills to match what recruiters search for"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-5">
                    {linkedIn.skillsToAdd && linkedIn.skillsToAdd.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-3 flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3" />
                          Skills to Add
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.skillsToAdd.map((skill, index) => (
                            <span key={index} className="px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-sm font-medium text-success">
                              + {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {linkedIn.skillsToRemove && linkedIn.skillsToRemove.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-destructive mb-3 flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" />
                          Consider Removing
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {linkedIn.skillsToRemove.map((skill, index) => (
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
              {linkedIn.seoKeywords && linkedIn.seoKeywords.length > 0 && (
                <ResultCard
                  icon={Search}
                  title="SEO Keywords"
                  subtitle="Keywords recruiters use to find candidates like you"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="flex flex-wrap gap-2">
                    {linkedIn.seoKeywords.map((keyword, index) => (
                      <span key={index} className="px-4 py-2 rounded-full bg-[#0A66C2]/10 border border-[#0A66C2]/20 text-sm font-medium text-[#0A66C2]">
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    💡 Sprinkle these keywords naturally throughout your headline, about, and experience sections.
                  </p>
                </ResultCard>
              )}

              {/* Profile Visibility Tips */}
              {linkedIn.profileVisibilityTips && linkedIn.profileVisibilityTips.length > 0 && (
                <ResultCard
                  icon={Eye}
                  title="Profile Visibility Tips"
                  subtitle="Actionable steps to increase your profile views"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <ul className="space-y-3">
                    {linkedIn.profileVisibilityTips.map((tip, index) => (
                      <li key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
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
              {linkedIn.featuredSectionIdeas && linkedIn.featuredSectionIdeas.length > 0 && (
                <ResultCard
                  icon={Star}
                  title="Featured Section Ideas"
                  subtitle="Content to showcase at the top of your profile"
                  iconColor="text-[#0A66C2]"
                  bgColor="bg-[#0A66C2]/10"
                  borderColor="border-[#0A66C2]/20"
                >
                  <div className="space-y-3">
                    {linkedIn.featuredSectionIdeas.map((idea, index) => (
                      <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30">
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
          )}

          {/* Industry Insights */}
          {data.industryInsights?.whatRecruitersLookFor && (
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
          )}

          {/* Skills Gap Analysis */}
          {data.skillsGap && (data.skillsGap.missingTechnical.length > 0 || data.skillsGap.missingSoft.length > 0) && (
            <ResultCard
              icon={Brain}
              title="Skills Gap Analysis"
              subtitle="Key skills missing from your resume that recruiters expect"
              iconColor="text-violet-500"
              bgColor="bg-violet-500/10"
              borderColor="border-violet-500/20"
            >
              <div className="space-y-5">
                {data.skillsGap.missingTechnical.length > 0 && (
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
                
                {data.skillsGap.missingSoft.length > 0 && (
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
          )}

          {/* Quantification Opportunities */}
          {data.quantificationOpportunities && data.quantificationOpportunities.length > 0 && (
            <ResultCard
              icon={BarChart3}
              title="Quantification Opportunities"
              subtitle="Turn vague statements into impressive metrics"
              iconColor="text-emerald-500"
              bgColor="bg-emerald-500/10"
              borderColor="border-emerald-500/20"
            >
              <div className="space-y-4">
                {data.quantificationOpportunities.map((opp, index) => (
                  <div key={index} className="p-4 rounded-xl bg-muted/30">
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
              Apply these changes to your resume {data.hasLinkedIn && "and LinkedIn profile "}and watch your interview rate improve!
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
