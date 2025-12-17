import { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
  Sparkles, ArrowRight, CheckCircle2, Target, Zap, Lock, Mail, Loader2, 
  FileCheck, FileText, AlertTriangle, Type, User, LayoutList, Phone, 
  Trophy, Hash, Pencil, XCircle, CheckCircle, HelpCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useABTest } from "@/hooks/use-ab-test";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Tooltip explanations for each metric
const metricTooltips = {
  atsScore: {
    title: "ATS Score",
    description: "Measures how well your resume will perform in Applicant Tracking Systems that 98% of Fortune 500 companies use.",
    whyMatters: "A low score means your resume may never reach a human recruiter."
  },
  format: {
    title: "Format Grade",
    description: "Evaluates your resume's structure, layout, and ATS-readability.",
    whyMatters: "Poor formatting causes ATS parsing errors, losing your key information."
  },
  metrics: {
    title: "Quantification Score",
    description: "Measures how many of your achievements include numbers, percentages, or metrics.",
    whyMatters: "Recruiters spend 6 seconds scanning—numbers catch their eye first."
  },
  verbs: {
    title: "Action Verb Grade",
    description: "Rates the strength and variety of action verbs starting your bullet points.",
    whyMatters: "Strong verbs like 'Spearheaded' beat weak ones like 'Helped' or 'Assisted'."
  },
  pages: {
    title: "Resume Length",
    description: "Checks if your resume length matches industry standards for your experience level.",
    whyMatters: "Too long = skipped. Too short = lacking substance."
  },
  words: {
    title: "Word Count",
    description: "Measures if you have enough content to showcase your value.",
    whyMatters: "The sweet spot varies by experience—too few words signals inexperience."
  },
  sections: {
    title: "Section Check",
    description: "Verifies all essential resume sections are present (Summary, Experience, Education, Skills).",
    whyMatters: "Missing sections are immediate red flags for recruiters."
  },
  contact: {
    title: "Contact Info",
    description: "Checks for email, phone, and LinkedIn presence.",
    whyMatters: "Recruiters can't hire you if they can't contact you."
  },
  readability: {
    title: "Readability Score",
    description: "Measures how easy your resume is to scan quickly.",
    whyMatters: "Recruiters average 6-7 seconds per resume—make every word count."
  },
  bulletImpact: {
    title: "Bullet Impact",
    description: "Analyzes if your bullets focus on achievements vs. just listing responsibilities.",
    whyMatters: "Achievement-focused bullets prove value; responsibility lists don't."
  },
  keywordDensity: {
    title: "Keyword Density",
    description: "Measures industry-relevant keyword presence for ATS matching.",
    whyMatters: "Too few keywords = no ATS match. Too many = keyword stuffing penalty."
  },
  improvementPotential: {
    title: "Improvement Potential",
    description: "Estimated score increase possible with optimization.",
    whyMatters: "Shows how much room you have to outcompete other candidates."
  },
  industryBenchmark: {
    title: "Industry Benchmark",
    description: "Compares your score against others in your field.",
    whyMatters: "Know where you stand against your direct competition."
  },
  timeline: {
    title: "Career Timeline",
    description: "Analyzes job tenure, gaps, and career progression patterns.",
    whyMatters: "Recruiters look for stability and growth—gaps need explanation."
  },
  atsCompatibility: {
    title: "ATS System Compatibility",
    description: "Shows how well your resume parses across major Applicant Tracking Systems like Workday, Greenhouse, and Taleo.",
    whyMatters: "Different companies use different ATS—know which ones will read your resume correctly."
  }
};

// Reusable tooltip component for metrics
const MetricTooltip = ({ metricKey }: { metricKey: keyof typeof metricTooltips }) => {
  const tooltip = metricTooltips[metricKey];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground cursor-help transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] p-3">
        <p className="font-semibold text-foreground mb-1">{tooltip.title}</p>
        <p className="text-xs text-muted-foreground mb-2">{tooltip.description}</p>
        <p className="text-xs text-primary font-medium">💡 {tooltip.whyMatters}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface KeywordSuggestion {
  keyword: string;
  reason: string;
}

interface ResumeLength {
  currentPages: number;
  recommendedPages: number;
  verdict: "too_short" | "just_right" | "too_long";
}

interface WordCount {
  current: number;
  idealMin: number;
  idealMax: number;
  verdict: "too_few" | "ideal" | "too_many";
}

interface ExperienceLevel {
  level: "entry" | "mid" | "senior" | "executive";
  yearsEstimate: string;
}

interface SectionCheck {
  hasContact: boolean;
  hasSummary: boolean;
  hasExperience: boolean;
  hasEducation: boolean;
  hasSkills: boolean;
  missingSections: string[];
}

interface ContactInfo {
  hasEmail: boolean;
  hasPhone: boolean;
  hasLinkedIn: boolean;
  missingItems: string[];
}

interface TopStrength {
  title: string;
  description: string;
}

interface QuantificationScore {
  score: number;
  verdict: "weak" | "average" | "strong";
  tip: string;
}

interface ActionVerbGrade {
  grade: string;
  issue: string;
}

interface RedFlag {
  issue: string;
  impact: string;
}

interface ReadabilityScore {
  score: number;
  verdict: "hard_to_read" | "readable" | "easy_to_scan";
  issue: string;
}

interface BulletImpactScore {
  score: number;
  verdict: "responsibility_heavy" | "balanced" | "achievement_focused";
  tip: string;
}

interface KeywordDensity {
  level: "sparse" | "moderate" | "dense";
  explanation: string;
}

interface ImprovementPotential {
  level: "low" | "medium" | "high";
  estimatedScoreIncrease: number;
  topPriority: string;
}

interface WeakPhrase {
  phrase: string;
  suggestion: string;
}

interface TimelineAnalysis {
  avgTenure: string;
  progression: "stagnant" | "steady" | "rapid" | "unclear";
  hasGaps: boolean;
  gapNote?: string;
  totalYears: string;
}

interface IndustryBenchmark {
  industryAvg: number;
  comparison: "below" | "at" | "above";
  percentile: string;
}

interface QuickWin {
  fix: string;
  timeEstimate: string;
  impact: "low" | "medium" | "high";
}

interface SampleRewrite {
  before: string;
  after: string;
  improvement: string;
}

interface AtsSystemRating {
  name: string;
  score: number;
  reason?: string;
  issue?: string;
}

interface AtsSystemCompatibility {
  bestSystems: AtsSystemRating[];
  worstSystems: AtsSystemRating[];
  overallRating: "poor" | "fair" | "good" | "excellent";
  topIssue: string;
}

interface FreeKeywordResultsProps {
  industry: string;
  atsScoreEstimate: number;
  formatGrade: string;
  formatIssue: string;
  resumeLength: ResumeLength;
  wordCount?: WordCount;
  experienceLevel?: ExperienceLevel;
  sectionCheck?: SectionCheck;
  contactInfo?: ContactInfo;
  topStrength?: TopStrength;
  quantificationScore?: QuantificationScore;
  actionVerbGrade?: ActionVerbGrade;
  readabilityScore?: ReadabilityScore;
  bulletImpactScore?: BulletImpactScore;
  keywordDensity?: KeywordDensity;
  improvementPotential?: ImprovementPotential;
  redFlags: RedFlag[];
  keywords: KeywordSuggestion[];
  onGetFullAnalysis: () => void;
  isLoading?: boolean;
  topSkipReasons?: string[];
  powerWords?: string[];
  weakPhrases?: WeakPhrase[];
  timelineAnalysis?: TimelineAnalysis;
  industryBenchmark?: IndustryBenchmark;
  quickWins?: QuickWin[];
  sampleRewrite?: SampleRewrite;
  atsSystemCompatibility?: AtsSystemCompatibility;
}

export function FreeKeywordResults({
  industry,
  atsScoreEstimate,
  formatGrade,
  formatIssue,
  resumeLength: resumeLengthProp,
  wordCount: wordCountProp,
  experienceLevel: experienceLevelProp,
  sectionCheck: sectionCheckProp,
  contactInfo: contactInfoProp,
  topStrength: topStrengthProp,
  quantificationScore: quantificationScoreProp,
  actionVerbGrade: actionVerbGradeProp,
  readabilityScore: readabilityScoreProp,
  bulletImpactScore: bulletImpactScoreProp,
  keywordDensity: keywordDensityProp,
  improvementPotential: improvementPotentialProp,
  redFlags: redFlagsProp,
  keywords,
  onGetFullAnalysis,
  isLoading,
  topSkipReasons: topSkipReasonsProp,
  powerWords: powerWordsProp,
  weakPhrases: weakPhrasesProp,
  timelineAnalysis: timelineAnalysisProp,
  industryBenchmark: industryBenchmarkProp,
  quickWins: quickWinsProp,
  sampleRewrite: sampleRewriteProp,
  atsSystemCompatibility: atsSystemCompatibilityProp
}: FreeKeywordResultsProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { toast } = useToast();
  
  // A/B Test for upgrade CTAs
  const upgradeTest = useABTest('free_scan_upgrade');
  
  // CTA text variants for first upgrade box
  const getFirstCtaText = () => {
    switch (upgradeTest.variant) {
      case 'urgency': return 'Fix Now Before It\'s Too Late';
      case 'value': return 'Get Recruiter-Ready - $25';
      default: return 'Fix These Issues - $25';
    }
  };
  
  // CTA text variants for second upgrade box
  const getSecondCtaText = () => {
    switch (upgradeTest.variant) {
      case 'urgency': return 'Don\'t Miss Out - $25';
      case 'value': return 'Unlock All Fixes - $25';
      default: return 'Get Full Analysis - $25';
    }
  };
  
  // CTA text variants for final button
  const getFinalCtaText = () => {
    switch (upgradeTest.variant) {
      case 'urgency': return 'Get It Now';
      case 'value': return 'Unlock Full Report';
      default: return t('freeScan.cta.button');
    }
  };
  
  // Wrap onGetFullAnalysis with conversion tracking
  const handleUpgradeClick = (source: string) => {
    upgradeTest.trackConversion({ source });
    onGetFullAnalysis();
  };

  // Safe defaults
  const resumeLength = resumeLengthProp || { currentPages: 1, recommendedPages: 1, verdict: "just_right" as const };
  const wordCount = wordCountProp || { current: 500, idealMin: 400, idealMax: 600, verdict: "ideal" as const };
  const experienceLevel = experienceLevelProp || { level: "mid" as const, yearsEstimate: "3-5 years" };
  const sectionCheck = sectionCheckProp || { hasContact: true, hasSummary: false, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] };
  const contactInfo = contactInfoProp || { hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: [] };
  const topStrength = topStrengthProp || { title: "Clear Experience", description: "Your work history is well-documented" };
  const quantificationScore = quantificationScoreProp || { score: 40, verdict: "average" as const, tip: "Add more metrics" };
  const actionVerbGrade = actionVerbGradeProp || { grade: "B", issue: "Good variety" };
  const readabilityScore = readabilityScoreProp || { score: 65, verdict: "readable" as const, issue: "Some long sentences" };
  const bulletImpactScore = bulletImpactScoreProp || { score: 45, verdict: "responsibility_heavy" as const, tip: "Focus on achievements" };
  const keywordDensity = keywordDensityProp || { level: "moderate" as const, explanation: "Good keyword presence" };
  const improvementPotential = improvementPotentialProp || { level: "medium" as const, estimatedScoreIncrease: 15, topPriority: "Add quantified achievements" };
  const redFlags = redFlagsProp || [];
  const topSkipReasons = topSkipReasonsProp || [];
  const powerWords = powerWordsProp || [];
  const weakPhrases = weakPhrasesProp || [];
  const timelineAnalysis = timelineAnalysisProp || { avgTenure: "2 years", progression: "steady" as const, hasGaps: false, totalYears: "5 years" };
  const industryBenchmark = industryBenchmarkProp || { industryAvg: 72, comparison: "at" as const, percentile: "Top 50%" };
  const quickWins = quickWinsProp || [];
  const sampleRewrite = sampleRewriteProp;
  const atsSystemCompatibility = atsSystemCompatibilityProp || {
    bestSystems: [
      { name: "Greenhouse", score: 85, reason: "Clean format" },
      { name: "Lever", score: 82, reason: "Good structure" },
      { name: "Workday", score: 78, reason: "Standard layout" }
    ],
    worstSystems: [
      { name: "Taleo", score: 55, issue: "Complex formatting" },
      { name: "iCIMS", score: 60, issue: "Header parsing" }
    ],
    overallRating: "good" as const,
    topIssue: "Some ATS may struggle with your header format"
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-success/10 border-success/20";
    if (score >= 60) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeColor = (grade: string) => {
    if (grade === "A") return "text-success";
    if (grade === "B") return "text-success/80";
    if (grade === "C") return "text-warning";
    return "text-destructive";
  };

  const getGradeBgColor = (grade: string) => {
    if (grade === "A") return "bg-success/10 border-success/20";
    if (grade === "B") return "bg-success/10 border-success/20";
    if (grade === "C") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeLabel = (grade: string) => {
    if (grade === "A") return t('freeScan.excellent');
    if (grade === "B") return t('freeScan.good');
    if (grade === "C") return t('freeScan.fair');
    return t('freeScan.needsWork');
  };

  const getLengthColor = (verdict: string) => {
    if (verdict === "just_right") return "text-success";
    return "text-warning";
  };

  const getLengthBgColor = (verdict: string) => {
    if (verdict === "just_right") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getLengthLabel = (verdict: string) => {
    if (verdict === "just_right") return t('freeScan.perfect');
    if (verdict === "too_short") return t('freeScan.tooShort');
    return t('freeScan.tooLong');
  };

  const getWordCountColor = (verdict: string) => {
    if (verdict === "ideal") return "text-success";
    return "text-warning";
  };

  const getWordCountBgColor = (verdict: string) => {
    if (verdict === "ideal") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getExperienceLevelLabel = (level: string) => {
    if (level === "entry") return "Entry Level";
    if (level === "mid") return "Mid Level";
    if (level === "senior") return "Senior";
    return "Executive";
  };

  const getQuantificationColor = (verdict: string) => {
    if (verdict === "strong") return "text-success";
    if (verdict === "average") return "text-warning";
    return "text-destructive";
  };

  const getQuantificationBgColor = (verdict: string) => {
    if (verdict === "strong") return "bg-success/10 border-success/20";
    if (verdict === "average") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getSectionScore = () => {
    const total = 5;
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    return `${present}/${total}`;
  };

  const getSectionColor = () => {
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    if (present === 5) return "text-success";
    if (present >= 3) return "text-warning";
    return "text-destructive";
  };

  const getSectionBgColor = () => {
    const present = [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length;
    if (present === 5) return "bg-success/10 border-success/20";
    if (present >= 3) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getContactScore = () => {
    const total = 3;
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    return `${present}/${total}`;
  };

  const getContactColor = () => {
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    if (present === 3) return "text-success";
    if (present >= 2) return "text-warning";
    return "text-destructive";
  };

  const getContactBgColor = () => {
    const present = [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length;
    if (present === 3) return "bg-success/10 border-success/20";
    if (present >= 2) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    // Check honeypot - if filled, silently ignore (it's a bot)
    const honeypotValue = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('[name="website"]')?.value;
    if (honeypotValue) {
      setIsSubscribed(true); // Fake success
      return;
    }

    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('save-lead', {
        body: { 
          email, 
          industry, 
          atsScore: atsScoreEstimate,
          honeypot: honeypotValue || ''
        }
      });

      if (error) {
        // Parse error response
        const errorBody = error?.context?.body;
        if (errorBody) {
          try {
            const parsed = typeof errorBody === 'string' ? JSON.parse(errorBody) : errorBody;
            toast({
              title: "Couldn't save email",
              description: parsed.error || "Please try again.",
              variant: "destructive",
            });
            return;
          } catch {
            // Fall through to generic error
          }
        }
        throw error;
      }

      if (data?.error) {
        toast({
          title: "Couldn't save email",
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      setIsSubscribed(true);
      toast({
        title: "You're on the list!",
        description: "We'll send you resume tips to help you land more interviews.",
      });
    } catch (error: any) {
      console.error("Email capture error:", error);
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getReadabilityColor = (verdict: string) => {
    if (verdict === "easy_to_scan") return "text-success";
    if (verdict === "readable") return "text-warning";
    return "text-destructive";
  };

  const getReadabilityBgColor = (verdict: string) => {
    if (verdict === "easy_to_scan") return "bg-success/10 border-success/20";
    if (verdict === "readable") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getBulletImpactColor = (verdict: string) => {
    if (verdict === "achievement_focused") return "text-success";
    if (verdict === "balanced") return "text-warning";
    return "text-destructive";
  };

  const getBulletImpactBgColor = (verdict: string) => {
    if (verdict === "achievement_focused") return "bg-success/10 border-success/20";
    if (verdict === "balanced") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getKeywordDensityColor = (level: string) => {
    if (level === "dense") return "text-success";
    if (level === "moderate") return "text-warning";
    return "text-destructive";
  };

  const getKeywordDensityBgColor = (level: string) => {
    if (level === "dense") return "bg-success/10 border-success/20";
    if (level === "moderate") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getImprovementPotentialColor = (level: string) => {
    if (level === "low") return "text-success";
    if (level === "medium") return "text-warning";
    return "text-primary";
  };

  const getImprovementPotentialBgColor = (level: string) => {
    if (level === "low") return "bg-success/10 border-success/20";
    if (level === "medium") return "bg-warning/10 border-warning/20";
    return "bg-primary/10 border-primary/20";
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="w-full max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-sm font-medium mb-3">
          <Sparkles className="w-4 h-4" />
          {t('freeScan.complete')}
        </div>
        <h3 className="text-xl font-bold mb-1">{t('freeScan.preview')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('freeScan.detected')}: <span className="text-foreground font-medium">{industry}</span> • <span className="text-foreground font-medium">{getExperienceLevelLabel(experienceLevel.level)}</span> ({experienceLevel.yearsEstimate})
        </p>
      </div>

      {/* Percentile Urgency Banner */}
      {atsScoreEstimate < 80 && (
        <div className="rounded-2xl bg-gradient-to-r from-destructive/20 via-destructive/10 to-warning/10 border-2 border-destructive/40 p-4 mb-4 animate-pulse-slow">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-destructive/20 animate-bounce-slow">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="font-bold text-destructive text-lg">
                  You rank in the bottom {atsScoreEstimate < 60 ? "30%" : atsScoreEstimate < 70 ? "40%" : "50%"} of applicants
                </p>
                <p className="text-sm text-muted-foreground">
                  {atsScoreEstimate < 60 
                    ? "Most ATS systems will auto-reject your resume" 
                    : "Your resume may get filtered before a human sees it"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Average score needed to pass ATS</p>
              <p className="text-2xl font-bold text-success">75+</p>
            </div>
          </div>
        </div>
      )}

      {/* Score Cards Grid - Row 1: Primary Scores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* ATS Score */}
        <div className={cn("rounded-2xl border p-3", getScoreBgColor(atsScoreEstimate))}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.atsScore')}</p>
            <MetricTooltip metricKey="atsScore" />
          </div>
          <p className={cn("text-2xl font-bold", getScoreColor(atsScoreEstimate))}>
            {atsScoreEstimate}<span className="text-sm text-muted-foreground">/100</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {atsScoreEstimate >= 80 ? "✓ Great! You'll pass most ATS" : 
             atsScoreEstimate >= 60 ? "⚠ May get filtered out" : "✗ High rejection risk"}
          </p>
        </div>

        {/* Format Grade */}
        <div className={cn("rounded-2xl border p-3", getGradeBgColor(formatGrade))}>
          <div className="flex items-center gap-2 mb-1">
            <FileCheck className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.format')}</p>
            <MetricTooltip metricKey="format" />
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getGradeColor(formatGrade))}>{formatGrade}</p>
            <span className={cn("text-xs font-medium", getGradeColor(formatGrade))}>{getGradeLabel(formatGrade)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatGrade === "A" ? "✓ ATS can read this well" : 
             formatGrade === "B" ? "✓ Minor formatting tweaks needed" : 
             formatGrade === "C" ? "⚠ May cause parsing errors" : "✗ ATS may scramble your info"}
          </p>
        </div>

        {/* Quantification Score */}
        <div className={cn("rounded-2xl border p-3", getQuantificationBgColor(quantificationScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.metrics')}</p>
            <MetricTooltip metricKey="metrics" />
          </div>
          <p className={cn("text-2xl font-bold", getQuantificationColor(quantificationScore.verdict))}>
            {quantificationScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {quantificationScore.verdict === "strong" ? "✓ Good use of numbers" : 
             quantificationScore.verdict === "average" ? "⚠ Add more metrics ($, %, #)" : "✗ Numbers make you stand out"}
          </p>
        </div>

        {/* Action Verb Grade */}
        <div className={cn("rounded-2xl border p-3", getGradeBgColor(actionVerbGrade.grade))}>
          <div className="flex items-center gap-2 mb-1">
            <Pencil className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.verbs')}</p>
            <MetricTooltip metricKey="verbs" />
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getGradeColor(actionVerbGrade.grade))}>{actionVerbGrade.grade}</p>
            <span className={cn("text-xs font-medium", getGradeColor(actionVerbGrade.grade))}>{getGradeLabel(actionVerbGrade.grade)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {actionVerbGrade.grade === "A" ? "✓ Strong, powerful verbs" : 
             actionVerbGrade.grade === "B" ? "✓ Good variety of verbs" : 
             actionVerbGrade.grade === "C" ? "⚠ Use stronger words" : "✗ Weak verbs hurt impact"}
          </p>
        </div>
      </div>

      {/* Score Cards Grid - Row 2: Structure & Content */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* Resume Length */}
        <div className={cn("rounded-2xl border p-3", getLengthBgColor(resumeLength.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.pages')}</p>
            <MetricTooltip metricKey="pages" />
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getLengthColor(resumeLength.verdict))}>{resumeLength.currentPages}</p>
            <span className="text-sm text-muted-foreground">/ {resumeLength.recommendedPages}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {resumeLength.verdict === "just_right" ? "✓ Perfect length for your level" : 
             resumeLength.verdict === "too_short" ? "⚠ Add more accomplishments" : "⚠ Recruiters may skip long resumes"}
          </p>
        </div>

        {/* Word Count */}
        <div className={cn("rounded-2xl border p-3", getWordCountBgColor(wordCount.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.words')}</p>
            <MetricTooltip metricKey="words" />
          </div>
          <p className={cn("text-2xl font-bold", getWordCountColor(wordCount.verdict))}>{wordCount.current}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {wordCount.verdict === "ideal" ? `✓ Sweet spot: ${wordCount.idealMin}-${wordCount.idealMax}` : 
             wordCount.verdict === "too_few" ? "⚠ Looks thin — add content" : "⚠ Too dense — trim fat"}
          </p>
        </div>

        {/* Section Check */}
        <div className={cn("rounded-2xl border p-3", getSectionBgColor())}>
          <div className="flex items-center gap-2 mb-1">
            <LayoutList className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.sections')}</p>
            <MetricTooltip metricKey="sections" />
          </div>
          <p className={cn("text-2xl font-bold", getSectionColor())}>{getSectionScore()}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {sectionCheck.missingSections.length === 0 ? "✓ All key sections present" : 
             `⚠ Add: ${sectionCheck.missingSections[0]}`}
          </p>
        </div>

        {/* Contact Info */}
        <div className={cn("rounded-2xl border p-3", getContactBgColor())}>
          <div className="flex items-center gap-2 mb-1">
            <Phone className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.contact')}</p>
            <MetricTooltip metricKey="contact" />
          </div>
          <p className={cn("text-2xl font-bold", getContactColor())}>{getContactScore()}</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {contactInfo.missingItems.length === 0 ? "✓ Easy for recruiters to reach you" : 
             `⚠ Add ${contactInfo.missingItems[0]}`}
          </p>
        </div>
      </div>

      {/* Score Cards Grid - Row 3: New Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {/* Readability Score */}
        <div className={cn("rounded-2xl border p-3", getReadabilityBgColor(readabilityScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.readability')}</p>
            <MetricTooltip metricKey="readability" />
          </div>
          <p className={cn("text-2xl font-bold", getReadabilityColor(readabilityScore.verdict))}>
            {readabilityScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {readabilityScore.verdict === "easy_to_scan" ? "✓ Quick 6-second scan friendly" : 
             readabilityScore.verdict === "readable" ? "⚠ Some sections hard to scan" : "✗ Recruiters will skip this"}
          </p>
        </div>

        {/* Bullet Impact Score */}
        <div className={cn("rounded-2xl border p-3", getBulletImpactBgColor(bulletImpactScore.verdict))}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.bulletImpact')}</p>
            <MetricTooltip metricKey="bulletImpact" />
          </div>
          <p className={cn("text-2xl font-bold", getBulletImpactColor(bulletImpactScore.verdict))}>
            {bulletImpactScore.score}<span className="text-sm text-muted-foreground">%</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {bulletImpactScore.verdict === "achievement_focused" ? "✓ Shows results, not tasks" : 
             bulletImpactScore.verdict === "balanced" ? "⚠ Add more achievements" : "✗ Lists duties, not wins"}
          </p>
        </div>

        {/* Keyword Density */}
        <div className={cn("rounded-2xl border p-3", getKeywordDensityBgColor(keywordDensity.level))}>
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.keywordDensity')}</p>
            <MetricTooltip metricKey="keywordDensity" />
          </div>
          <p className={cn("text-xl font-bold capitalize", getKeywordDensityColor(keywordDensity.level))}>
            {keywordDensity.level}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {keywordDensity.level === "dense" ? "✓ ATS will find your skills" : 
             keywordDensity.level === "moderate" ? "⚠ Add more industry terms" : "✗ Missing key search terms"}
          </p>
        </div>

        {/* Improvement Potential */}
        <div className={cn("rounded-2xl border p-3", getImprovementPotentialBgColor(improvementPotential.level))}>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground flex-1">{t('freeScan.improvementPotential')}</p>
            <MetricTooltip metricKey="improvementPotential" />
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-xl font-bold", getImprovementPotentialColor(improvementPotential.level))}>
              +{improvementPotential.estimatedScoreIncrease}
            </p>
            <span className="text-xs text-muted-foreground">pts</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {improvementPotential.level === "high" ? "🚀 Big gains possible!" : 
             improvementPotential.level === "medium" ? "📈 Room to improve" : "✓ Already optimized"}
          </p>
        </div>
      </div>

      {/* Row 4: Special Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {/* Top Strength */}
        <div className="rounded-2xl border p-4 bg-success/5 border-success/20">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-success" />
            <p className="text-xs font-medium text-success">{t('freeScan.topStrength')}</p>
          </div>
          <p className="font-semibold text-foreground">{topStrength.title}</p>
          <p className="text-sm text-muted-foreground">{topStrength.description}</p>
        </div>

        {/* Red Flags Preview */}
        <div className="rounded-2xl border p-4 bg-destructive/5 border-destructive/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <p className="text-xs font-medium text-destructive">{t('freeScan.redFlags')}</p>
          </div>
          <p className="text-2xl font-bold text-destructive mb-1">{redFlags.length}+</p>
          {redFlags.length > 0 && (
            <p className="text-sm text-muted-foreground">{redFlags[0].issue}</p>
          )}
        </div>
      </div>

      {/* Top 5 Reasons Your Resume Is Being Skipped */}
      {topSkipReasons && topSkipReasons.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-6 h-6 rounded bg-success/20 text-success">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-lg">Top 5 Reasons Your Resume Is Being Skipped</h4>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Not just "red flags" — the <em>most important ones first</em>.
          </p>
          
          {/* Code-style block */}
          <div className="rounded-xl bg-[hsl(222,47%,11%)] border border-border/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-[hsl(222,47%,8%)] border-b border-border/30">
              <span className="text-xs text-muted-foreground font-mono">priority</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(topSkipReasons.map((r, i) => `${i + 1}. ${r}`).join('\n'));
                  toast({
                    title: "Copied to clipboard",
                    description: "Share this with a friend or mentor for feedback"
                  });
                }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy
              </button>
            </div>
            <div className="p-4 font-mono text-sm space-y-3">
              {topSkipReasons.slice(0, 5).map((reason, index) => (
                <div key={index} className="flex gap-3">
                  <span className="text-muted-foreground shrink-0">{index + 1}.</span>
                  <span className="text-foreground/90">{reason}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-4 p-3 rounded-xl bg-muted/30 border border-border/50">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Why:</span>{" "}
              People want clarity first — reasons matter more than solutions.
            </p>
          </div>
        </div>
      )}

      {/* Industry Benchmark & Timeline Analysis */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Industry Benchmark */}
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-primary" />
            <h4 className="font-semibold flex-1">How You Compare</h4>
            <MetricTooltip metricKey="industryBenchmark" />
          </div>
          <p className="text-xs text-muted-foreground mb-4">See how your resume stacks up against other {industry} professionals</p>
          
          {/* Score Comparison */}
          <div className="flex items-center gap-3 mb-4">
            {/* Your Score */}
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-xs font-medium text-foreground">You</span>
                <span className={cn("text-lg font-bold", getScoreColor(atsScoreEstimate))}>{atsScoreEstimate}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div 
                  className={cn("h-full rounded-full transition-all", 
                    atsScoreEstimate >= 75 ? "bg-success" : atsScoreEstimate >= 60 ? "bg-warning" : "bg-destructive"
                  )}
                  style={{ width: `${atsScoreEstimate}%` }}
                />
              </div>
            </div>
            
            {/* VS Divider */}
            <div className="flex-shrink-0 w-8 text-center">
              <span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">vs</span>
            </div>
            
            {/* Industry Avg */}
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1.5 justify-end">
                <span className="text-xs font-medium text-foreground">Others</span>
                <span className="text-lg font-bold text-muted-foreground">{industryBenchmark.industryAvg}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/40 rounded-full" style={{ width: `${industryBenchmark.industryAvg}%` }} />
              </div>
            </div>
          </div>
          
          {/* Percentile Badge with explanation */}
          <div className={cn(
            "text-center py-3 px-4 rounded-lg mb-3",
            industryBenchmark.comparison === "above" ? "bg-success/15" :
            industryBenchmark.comparison === "at" ? "bg-warning/15" : "bg-destructive/15"
          )}>
            <p className={cn("text-lg font-bold",
              industryBenchmark.comparison === "above" ? "text-success" :
              industryBenchmark.comparison === "at" ? "text-warning" : "text-destructive"
            )}>
              {industryBenchmark.percentile}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {industryBenchmark.comparison === "above" 
                ? `Better than most ${industry} candidates` 
                : industryBenchmark.comparison === "at" 
                  ? "Average — won't stand out" 
                  : "Below average — needs work"}
            </p>
          </div>
          
          {/* What This Means */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-1">
              {industryBenchmark.comparison === "above" 
                ? "✓ You're ahead of the competition" 
                : industryBenchmark.comparison === "at" 
                  ? "⚠ You're blending in with the crowd"
                  : "✗ Stronger candidates will beat you"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {industryBenchmark.comparison === "above" 
                ? "Your resume is more likely to get past ATS filters and catch a recruiter's eye. Keep it updated!"
                : industryBenchmark.comparison === "at" 
                  ? "You'll pass some ATS screens, but won't stand out. A few tweaks could move you into the top tier."
                  : "Many ATS systems will filter you out before a human sees your resume. The full analysis shows exactly what to fix."}
            </p>
          </div>
        </div>

        {/* Timeline Analysis */}
        <div className="rounded-2xl bg-card border border-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-primary" />
            <h4 className="font-semibold flex-1">Career Timeline</h4>
            <MetricTooltip metricKey="timeline" />
          </div>
          
          <div className="space-y-3">
            {/* Total Experience */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">Total Experience</span>
                <span className="text-sm font-bold text-primary">{timelineAnalysis.totalYears}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                How long you've been working in your field
              </p>
            </div>
            
            {/* Avg Job Tenure */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">Avg Time at Each Job</span>
                <span className={cn("text-sm font-bold",
                  parseFloat(timelineAnalysis.avgTenure) >= 2 ? "text-success" : 
                  parseFloat(timelineAnalysis.avgTenure) >= 1 ? "text-warning" : "text-destructive"
                )}>{timelineAnalysis.avgTenure}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {parseFloat(timelineAnalysis.avgTenure) >= 2 
                  ? "✓ Good stability — recruiters like 2+ years per role"
                  : parseFloat(timelineAnalysis.avgTenure) >= 1
                    ? "⚠ Short tenure may raise questions"
                    : "⚠ Very short — may be seen as job hopping"}
              </p>
            </div>
            
            {/* Career Progression */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">Career Growth</span>
                <span className={cn("text-sm font-bold capitalize",
                  timelineAnalysis.progression === "rapid" ? "text-success" :
                  timelineAnalysis.progression === "steady" ? "text-success" :
                  timelineAnalysis.progression === "stagnant" ? "text-warning" : "text-muted-foreground"
                )}>
                  {timelineAnalysis.progression === "rapid" ? "🚀 Rapid" :
                   timelineAnalysis.progression === "steady" ? "📈 Steady" :
                   timelineAnalysis.progression === "stagnant" ? "📊 Flat" : "❓ Unclear"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {timelineAnalysis.progression === "rapid" 
                  ? "Great! Shows strong advancement and increasing responsibility"
                  : timelineAnalysis.progression === "steady"
                    ? "Shows consistent growth — employers like this pattern"
                    : timelineAnalysis.progression === "stagnant"
                      ? "Consider highlighting promotions or new responsibilities"
                      : "Add clearer job titles to show your career path"}
              </p>
            </div>
            
            {/* Employment Gaps Warning */}
            {timelineAnalysis.hasGaps && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  <span className="text-sm font-medium text-warning">Employment Gap Detected</span>
                </div>
                <p className="text-xs text-warning/80">
                  {timelineAnalysis.gapNote || "Gaps are common — just be ready to explain them in interviews"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ATS System Compatibility */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <FileCheck className="w-4 h-4 text-primary" />
          <h4 className="font-semibold flex-1">ATS System Compatibility</h4>
          <MetricTooltip metricKey="atsCompatibility" />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          See how your resume performs across the most popular Applicant Tracking Systems
        </p>

        {/* Overall Rating Badge */}
        <div className={cn(
          "text-center py-3 px-4 rounded-lg mb-4",
          atsSystemCompatibility.overallRating === "excellent" ? "bg-success/15" :
          atsSystemCompatibility.overallRating === "good" ? "bg-success/10" :
          atsSystemCompatibility.overallRating === "fair" ? "bg-warning/15" : "bg-destructive/15"
        )}>
          <p className={cn("text-lg font-bold capitalize",
            atsSystemCompatibility.overallRating === "excellent" ? "text-success" :
            atsSystemCompatibility.overallRating === "good" ? "text-success" :
            atsSystemCompatibility.overallRating === "fair" ? "text-warning" : "text-destructive"
          )}>
            {atsSystemCompatibility.overallRating === "excellent" ? "✓ Excellent Compatibility" :
             atsSystemCompatibility.overallRating === "good" ? "✓ Good Compatibility" :
             atsSystemCompatibility.overallRating === "fair" ? "⚠ Fair Compatibility" : "✗ Poor Compatibility"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {atsSystemCompatibility.overallRating === "excellent" 
              ? "Your resume should parse correctly on most ATS platforms" 
              : atsSystemCompatibility.overallRating === "good"
                ? "Most ATS will read your resume correctly"
                : atsSystemCompatibility.overallRating === "fair"
                  ? "Some ATS may have trouble parsing your resume"
                  : "Many ATS will struggle to read your resume properly"}
          </p>
        </div>

        {/* Best & Worst Systems Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Best Systems */}
          <div className="p-4 rounded-xl bg-success/5 border border-success/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">Works Best With</span>
            </div>
            <div className="space-y-2">
              {atsSystemCompatibility.bestSystems.map((system, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-background/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{system.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{system.reason}</span>
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded",
                      system.score >= 80 ? "bg-success/20 text-success" : 
                      system.score >= 60 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive"
                    )}>
                      {system.score}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Worst Systems */}
          <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-sm font-semibold text-destructive">May Have Issues</span>
            </div>
            <div className="space-y-2">
              {atsSystemCompatibility.worstSystems.map((system, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded-lg bg-background/50">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{system.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{system.issue}</span>
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded",
                      system.score >= 70 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive"
                    )}>
                      {system.score}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Issue to Fix */}
        {atsSystemCompatibility.topIssue && (
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-1">
              💡 Top ATS Issue to Fix
            </p>
            <p className="text-sm text-muted-foreground">
              {atsSystemCompatibility.topIssue}
            </p>
          </div>
        )}
      </div>

      {/* Power Words & Weak Phrases */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Power Words */}
        {powerWords.length > 0 && (
          <div className="rounded-2xl bg-success/5 border border-success/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-success" />
              <h4 className="font-semibold text-success">Strong Words You're Using</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {powerWords.map((word, index) => (
                <span key={index} className="px-3 py-1 bg-success/10 text-success text-sm font-medium rounded-full border border-success/20">
                  {word}
                </span>
              ))}
            </div>
            <p className="text-xs text-success/70 mt-3">Keep using these! Recruiters love them.</p>
          </div>
        )}

        {/* Weak Phrases */}
        {weakPhrases.length > 0 && (
          <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <XCircle className="w-4 h-4 text-destructive" />
              <h4 className="font-semibold text-destructive">Weak Phrases to Eliminate</h4>
            </div>
            <div className="space-y-2">
              {weakPhrases.map((item, index) => (
                <div key={index} className="p-2 rounded-lg bg-background/50">
                  <span className="text-sm font-medium text-destructive line-through">"{item.phrase}"</span>
                  <p className="text-xs text-muted-foreground mt-1">{item.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Wins */}
      {quickWins.length > 0 && (
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-primary" />
            <h4 className="font-semibold">Quick Wins (5 min or less)</h4>
          </div>
          <div className="space-y-3">
            {quickWins.map((win, index) => (
              <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-background/50 border border-border/50">
                <div className={cn(
                  "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  win.impact === "high" ? "bg-success/20 text-success" :
                  win.impact === "medium" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
                )}>
                  {index + 1}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{win.fix}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">⏱️ {win.timeEstimate}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      win.impact === "high" ? "bg-success/10 text-success" :
                      win.impact === "medium" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                    )}>
                      {win.impact} impact
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Rewrite */}
      {sampleRewrite && (
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-success/10 border border-primary/30 p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary" />
            <h4 className="font-semibold">Sample Rewrite Preview</h4>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary ml-auto">Free teaser</span>
          </div>
          
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium mb-1">❌ BEFORE (from your resume)</p>
              <p className="text-sm text-foreground italic">"{sampleRewrite.before}"</p>
            </div>
            
            <div className="flex justify-center">
              <ArrowRight className="w-4 h-4 text-primary" />
            </div>
            
            <div className="p-3 rounded-xl bg-success/10 border border-success/20">
              <p className="text-xs text-success font-medium mb-1">✅ AFTER (optimized)</p>
              <p className="text-sm text-foreground font-medium">"{sampleRewrite.after}"</p>
            </div>
            
            <div className="text-center p-2 rounded-lg bg-background/50 border border-border/50">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Why it's better:</span> {sampleRewrite.improvement}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-4 p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Lock className="w-3 h-3 text-primary" />
            <span className="text-xs text-primary">Get all your bullet points rewritten in the full $25 analysis</span>
          </div>
        </div>
      )}

      {/* Detailed Section Check */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <LayoutList className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">Section Checklist</h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Contact", has: sectionCheck.hasContact },
            { label: "Summary", has: sectionCheck.hasSummary },
            { label: "Experience", has: sectionCheck.hasExperience },
            { label: "Education", has: sectionCheck.hasEducation },
            { label: "Skills", has: sectionCheck.hasSkills },
          ].map((item) => (
            <div key={item.label} className={cn(
              "flex items-center gap-2 p-2 rounded-xl border",
              item.has ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"
            )}>
              {item.has ? (
                <CheckCircle className="w-4 h-4 text-success shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              )}
              <span className={cn("text-sm font-medium", item.has ? "text-success" : "text-destructive")}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade CTA Box 1 */}
      <div className="rounded-2xl bg-destructive/10 border-2 border-destructive/50 p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-destructive/20">
            <Lock className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-destructive mb-1">Your Resume Has {redFlags.length}+ Issues Recruiters Will Notice</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Get the full analysis with specific fixes, rewritten bullet points, and ATS-optimized suggestions.
            </p>
            <Button 
              onClick={() => handleUpgradeClick('cta_box_1')}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {getFirstCtaText()}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      {/* Red Flags Details */}
      {redFlags.length > 0 && (
        <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold">Recruiter Red Flags</h4>
          </div>
          <div className="space-y-2">
            {redFlags.map((flag, index) => (
              <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-background/50 border border-destructive/10">
                <span className="text-destructive font-bold text-sm">{index + 1}.</span>
                <div>
                  <span className="font-medium text-foreground">{flag.issue}</span>
                  <p className="text-sm text-muted-foreground">{flag.impact}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-3 text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span className="text-xs">More red flags + how to fix them in full analysis</span>
          </div>
        </div>
      )}

      {/* Keyword Suggestions */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeScan.missingKeywords')}</h4>
        </div>
        <div className="space-y-3">
          {keywords.map((item, index) => (
            <div key={index} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
              <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{item.keyword}</span>
                <p className="text-sm text-muted-foreground">{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upgrade CTA Box 2 */}
      <div className="rounded-2xl bg-destructive/10 border-2 border-destructive/50 p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-destructive/20">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-destructive mb-1">Don't Lose This Job to a Stronger Resume</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Your free scan found problems. The full report shows you exactly how to fix them with recruiter-approved rewrites.
            </p>
            <Button 
              onClick={() => handleUpgradeClick('cta_box_2')}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {getSecondCtaText()}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      {/* Email Capture */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeScan.emailCapture.title')}</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Join 10,000+ job seekers getting weekly tips to beat the ATS and land interviews.
        </p>
        
        {isSubscribed ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="text-sm text-success font-medium">{t('freeScan.emailCapture.subscribed')}</span>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit} className="flex gap-2">
            {/* Honeypot field - hidden from users, bots will fill it */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              className="absolute -left-[9999px] opacity-0 h-0 w-0"
              aria-hidden="true"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('freeScan.emailCapture.placeholder')}
              className="flex-1 h-10 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 text-sm transition-all"
              disabled={isSubmitting}
            />
            <Button 
              type="submit" 
              variant="outline"
              disabled={isSubmitting || !email.trim()}
              className="h-10 px-4 border-primary/30 hover:bg-primary/10"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t('freeScan.emailCapture.button')}
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground mt-2">No spam. Unsubscribe anytime.</p>
      </div>

      {/* What's Locked */}
      <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h4 className="font-medium text-muted-foreground">Unlock with Full Analysis</h4>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            "Full ATS score breakdown",
            "Bullet point rewrites",
            "Detailed red flag fixes",
            "LinkedIn optimization",
            "Action verb replacements",
            "Quantification suggestions",
            "Skills gap analysis",
            "Industry-specific insights",
            "Summary/headline rewrites",
            "Prioritized action plan"
          ].map((feature, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Button 
          size="lg" 
          onClick={() => handleUpgradeClick('final_cta')}
          disabled={isLoading}
          className="gap-2 px-8 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
        >
          {getFinalCtaText()} — {t('freeScan.cta.price')}
          <ArrowRight className="w-4 h-4" />
        </Button>
        <p className="text-xs text-muted-foreground mt-2">One interview pays for itself</p>
      </div>
    </div>
    </TooltipProvider>
  );
}
