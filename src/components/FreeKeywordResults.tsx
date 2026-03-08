import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { useTranslation } from "react-i18next";
import { 
  Sparkles, ArrowRight, CheckCircle2, Target, Zap, Lock, Mail, Loader2, 
  FileCheck, FileText, AlertTriangle, Type, User, LayoutList, Phone, 
  Trophy, Hash, Pencil, XCircle, CheckCircle, HelpCircle, Briefcase, Download, Apple, X,
  TrendingUp, RefreshCw, Share2, Star, DollarSign, MessageSquare, Lightbulb, Copy, Rocket,
  BarChart3, Shield, Search, Settings2
} from "lucide-react";
import { LockedPremiumInsight } from "./LockedPremiumInsight";
import { WalletPaymentBadge } from "./WalletPaymentBadge";
import { PersonalizedInsights } from "./PersonalizedInsights";
import { TieredPricingSection } from "./TieredPricingSection";
import { ResumeBeforeAfter } from "./ResumeBeforeAfter";
import { JobKeywordMatcher } from "./JobKeywordMatcher";
import { PeerBenchmark } from "./PeerBenchmark";
import { ReturningUserInsights } from "./ReturningUserInsights";
import { IndustryKeywordSuggestions } from "./IndustryKeywordSuggestions";
import { RoleKeywordSuggestions } from "./RoleKeywordSuggestions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useScanHistory, generateChecklist } from "@/hooks/use-scan-history";
import { InteractiveChecklist } from "./InteractiveChecklist";
import { AISummary } from "./AISummary";
import { ShareableScoreCard } from "./ShareableScoreCard";
import { ScoreHero } from "./scorecard/ScoreHero";
import { MetricCardsGrid } from "./scorecard/MetricCardsGrid";
import { RedFlagsSection, KeywordsSection } from "./scorecard/RedFlagsKeywords";
import { SectionNav } from "./scorecard/SectionNav";
import { CollapsibleSection } from "./scorecard/CollapsibleSection";
import { 
  EnhancedAnalysisDisplay, 
  ResumeTypeResult, 
  DualScore, 
  CalibratedLanguage, 
  UsageRecommendation,
  CredibilityIssue,
  ContentLocation,
  IndustryDetection
} from "./EnhancedAnalysisDisplay";

import { useCurrency } from "@/hooks/use-currency";
import { useIsMobile } from "@/hooks/use-mobile";
import { PRODUCTS } from "@/config/products";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Tooltip explanations for each metric
const metricTooltips = {
  atsScore: {
    title: "AI-ATS Score",
    description: "Our AI simulates how modern AI-powered Applicant Tracking Systems scan your resume—the same technology 98% of Fortune 500 companies use.",
    whyMatters: "A low score means your resume may never reach a human recruiter."
  },
  format: {
    title: "Format Grade",
    description: "Evaluates your resume's structure, layout, and AI-ATS readability.",
    whyMatters: "Poor formatting causes AI-ATS parsing errors, losing your key information."
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
    description: "Measures industry-relevant keyword presence for AI-ATS matching.",
    whyMatters: "Too few keywords = no AI-ATS match. Too many = keyword stuffing penalty."
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
    title: "AI-ATS System Compatibility",
    description: "Shows how well your resume parses across major AI-powered Applicant Tracking Systems like Workday, Greenhouse, and Taleo.",
    whyMatters: "Different companies use different AI-ATS systems—know which ones will read your resume correctly."
  }
};

// A/B Test copy variants for product CTAs - now accepts formatLocalPrice function
const getProductCtaCopy = (
  variant: 'control' | 'benefit_focused' | 'scarcity',
  formatLocalPrice: (usd: number) => string,
  isLocal: boolean
) => {
  const coverLetterPrice = isLocal 
    ? `$${PRODUCTS.coverLetter.priceUsd} ≈ ${formatLocalPrice(PRODUCTS.coverLetter.priceUsd)}`
    : `$${PRODUCTS.coverLetter.priceUsd}`;
  const premiumPrice = isLocal 
    ? `$${PRODUCTS.premiumPackage.priceUsd} ≈ ${formatLocalPrice(PRODUCTS.premiumPackage.priceUsd)}`
    : `$${PRODUCTS.premiumPackage.priceUsd}`;
    
  return {
    coverLetter: {
      control: { button: `Generate Cover Letter — ${coverLetterPrice}`, description: 'AI-generated cover letter tailored to your resume and target job. Ready to send in minutes.' },
      benefit_focused: { button: 'Get Your Interview-Winning Letter', description: 'Stand out from 100+ applicants with a personalized cover letter that gets recruiters excited.' },
      scarcity: { button: `Create Cover Letter Now — ${coverLetterPrice}`, description: 'Most applicants skip cover letters. Get ahead of the competition with a custom letter in 2 minutes.' },
    }[variant],
    keywordFix: {
      control: { button: 'Get Full Keyword Report', headline: 'Want 50+ Industry Keywords?' },
      benefit_focused: { button: 'Unlock Hidden Keywords', headline: 'Get Past the ATS Filter' },
      scarcity: { button: 'Get Keywords Before Others Do', headline: 'Beat 87% of Applicants' },
    }[variant],
    premiumPackage: {
      control: { button: `Buy Premium Package — ${premiumPrice}`, headline: 'Premium Resume Package', subtext: 'Everything you need to land interviews' },
      benefit_focused: { button: 'Get Interview-Ready Now', headline: 'Land Your Dream Job Faster', subtext: '3x more interview callbacks with our complete package' },
      scarcity: { button: 'Claim Your Package — Limited', headline: 'Premium Resume Package', subtext: 'Join 10,000+ who landed interviews this month' },
    }[variant],
    tailoredResume: {
      control: { button: 'Preview Tailored Resume', description: 'Preview for free, then unlock the full Premium Package with tailored resume + cover letter' },
      benefit_focused: { button: 'See Your Improved Resume', description: 'See exactly how your resume will look when optimized for your target role' },
      scarcity: { button: 'Generate Before It Closes', description: 'Limited preview available — see your tailored resume before upgrading' },
    }[variant],
  };
};

// Cover Letter Button component
const CoverLetterButton = ({ 
  hasJobDescription, 
  variant,
  section = 'default'
}: { 
  hasJobDescription: boolean; 
  variant: 'control' | 'benefit_focused' | 'scarcity';
  section?: string;
}) => {
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'coverLetter';
  const copy = getProductCtaCopy(variant, formatPrice, isLocalCurrency).coverLetter;
  
  if (!hasJobDescription) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="w-4 h-4" />
        <span>Add a job description above to unlock</span>
      </div>
    );
  }
  
  return (
    <Button
      onClick={() => purchaseProduct('coverLetter', { ctaSection: section })}
      disabled={isPurchasing}
      size="sm"
      className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
      {...checkoutPrefetchProps}
    >
      {isPurchasing ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <FileText className="w-4 h-4" />
          {copy.button}
        </>
      )}
    </Button>
  );
};

// Keyword Fix Button component
const KeywordFixButton = ({ 
  variant,
  section = 'default'
}: { 
  variant: 'control' | 'benefit_focused' | 'scarcity';
  section?: string;
}) => {
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'basicKeywordFix';
  const copy = getProductCtaCopy(variant, formatPrice, isLocalCurrency).keywordFix;
  
  return (
    <Button
      onClick={() => purchaseProduct('basicKeywordFix', { ctaSection: section })}
      disabled={isPurchasing}
      size="sm"
      className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
      {...checkoutPrefetchProps}
    >
      {isPurchasing ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <Zap className="w-4 h-4" />
          {copy.button}
        </>
      )}
    </Button>
  );
};

// Premium Package Button component
const PremiumPackageButton = ({ 
  variant, 
  isPrimary = false, 
  section = 'default' 
}: { 
  variant: 'control' | 'benefit_focused' | 'scarcity'; 
  isPrimary?: boolean;
  section?: string;
}) => {
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'premiumPackage';
  const copy = getProductCtaCopy(variant, formatPrice, isLocalCurrency).premiumPackage;
  
  const handleClick = () => {
    purchaseProduct('premiumPackage', { ctaSection: section });
  };
  
  if (isPrimary) {
    return (
      <Button
        onClick={handleClick}
        disabled={isPurchasing}
        size="lg"
        className="gap-2 bg-white hover:bg-white/90 text-primary font-bold shadow-lg"
        {...checkoutPrefetchProps}
      >
        {isPurchasing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            {copy.button}
          </>
        )}
      </Button>
    );
  }
  
  return (
    <Button
      onClick={handleClick}
      disabled={isPurchasing}
      size="lg"
      variant="outline"
      className="flex-1 sm:flex-none gap-2 border-primary/30 hover:bg-primary/10 text-primary font-bold"
      {...checkoutPrefetchProps}
    >
      {isPurchasing ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <ArrowRight className="w-5 h-5" />
          {copy.button}
        </>
      )}
    </Button>
  );
};

// Reusable tooltip component for metrics - works on mobile with tap
const MetricTooltip = ({ metricKey }: { metricKey: keyof typeof metricTooltips }) => {
  const [showMobileTooltip, setShowMobileTooltip] = useState(false);
  const isMobile = useIsMobile();
  const tooltip = metricTooltips[metricKey];
  
  if (isMobile) {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setShowMobileTooltip(!showMobileTooltip)}
          className="p-1 -m-1 touch-manipulation"
          aria-label={`Learn about ${tooltip.title}`}
        >
          <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {showMobileTooltip && (
          <div className="absolute z-50 left-0 top-6 w-64 p-3 rounded-xl bg-card border border-border shadow-lg animate-fade-in">
            <button 
              onClick={() => setShowMobileTooltip(false)}
              className="absolute top-2 right-2 p-1 text-muted-foreground"
              aria-label="Close"
            >
              <X className="w-3 h-3" />
            </button>
            <p className="font-semibold text-foreground mb-1 pr-4">{tooltip.title}</p>
            <p className="text-xs text-muted-foreground mb-2">{tooltip.description}</p>
            <p className="text-xs text-primary font-medium">💡 {tooltip.whyMatters}</p>
          </div>
        )}
      </div>
    );
  }
  
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
  category?: "tool" | "skill" | "certification" | "methodology" | "metric" | "regulation";
  impact?: "critical" | "high" | "medium";
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

interface ApplicationRecommendation {
  recommendation: "strong_apply" | "apply_with_changes" | "apply_as_stretch" | "do_not_apply";
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

interface SkillGapAction {
  action: string;
  priority: "must_have" | "should_have" | "nice_to_have";
  timeframe: string;
}

interface CompetitiveAssessment {
  likelyPosition: "top_candidate" | "competitive" | "middle_of_pack" | "unlikely_to_advance";
  strengthVsField: string;
  weaknessVsField: string;
}

interface CareerSituationAdvice {
  tip: string;
  priority: "critical" | "important" | "helpful";
  example?: string;
}

interface CareerSituation {
  situation: "career_changer" | "returning_to_workforce" | "military_transition" | "recent_grad" | "standard";
  confidence: "high" | "medium" | "low";
  indicators: string[];
  tailoredAdvice: CareerSituationAdvice[];
  situationSummary: string;
}

interface LayoutAdvice {
  columns: "one_column" | "two_column";
  useColor: boolean;
  visualElements: "minimal" | "moderate" | "rich";
  rationale: string;
}

interface IndustryNorm {
  norm: string;
  importance: "must_have" | "recommended" | "optional";
}

interface CurrentFormatAssessment {
  isAppropriate: boolean;
  mainIssue: string;
  quickFix: string;
}

interface FormatRecommendation {
  recommendedStyle: "traditional" | "modern" | "creative" | "hybrid";
  layoutAdvice: LayoutAdvice;
  industryNorms: IndustryNorm[];
  avoidList: string[];
  currentFormatAssessment: CurrentFormatAssessment;
  templateSuggestion: string;
}

interface IndustryMustHave {
  item: string;
  present: boolean;
}

interface IndustryScoreInsight {
  weightsApplied: string;
  strongestArea: string;
  weakestArea: string;
  industryMustHaves: IndustryMustHave[];
}

// New personalized career insights interfaces
interface NextRoleSuggestion {
  title: string;
  fit: "natural_progression" | "lateral_move" | "stretch_goal";
  gapToClose: string;
}

interface InterviewTalkingPoint {
  achievement: string;
  storyAngle: string;
}

interface PersonalBrand {
  currentBrand: string;
  idealBrand: string;
  brandGap: string;
}

interface SalaryInsight {
  estimatedRange: string;
  marketPosition: "below_market" | "at_market" | "above_market";
  leveragePoints: string[];
}

interface PersonalizedCareerInsights {
  suggestedHeadline: string;
  nextRoleSuggestions: NextRoleSuggestion[];
  uniqueValue: string;
  interviewTalkingPoints: InterviewTalkingPoint[];
  hiddenStrengths: string[];
  personalBrand: PersonalBrand;
  salaryInsight: SalaryInsight;
  personalizedEncouragement: string;
}

interface EliteSignal {
  type: 'brand_company' | 'large_deal' | 'founding_role' | 'quota_consistency' | 'career_progression';
  signal: string;
  strength: 'high' | 'medium';
}

interface FreeKeywordResultsProps {
  candidateName?: string | null;
  currentRole?: string;
  industry: string;
  atsScoreEstimate: number;
  industryScoreInsight?: IndustryScoreInsight;
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
  onGetJobAnalysis?: (jobTitle: string, jobCompany: string) => void;
  isLoading?: boolean;
  topSkipReasons?: string[];
  powerWords?: string[];
  weakPhrases?: WeakPhrase[];
  timelineAnalysis?: TimelineAnalysis;
  industryBenchmark?: IndustryBenchmark;
  quickWins?: QuickWin[];
  sampleRewrite?: SampleRewrite;
  atsSystemCompatibility?: AtsSystemCompatibility;
  uploadedJobs?: { title: string; company: string }[];
  // Job matching props
  jobMatchScore?: number;
  jobMatchGrade?: "A" | "B" | "C" | "D";
  matchingSkills?: string[];
  missingSkills?: string[];
  experienceFit?: "underqualified" | "good_fit" | "overqualified";
  titleAlignment?: "poor" | "partial" | "strong";
  jobMatchSummary?: string;
  applicationRecommendation?: ApplicationRecommendation;
  skillGapActions?: SkillGapAction[];
  competitiveAssessment?: CompetitiveAssessment;
  careerSituation?: CareerSituation;
  formatRecommendation?: FormatRecommendation;
  personalizedCareerInsights?: PersonalizedCareerInsights;
  onGenerateTailoredResume?: () => void;
  isGeneratingTailored?: boolean;
  // Deep job keyword matching props
  resumeText?: string;
  jobDescriptionText?: string;
  jobTitle?: string;
  jobCompany?: string;
  // Cache control props
  isCached?: boolean;
  onForceReanalyze?: () => void;
  // Enhanced analysis props (new)
  resumeType?: ResumeTypeResult;
  seniorityLevel?: string;
  dualScore?: DualScore;
  calibratedLanguage?: CalibratedLanguage;
  usageRecommendations?: UsageRecommendation[];
  credibilityIssues?: CredibilityIssue[];
  contentLocations?: {
    quota?: ContentLocation;
    metrics?: ContentLocation;
  };
  industryDetection?: IndustryDetection;
  eliteSignals?: EliteSignal[];
  // Industry correction callback
  onIndustryChange?: (newIndustry: string) => void;
}

export function FreeKeywordResults({
  candidateName,
  currentRole,
  industry,
  atsScoreEstimate,
  industryScoreInsight,
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
  onGetJobAnalysis,
  isLoading,
  topSkipReasons: topSkipReasonsProp,
  powerWords: powerWordsProp,
  weakPhrases: weakPhrasesProp,
  timelineAnalysis: timelineAnalysisProp,
  industryBenchmark: industryBenchmarkProp,
  quickWins: quickWinsProp,
  sampleRewrite: sampleRewriteProp,
  atsSystemCompatibility: atsSystemCompatibilityProp,
  uploadedJobs = [],
  jobMatchScore,
  jobMatchGrade,
  matchingSkills = [],
  missingSkills = [],
  experienceFit,
  titleAlignment,
  jobMatchSummary,
  applicationRecommendation,
  skillGapActions = [],
  competitiveAssessment,
  careerSituation,
  formatRecommendation,
  personalizedCareerInsights,
  onGenerateTailoredResume,
  isGeneratingTailored,
  resumeText,
  jobDescriptionText,
  jobTitle,
  jobCompany,
  isCached,
  onForceReanalyze,
  // Enhanced analysis props
  resumeType,
  seniorityLevel,
  dualScore,
  calibratedLanguage,
  usageRecommendations,
  credibilityIssues,
  contentLocations,
  industryDetection,
  eliteSignals,
  onIndustryChange
}: FreeKeywordResultsProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { toast } = useToast();
  const { addScanEntry, setUserEmail, isReturningUser, getLatestScan } = useScanHistory();
  const [hasRecordedScan, setHasRecordedScan] = useState(false);
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);
  const [correctedIndustry, setCorrectedIndustry] = useState<string | null>(null);
  
  // Use corrected industry if set, otherwise use detected
  const effectiveIndustry = correctedIndustry || industry;
  
  // Handle industry correction
  const handleIndustryChange = (newIndustry: string) => {
    setCorrectedIndustry(newIndustry);
    onIndustryChange?.(newIndustry);
    toast({
      title: "Industry Updated",
      description: `Keyword recommendations will now be tailored for ${newIndustry.replace(/_/g, ' ')}.`,
    });
  };
  
  // Record this scan in history (only once per render)
  useEffect(() => {
    if (!hasRecordedScan && atsScoreEstimate) {
      const checklist = generateChecklist({
        quickWins: quickWinsProp,
        formatGrade,
        formatIssue,
        keywords,
        redFlags: redFlagsProp,
      });
      
      const entry = addScanEntry({
        candidateName: candidateName || null,
        currentRole: currentRole || null,
        atsScore: atsScoreEstimate,
        industry: industry || null,
        experienceLevel: experienceLevelProp?.level || null,
        formatGrade: formatGrade,
        keywordCount: keywords?.length || 0,
        redFlagCount: redFlagsProp?.length || 0,
        quantificationScore: quantificationScoreProp?.score,
        bulletImpactScore: bulletImpactScoreProp?.score,
        readabilityScore: readabilityScoreProp?.score,
        checklist,
      }, resumeText);
      
      if (entry) {
        setCurrentScanId(entry.id);
      }
      setHasRecordedScan(true);
    }
  }, [atsScoreEstimate, hasRecordedScan]);
  
  // Get current scan with checklist
  const currentScan = getLatestScan();
  
  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;
  const priceDisplay = isLocalCurrency ? `$${fullAnalysisPrice} ≈ ${formatPrice(fullAnalysisPrice)}` : `$${fullAnalysisPrice}`;
  
  // Winners declared - using control variants
  const getFirstCtaText = () => `Fix These Issues - ${priceDisplay}`;
  const getSecondCtaText = () => `Get Full Analysis - ${priceDisplay}`;
  const getFinalCtaText = () => t('freeScan.cta.button');
  
  // Wrap onGetFullAnalysis with conversion tracking
  const handleUpgradeClick = (source: string) => {
    onGetFullAnalysis();
  };

  // Lightweight fallbacks: when the backend omits some fields, derive them from the raw resume text.
  const extractYearsFromTextLocal = (text: string): number[] => {
    const years: number[] = [];
    const currentYear = new Date().getFullYear();
    const yearRegex = /\b(19[7-9]\d|20[0-2]\d)\b/g;

    let match: RegExpExecArray | null;
    while ((match = yearRegex.exec(text)) !== null) {
      const y = parseInt(match[1], 10);
      if (y >= 1970 && y <= currentYear + 1) years.push(y);
    }

    if (/\b(present|current|ongoing|now|today)\b/i.test(text)) years.push(currentYear);

    return [...new Set(years)].sort((a, b) => a - b);
  };

  const parseYearsEstimateLocal = (estimate?: string | null): number => {
    if (!estimate) return 0;
    const cleaned = estimate.toLowerCase().trim();

    const plusMatch = cleaned.match(/(\d+)\+?\s*years?/i);
    if (plusMatch) return parseInt(plusMatch[1], 10);

    const rangeMatch = cleaned.match(/(\d+)\s*-\s*(\d+)\s*years?/i);
    if (rangeMatch) return parseInt(rangeMatch[2], 10);

    const numMatch = cleaned.match(/(\d+)/);
    if (numMatch) return parseInt(numMatch[1], 10);

    return 0;
  };

  const deriveTotalExperienceText = (): string | null => {
    const text = resumeText?.trim();
    if (text) {
      const years = extractYearsFromTextLocal(text);
      if (years.length > 0) {
        const currentYear = new Date().getFullYear();
        const earliest = years[0];
        const latest = years.includes(currentYear) ? currentYear : years[years.length - 1];
        const span = Math.max(0, latest - earliest);
        if (span > 0) return `${span} ${span === 1 ? "year" : "years"}`;
      }
    }

    const y = parseYearsEstimateLocal(experienceLevelProp?.yearsEstimate);
    return y > 0 ? `${y} ${y === 1 ? "year" : "years"}` : null;
  };

  const getExperienceSectionText = (): string => {
    const text = resumeText || "";
    if (!text) return "";

    const lines = text.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => /\b(professional\s+experience|experience)\b/i.test(l));
    if (startIdx === -1) return text;

    const endIdx = lines.findIndex(
      (l, i) =>
        i > startIdx && /\b(education|skills|certifications|projects|awards|publications)\b/i.test(l)
    );

    return lines.slice(startIdx, endIdx === -1 ? undefined : endIdx).join("\n");
  };

  const extractBullets = (text: string): string[] =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^([•\-*·])\s+/.test(l))
      .map((l) => l.replace(/^([•\-*·])\s+/, "").trim())
      .filter(Boolean);

  const computeQuantificationFromText = (): QuantificationScore | null => {
    const expText = getExperienceSectionText();
    const bullets = extractBullets(expText);
    if (!bullets.length) return null;

    const hasNumber = (s: string) => /(\$|%|\b\d[\d,\.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);

    const mid = Math.ceil(bullets.length / 2);
    const recent = bullets.slice(0, mid);
    const older = bullets.slice(mid);

    const pct = (arr: string[]) => (arr.length ? Math.round((arr.filter(hasNumber).length / arr.length) * 100) : 0);

    const overall = pct(bullets);
    const recentPct = pct(recent);
    const olderPct = pct(older);

    const verdict: QuantificationScore["verdict"] = overall >= 60 ? "strong" : overall >= 40 ? "average" : "weak";

    let tip = "Add more numbers ($, %, #) to show impact.";
    if (recentPct >= 60 && olderPct > 0 && olderPct <= 40) {
      tip = "Strong metrics in summary/recent roles; older roles rely more on responsibilities. Add 1–2 numbers per older role.";
    } else if (overall >= 60) {
      tip = "Good use of numbers—keep this consistency across all roles.";
    } else if (overall >= 40) {
      tip = "Good start—add a few more metrics, especially in older roles.";
    }

    return { score: overall, verdict, tip };
  };

  const computeBulletImpactFromText = (): BulletImpactScore | null => {
    const expText = getExperienceSectionText();
    const bullets = extractBullets(expText);
    if (!bullets.length) return null;

    const hasNumber = (s: string) => /(\$|%|\b\d[\d,\.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);
    const hasResultVerb = (s: string) =>
      /\b(increased|grew|reduced|improved|drove|generated|closed|won|achieved|accelerated|delivered|launched|expanded|exceeded|scaled)\b/i.test(s);
    const responsibilityPhrase = (s: string) => /\b(responsible for|assisted|helped|supported|worked on|duties included)\b/i.test(s);

    const isAchievement = (s: string) => (hasNumber(s) || hasResultVerb(s)) && !responsibilityPhrase(s);

    const mid = Math.ceil(bullets.length / 2);
    const recent = bullets.slice(0, mid);
    const older = bullets.slice(mid);

    const pct = (arr: string[]) => (arr.length ? Math.round((arr.filter(isAchievement).length / arr.length) * 100) : 0);

    const overall = pct(bullets);
    const recentPct = pct(recent);
    const olderPct = pct(older);

    const verdict: BulletImpactScore["verdict"] = overall >= 60 ? "achievement_focused" : overall >= 40 ? "balanced" : "responsibility_heavy";

    let tip = "Lead bullets with outcomes (what changed) before responsibilities (what you did).";
    if (recentPct >= 60 && olderPct > 0 && olderPct <= 40) {
      tip = "Recent bullets show outcomes; older bullets read more like responsibilities. Add results verbs + one metric per older role.";
    } else if (overall >= 60) {
      tip = "Strong achievement focus—keep emphasizing scope + outcomes.";
    } else if (overall >= 40) {
      tip = "Some bullets read as responsibilities—tighten to outcomes + proof.";
    }

    return { score: overall, verdict, tip };
  };

  // Safe defaults
  const resumeLength = resumeLengthProp || { currentPages: 1, recommendedPages: 1, verdict: "just_right" as const };
  const wordCount = wordCountProp || { current: 500, idealMin: 400, idealMax: 600, verdict: "ideal" as const };
  const experienceLevel = experienceLevelProp || { level: "mid" as const, yearsEstimate: "3-5 years" };

  const computedTotalYears = deriveTotalExperienceText();
  const computedQuantificationScore = !quantificationScoreProp && resumeText ? computeQuantificationFromText() : null;
  const computedBulletImpactScore = !bulletImpactScoreProp && resumeText ? computeBulletImpactFromText() : null;

  // NOTE: the backend may omit nested array fields (e.g. missingSections/missingItems),
  // so we deep-default them to avoid runtime `.length` crashes.
  const sectionCheck = {
    hasContact: true,
    hasSummary: false,
    hasExperience: true,
    hasEducation: true,
    hasSkills: true,
    ...sectionCheckProp,
    missingSections: sectionCheckProp?.missingSections ?? [],
  };

  const contactInfo = {
    hasEmail: true,
    hasPhone: true,
    hasLinkedIn: false,
    ...contactInfoProp,
    missingItems: contactInfoProp?.missingItems ?? [],
  };

  const topStrength = topStrengthProp || { title: "Clear Experience", description: "Your work history is well-documented" };
  const quantificationScore =
    quantificationScoreProp ||
    computedQuantificationScore ||
    ({ score: 0, verdict: "average" as const, tip: "Quantification could not be detected from this text." } satisfies QuantificationScore);
  const actionVerbGrade = actionVerbGradeProp || { grade: "B", issue: "Good variety" };
  const readabilityScore = readabilityScoreProp || { score: 65, verdict: "readable" as const, issue: "Some long sentences" };
  const bulletImpactScore =
    bulletImpactScoreProp ||
    computedBulletImpactScore ||
    ({ score: 0, verdict: "balanced" as const, tip: "Bullet impact could not be detected from this text." } satisfies BulletImpactScore);
  const keywordDensity = keywordDensityProp || { level: "moderate" as const, explanation: "Good keyword presence" };
  const improvementPotential = improvementPotentialProp || { level: "medium" as const, estimatedScoreIncrease: 15, topPriority: "Add quantified achievements" };
  const redFlags = redFlagsProp || [];
  const topSkipReasons = topSkipReasonsProp || [];
  const powerWords = powerWordsProp || [];
  const weakPhrases = weakPhrasesProp || [];
  const timelineAnalysis = timelineAnalysisProp || { avgTenure: "2 years", progression: "steady" as const, hasGaps: false, totalYears: computedTotalYears ?? "—" };
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
          industry: effectiveIndustry, 
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
      // Also save email to scan history for returning user tracking
      setUserEmail(email);
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

  const navSections = useMemo(() => {
    const sections = [
      { id: "section-overview", label: "Overview", icon: "📊" },
      { id: "section-metrics", label: "Metrics", icon: "📈" },
      { id: "section-issues", label: "Issues", icon: "⚠️" },
    ];
    if (jobMatchScore !== undefined) {
      sections.push({ id: "section-job-match", label: "Job Match", icon: "🎯" });
    }
    sections.push(
      { id: "section-insights", label: "Insights", icon: "💡" },
      { id: "section-upgrade", label: "Next Steps", icon: "🚀" },
    );
    return sections;
  }, [jobMatchScore]);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="w-full max-w-3xl mx-auto animate-fade-in">
      {/* Dashboard-style Score Hero */}
      <ScoreHero
        candidateName={candidateName}
        currentRole={currentRole}
        industry={effectiveIndustry}
        atsScoreEstimate={atsScoreEstimate}
        experienceLevel={experienceLevel}
        formatGrade={formatGrade}
        redFlagsCount={redFlags.length}
        keywordsCount={keywords?.length || 0}
        quickWinsCount={quickWins?.length || 0}
        quantificationScore={quantificationScore?.score}
        bulletImpactScore={bulletImpactScore?.score}
        isCached={isCached}
        onForceReanalyze={onForceReanalyze}
        isLoading={isLoading}
        eliteSignalsCount={eliteSignals?.length || 0}
      />

      {/* Section Navigation */}
      <SectionNav sections={navSections} className="mb-4" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Overview */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-overview">

      {/* AI-Generated Summary */}
      <AISummary
        candidateName={candidateName}
        atsScore={atsScoreEstimate}
        formatGrade={formatGrade}
        industry={effectiveIndustry}
        experienceLevel={getExperienceLevelLabel(experienceLevel.level)}
        topStrength={topStrength.title}
        redFlagsCount={redFlags.length}
        quickWins={quickWins}
        improvementPotential={improvementPotential}
        resumeHash={currentScan?.resumeHash}
      />

      {/* Enhanced Analysis Display - Resume Type, Dual Scoring, Usage Recommendations */}
      <EnhancedAnalysisDisplay
        resumeType={resumeType}
        seniorityLevel={seniorityLevel}
        dualScore={dualScore}
        calibratedLanguage={calibratedLanguage}
        usageRecommendations={usageRecommendations}
        credibilityIssues={credibilityIssues}
        contentLocations={contentLocations}
        industryDetection={industryDetection}
        industry={effectiveIndustry}
        candidateName={candidateName}
        onIndustryChange={handleIndustryChange}
        resumeTextLength={resumeText?.length}
        visitorId={localStorage.getItem('ab_visitor_id') || undefined}
      />

      {/* Returning User Insights - shown for users who have scanned before */}
      <ReturningUserInsights 
        currentScore={atsScoreEstimate} 
        currentIndustry={effectiveIndustry}
      />

      {/* Industry & Role Keyword Suggestions */}
      <CollapsibleSection
        id="keywords-suggestions"
        title="Industry & Role Keywords"
        subtitle="Keywords relevant to your field and target role"
        icon={<Search className="w-4 h-4" />}
        defaultOpen={false}
      >
        <IndustryKeywordSuggestions 
          industry={effectiveIndustry} 
          resumeText={resumeText}
          className="mb-4"
        />
        <RoleKeywordSuggestions 
          currentRole={currentRole}
          targetRole={jobTitle}
          resumeText={resumeText}
        />
      </CollapsibleSection>

      </div> {/* end section-overview */}

      {/* Compact Action CTA */}
      <div className="rounded-xl bg-gradient-to-r from-destructive/10 to-destructive/5 border border-destructive/20 p-4 mb-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {redFlags.length > 0 
                ? `${redFlags.length} issues found — fix them now`
                : `${atsScoreEstimate < 70 ? 'Critical' : 'Key'} improvements available`
              }
            </p>
            <p className="text-xs text-muted-foreground">
              {currentRole 
                ? `${effectiveIndustry.replace(/_/g, ' ')}-specific fixes for your ${currentRole} resume`
                : `Industry-specific fixes with rewritten bullet points`
              }
            </p>
          </div>
          <Button 
            onClick={() => handleUpgradeClick('action_required_banner')}
            disabled={isLoading}
            size="sm"
            className="gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground shrink-0"
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {getFirstCtaText()}
          </Button>
        </div>
      </div>

      {/* Job Match Section - Show when job description was provided */}
      {jobMatchScore !== undefined && jobMatchGrade && (
        <div id="section-job-match" className="rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-success/10 border-2 border-primary/30 p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-primary/20">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-lg">Job Match Analysis</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-medium">Free & Unlimited</span>
              </div>
              <p className="text-xs text-muted-foreground">Compare your resume against any job — no limits!</p>
            </div>
          </div>

          {/* Application Recommendation Banner */}
          {applicationRecommendation && (
            <div className={cn(
              "rounded-xl p-4 mb-4 border-2",
              applicationRecommendation.recommendation === "strong_apply" ? "bg-success/10 border-success/40" :
              applicationRecommendation.recommendation === "apply_with_changes" ? "bg-warning/10 border-warning/40" :
              applicationRecommendation.recommendation === "apply_as_stretch" ? "bg-primary/10 border-primary/40" :
              "bg-destructive/10 border-destructive/40"
            )}>
              <div className="flex items-center gap-3 mb-2">
                <div className={cn(
                  "p-2 rounded-full",
                  applicationRecommendation.recommendation === "strong_apply" ? "bg-success/20" :
                  applicationRecommendation.recommendation === "apply_with_changes" ? "bg-warning/20" :
                  applicationRecommendation.recommendation === "apply_as_stretch" ? "bg-primary/20" :
                  "bg-destructive/20"
                )}>
                  {applicationRecommendation.recommendation === "strong_apply" ? (
                    <CheckCircle2 className="w-5 h-5 text-success" />
                  ) : applicationRecommendation.recommendation === "apply_with_changes" ? (
                    <Zap className="w-5 h-5 text-warning" />
                  ) : applicationRecommendation.recommendation === "apply_as_stretch" ? (
                    <Target className="w-5 h-5 text-primary" />
                  ) : (
                    <XCircle className="w-5 h-5 text-destructive" />
                  )}
                </div>
                <div>
                  <p className={cn(
                    "font-bold text-lg",
                    applicationRecommendation.recommendation === "strong_apply" ? "text-success" :
                    applicationRecommendation.recommendation === "apply_with_changes" ? "text-warning" :
                    applicationRecommendation.recommendation === "apply_as_stretch" ? "text-primary" :
                    "text-destructive"
                  )}>
                    {applicationRecommendation.recommendation === "strong_apply" ? "✓ Strong Match — Apply Now!" :
                     applicationRecommendation.recommendation === "apply_with_changes" ? "⚡ Good Fit — Apply After Quick Fixes" :
                     applicationRecommendation.recommendation === "apply_as_stretch" ? "🎯 Stretch Role — Apply as Reach" :
                     "✗ Poor Fit — Consider Other Roles"}
                  </p>
                  <p className="text-sm text-muted-foreground">{applicationRecommendation.reasoning}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Confidence:</span>
                <span className={cn(
                  "px-2 py-0.5 rounded-full font-medium",
                  applicationRecommendation.confidence === "high" ? "bg-success/20 text-success" :
                  applicationRecommendation.confidence === "medium" ? "bg-warning/20 text-warning" :
                  "bg-muted text-muted-foreground"
                )}>
                  {applicationRecommendation.confidence}
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {/* Match Score */}
            <div className={cn("rounded-xl border p-3", getScoreBgColor(jobMatchScore))}>
              <p className="text-xs text-muted-foreground mb-1">Match Score</p>
              <p className={cn("text-2xl font-bold", getScoreColor(jobMatchScore))}>
                {jobMatchScore}<span className="text-sm text-muted-foreground">%</span>
              </p>
            </div>

            {/* Match Grade */}
            <div className={cn("rounded-xl border p-3", getGradeBgColor(jobMatchGrade))}>
              <p className="text-xs text-muted-foreground mb-1">Match Grade</p>
              <div className="flex items-baseline gap-1">
                <p className={cn("text-2xl font-bold", getGradeColor(jobMatchGrade))}>{jobMatchGrade}</p>
                <span className={cn("text-xs", getGradeColor(jobMatchGrade))}>{getGradeLabel(jobMatchGrade)}</span>
              </div>
            </div>

            {/* Experience Fit */}
            {experienceFit && (
              <div className={cn("rounded-xl border p-3", 
                experienceFit === "good_fit" ? "bg-success/10 border-success/20" : "bg-warning/10 border-warning/20"
              )}>
                <p className="text-xs text-muted-foreground mb-1">Experience Fit</p>
                <p className={cn("text-lg font-bold capitalize", 
                  experienceFit === "good_fit" ? "text-success" : "text-warning"
                )}>
                  {experienceFit === "good_fit" ? "Good Fit" : experienceFit === "overqualified" ? "Over" : "Under"}
                </p>
              </div>
            )}

            {/* Title Alignment */}
            {titleAlignment && (
              <div className={cn("rounded-xl border p-3", 
                titleAlignment === "strong" ? "bg-success/10 border-success/20" : 
                titleAlignment === "partial" ? "bg-warning/10 border-warning/20" : "bg-destructive/10 border-destructive/20"
              )}>
                <p className="text-xs text-muted-foreground mb-1">Title Match</p>
                <p className={cn("text-lg font-bold capitalize", 
                  titleAlignment === "strong" ? "text-success" : 
                  titleAlignment === "partial" ? "text-warning" : "text-destructive"
                )}>
                  {titleAlignment}
                </p>
              </div>
            )}
          </div>

          {/* Competitive Assessment */}
          {competitiveAssessment && (
            <div className="rounded-xl bg-card border border-border p-4 mb-4">
              <h5 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" />
                How You Compare to Other Applicants
              </h5>
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "px-3 py-1.5 rounded-lg font-semibold text-sm",
                  competitiveAssessment.likelyPosition === "top_candidate" ? "bg-success/20 text-success" :
                  competitiveAssessment.likelyPosition === "competitive" ? "bg-primary/20 text-primary" :
                  competitiveAssessment.likelyPosition === "middle_of_pack" ? "bg-warning/20 text-warning" :
                  "bg-destructive/20 text-destructive"
                )}>
                  {competitiveAssessment.likelyPosition === "top_candidate" ? "🏆 Top Candidate" :
                   competitiveAssessment.likelyPosition === "competitive" ? "💪 Competitive" :
                   competitiveAssessment.likelyPosition === "middle_of_pack" ? "📊 Middle of Pack" :
                   "⚠️ Unlikely to Advance"}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-xs text-success font-medium mb-1">Your Advantage</p>
                  <p className="text-sm text-foreground">{competitiveAssessment.strengthVsField}</p>
                </div>
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-destructive font-medium mb-1">Your Gap</p>
                  <p className="text-sm text-foreground">{competitiveAssessment.weaknessVsField}</p>
                </div>
              </div>
            </div>
          )}

          {/* Skills Matching */}
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            {matchingSkills.length > 0 && (
              <div className="rounded-xl bg-success/5 border border-success/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-success" />
                  <p className="text-sm font-medium text-success">Skills You Have</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {matchingSkills.slice(0, 5).map((skill, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-success/10 text-success border border-success/20">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {missingSkills.length > 0 && (
              <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-destructive" />
                  <p className="text-sm font-medium text-destructive">Skills to Add</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {missingSkills.slice(0, 5).map((skill, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Skill Gap Actions - What to do to be considered */}
          {skillGapActions.length > 0 && (
            <div className="rounded-xl bg-card border border-border p-4 mb-4">
              <h5 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-warning" />
                What You Need to Do to Be Considered
              </h5>
              <div className="space-y-2">
                {skillGapActions.slice(0, 5).map((action, i) => (
                  <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-muted/30">
                    <div className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 mt-0.5",
                      action.priority === "must_have" ? "bg-destructive/20 text-destructive" :
                      action.priority === "should_have" ? "bg-warning/20 text-warning" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {action.priority === "must_have" ? "Must" : action.priority === "should_have" ? "Should" : "Nice"}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-foreground">{action.action}</p>
                      <p className="text-xs text-muted-foreground">⏱ {action.timeframe}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {jobMatchSummary && (
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">💡 Summary:</span> {jobMatchSummary}
              </p>
            </div>
          )}

          {/* Generate Tailored Resume CTA */}
          {onGenerateTailoredResume && (
            <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-success/10 via-success/5 to-primary/10 border-2 border-success/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-full bg-success/20">
                  <Download className="w-5 h-5 text-success" />
                </div>
                <div>
                  <h5 className="font-bold text-foreground">Ready to Apply?</h5>
                  <p className="text-xs text-muted-foreground">Generate a resume tailored specifically for this role</p>
                </div>
              </div>
              <Button
                onClick={onGenerateTailoredResume}
                disabled={isGeneratingTailored}
                className="w-full gap-2 bg-success hover:bg-success/90 text-success-foreground"
              >
                {isGeneratingTailored ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating Tailored Resume...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Tailored Resume & PDF
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
              <p className="text-[10px] text-success/70 mt-2 text-center">
                ✨ AI rewrites your resume for this specific job + downloadable PDF
              </p>
            </div>
          )}
        </div>
      )}
      
      {/* Deep Job Keyword Matching Analysis */}
      {resumeText && jobDescriptionText && (
        <div className="mb-6">
          <JobKeywordMatcher
            jobTitle={jobTitle}
            jobCompany={jobCompany}
            resumeText={resumeText}
            jobDescription={jobDescriptionText}
            extractedKeywords={matchingSkills}
            missingKeywords={missingSkills}
            matchScore={jobMatchScore}
          />
        </div>
      )}
      
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Metrics */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-metrics">

      {/* ATS Score Context Banner - Only shown for below-passing scores */}
      {atsScoreEstimate < 75 && (
        <div className={cn(
          "rounded-xl border p-3 mb-4",
          atsScoreEstimate < 60 
            ? "bg-destructive/5 border-destructive/20" 
            : "bg-warning/5 border-warning/20"
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className={cn("w-4 h-4", atsScoreEstimate < 60 ? "text-destructive" : "text-warning")} />
              <div>
                <p className={cn("text-sm font-semibold", atsScoreEstimate < 60 ? "text-destructive" : "text-warning")}>
                  {atsScoreEstimate < 60 ? "At risk of being filtered out" : "Needs improvement to compete"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {atsScoreEstimate < 60 ? "Most ATS require 60+ to pass" : "75+ increases callback rate"}
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-success shrink-0">75+</span>
          </div>
        </div>
      )}

      {/* Personalized Insights */}
      <CollapsibleSection
        id="personalized-tips"
        title="Personalized Tips"
        subtitle="Tailored insights for your profile"
        icon={<Lightbulb className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="p-4 rounded-xl bg-card/50 border border-border/50">
          <PersonalizedInsights
            industry={industry}
            experienceLevel={experienceLevel}
            atsScore={atsScoreEstimate}
            hasJobDescription={!!jobMatchScore}
            currentRole={currentRole}
          />
        </div>
      </CollapsibleSection>

      {/* Interactive Checklist */}
      {currentScan && currentScan.checklist && currentScan.checklist.length > 0 && (
        <CollapsibleSection
          id="fix-checklist"
          title="Fix Checklist"
          subtitle={`${currentScan.checklist.filter((i: any) => i.completed).length}/${currentScan.checklist.length} completed`}
          icon={<CheckCircle2 className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Track progress
            </span>
          }
        >
          <InteractiveChecklist 
            entryId={currentScan.id}
            items={currentScan.checklist}
            candidateName={candidateName}
          />
        </CollapsibleSection>
      )}

      {/* Dashboard-style Metric Cards Grid */}
      <MetricCardsGrid
        atsScoreEstimate={atsScoreEstimate}
        formatGrade={formatGrade}
        quantificationScore={quantificationScore}
        actionVerbGrade={actionVerbGrade}
        resumeLength={resumeLength}
        wordCount={wordCount}
        sectionCheck={sectionCheck}
        contactInfo={contactInfo}
        readabilityScore={readabilityScore}
        bulletImpactScore={bulletImpactScore}
        keywordDensity={keywordDensity}
        improvementPotential={improvementPotential}
        topStrength={topStrength}
        redFlags={redFlags}
      />

      {/* Elite Signals */}
      {eliteSignals && eliteSignals.length > 0 && (
        <div className="rounded-xl border p-3 bg-primary/5 border-primary/20 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <p className="text-xs font-medium text-primary uppercase tracking-wider">Recruiter-Attracting Signals</p>
          </div>
          <div className="space-y-1.5">
            {eliteSignals.map((signal, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">{signal.signal}</p>
              </div>
            ))}
          </div>
        </div>
      )}


      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Share2 className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">Share Your Results</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">
            Free
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Download your score card or share it on LinkedIn to stand out to recruiters
        </p>
        <ShareableScoreCard
          candidateName={candidateName}
          atsScore={atsScoreEstimate}
          formatGrade={formatGrade}
          industry={industry}
          experienceLevel={getExperienceLevelLabel(experienceLevel.level)}
          topStrength={topStrength.title}
          improvementPotential={improvementPotential.estimatedScoreIncrease}
        />
      </div>

      </div> {/* end section-metrics */}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Issues */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-issues">

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
          
          {/* Industry Comparison - Single consistent message anchored on cohort */}
          {(() => {
            const cohortLabel = `${experienceLevel.level} ${industry} resumes`;
            const isTop = industryBenchmark.comparison === "above";
            const isAt = industryBenchmark.comparison === "at";
            const displayPercentile = industryBenchmark.percentile.includes("%") || industryBenchmark.percentile.toLowerCase().includes("top") || industryBenchmark.percentile.toLowerCase().includes("bottom")
              ? industryBenchmark.percentile
              : isTop ? "Above average" : isAt ? "Around average" : "Below average";

            return (
              <div className={cn(
                "text-center py-3 px-4 rounded-lg mb-3",
                isTop ? "bg-success/15" : isAt ? "bg-warning/15" : "bg-destructive/15"
              )}>
                <p className={cn("text-base font-bold",
                  isTop ? "text-success" : isAt ? "text-warning" : "text-destructive"
                )}>
                  {displayPercentile}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  for ATS readiness among {cohortLabel}
                </p>
              </div>
            );
          })()}
          
          {/* What This Means - Clear, non-contradictory guidance */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-1">
              {industryBenchmark.comparison === "above" 
                ? "✓ Strong position in your industry" 
                : industryBenchmark.comparison === "at" 
                  ? "→ Room for improvement"
                  : "⚠ Below industry average"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {industryBenchmark.comparison === "above" 
                ? "Your resume scores well against peers. Focus on tailoring to specific roles for best results."
                : industryBenchmark.comparison === "at" 
                  ? "Your resume is competitive but could be stronger. The suggestions below will help you stand out."
                : "Other candidates in your field are scoring higher. Apply the fixes below to improve your chances."}
            </p>
          </div>
          
          {/* Job-Specific CTA - show when jobs are uploaded (FREE) */}
          {uploadedJobs.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-success/10 to-success/5 border border-success/20">
              <p className="text-xs font-medium text-foreground mb-2">
                🎯 Want to see how you compare for <span className="text-success font-semibold">{uploadedJobs[0].title}</span> at <span className="text-success font-semibold">{uploadedJobs[0].company}</span>?
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onGetJobAnalysis?.(uploadedJobs[0].title, uploadedJobs[0].company)}
                disabled={isLoading}
                className="w-full gap-2 text-xs h-8 border-success/30 hover:bg-success/10 hover:border-success"
              >
                <Target className="w-3 h-3 text-success" />
                Get Job-Specific Analysis
                <ArrowRight className="w-3 h-3" />
              </Button>
              <p className="text-[10px] text-success/70 mt-1.5 text-center">✨ Free</p>
            </div>
          )}
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

      {/* Career Situation Detection */}
      {careerSituation && careerSituation.situation !== "standard" && (
        <div className="rounded-2xl bg-card border border-border p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            {careerSituation.situation === "career_changer" && <Briefcase className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "returning_to_workforce" && <User className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "military_transition" && <Target className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "recent_grad" && <Trophy className="w-4 h-4 text-primary" />}
            <h4 className="font-semibold flex-1">
              {careerSituation.situation === "career_changer" && "Career Changer Detected"}
              {careerSituation.situation === "returning_to_workforce" && "Returning to Workforce"}
              {careerSituation.situation === "military_transition" && "Military Transition"}
              {careerSituation.situation === "recent_grad" && "Recent Graduate"}
            </h4>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              careerSituation.confidence === "high" ? "bg-success/20 text-success" :
              careerSituation.confidence === "medium" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
            )}>
              {careerSituation.confidence} confidence
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground mb-4">
            {careerSituation.situationSummary}
          </p>

          {/* Indicators */}
          {careerSituation.indicators && careerSituation.indicators.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">What we detected:</p>
              <div className="flex flex-wrap gap-2">
                {careerSituation.indicators.map((indicator, index) => (
                  <span key={index} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                    {indicator}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tailored Advice */}
          {careerSituation.tailoredAdvice && careerSituation.tailoredAdvice.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Tailored advice for your situation:</p>
              {careerSituation.tailoredAdvice.map((advice, index) => (
                <div 
                  key={index}
                  className={cn(
                    "p-3 rounded-lg border",
                    advice.priority === "critical" ? "bg-destructive/5 border-destructive/20" :
                    advice.priority === "important" ? "bg-warning/5 border-warning/20" : "bg-muted/50 border-border"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5",
                      advice.priority === "critical" ? "bg-destructive/20 text-destructive" :
                      advice.priority === "important" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
                    )}>
                      {advice.priority}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{advice.tip}</p>
                      {advice.example && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          Example: "{advice.example}"
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Personalized Career Insights - NEW SECTION */}
      {personalizedCareerInsights && (
        <div className="rounded-2xl bg-gradient-to-br from-primary/5 via-card to-card border border-primary/20 p-5 mb-5 relative overflow-hidden">
          {/* Decorative background */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.08),transparent_50%)] pointer-events-none" />
          
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-xl bg-primary/10">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h4 className="font-bold text-lg">Your Personalized Career Insights</h4>
                <p className="text-xs text-muted-foreground">Tailored just for {candidateName || 'you'}</p>
              </div>
            </div>

            {/* Personalized Encouragement */}
            {personalizedCareerInsights.personalizedEncouragement && (
              <div className="p-4 rounded-xl bg-success/5 border border-success/20 mb-5">
                <p className="text-sm text-foreground italic">
                  "{personalizedCareerInsights.personalizedEncouragement}"
                </p>
              </div>
            )}

            {/* Suggested Headline */}
            {personalizedCareerInsights.suggestedHeadline && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="w-4 h-4 text-primary" />
                  <h5 className="font-semibold text-sm">Your Professional Headline</h5>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border border-border">
                  <p className="font-medium text-foreground">{personalizedCareerInsights.suggestedHeadline}</p>
                  <p className="text-xs text-muted-foreground mt-1">Use this on LinkedIn and your resume header</p>
                </div>
              </div>
            )}

            {/* Unique Value Proposition */}
            {personalizedCareerInsights.uniqueValue && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-primary" />
                  <h5 className="font-semibold text-sm">Your Unique Value</h5>
                </div>
                <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-xl">
                  {personalizedCareerInsights.uniqueValue}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Next Role Suggestions */}
              {personalizedCareerInsights.nextRoleSuggestions && personalizedCareerInsights.nextRoleSuggestions.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Rocket className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">Your Next Career Moves</h5>
                  </div>
                  <div className="space-y-2">
                    {personalizedCareerInsights.nextRoleSuggestions.map((role, index) => (
                      <div key={index} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{role.title}</span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full",
                            role.fit === "natural_progression" ? "bg-success/20 text-success" :
                            role.fit === "lateral_move" ? "bg-primary/20 text-primary" :
                            "bg-warning/20 text-warning"
                          )}>
                            {role.fit === "natural_progression" ? "Natural next step" :
                             role.fit === "lateral_move" ? "Lateral move" : "Stretch goal"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{role.gapToClose}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interview Talking Points */}
              {personalizedCareerInsights.interviewTalkingPoints && personalizedCareerInsights.interviewTalkingPoints.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">Interview Story Ideas</h5>
                  </div>
                  <div className="space-y-2">
                    {personalizedCareerInsights.interviewTalkingPoints.map((point, index) => (
                      <div key={index} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                        <p className="text-xs font-medium text-foreground mb-1">"{point.achievement}"</p>
                        <p className="text-xs text-primary">💡 {point.storyAngle}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Salary Insight */}
            {personalizedCareerInsights.salaryInsight && (
              <div className="mt-5 p-4 rounded-xl bg-gradient-to-r from-success/5 to-primary/5 border border-success/20">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-success" />
                  <h5 className="font-semibold text-sm">Salary Insight</h5>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full ml-auto",
                    personalizedCareerInsights.salaryInsight.marketPosition === "above_market" ? "bg-success/20 text-success" :
                    personalizedCareerInsights.salaryInsight.marketPosition === "at_market" ? "bg-primary/20 text-primary" :
                    "bg-warning/20 text-warning"
                  )}>
                    {personalizedCareerInsights.salaryInsight.marketPosition === "above_market" ? "Above Market" :
                     personalizedCareerInsights.salaryInsight.marketPosition === "at_market" ? "At Market" : "Below Market"}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-bold text-success">{personalizedCareerInsights.salaryInsight.estimatedRange}</span>
                  <span className="text-xs text-muted-foreground">estimated range</span>
                </div>
                {personalizedCareerInsights.salaryInsight.leveragePoints && personalizedCareerInsights.salaryInsight.leveragePoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Your negotiation leverage:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {personalizedCareerInsights.salaryInsight.leveragePoints.map((point, index) => (
                        <span key={index} className="text-xs px-2 py-1 rounded-full bg-success/10 text-success">
                          {point}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hidden Strengths & Personal Brand */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
              {/* Hidden Strengths */}
              {personalizedCareerInsights.hiddenStrengths && personalizedCareerInsights.hiddenStrengths.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4 text-warning" />
                    <h5 className="font-semibold text-sm">Hidden Strengths You're Underselling</h5>
                  </div>
                  <div className="space-y-1.5">
                    {personalizedCareerInsights.hiddenStrengths.map((strength, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                        <span className="text-muted-foreground">{strength}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Personal Brand */}
              {personalizedCareerInsights.personalBrand && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">Your Personal Brand</h5>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-16">Current:</span>
                      <span className="text-muted-foreground">{personalizedCareerInsights.personalBrand.currentBrand}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-success shrink-0 w-16">Ideal:</span>
                      <span className="text-success font-medium">{personalizedCareerInsights.personalBrand.idealBrand}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-warning shrink-0 w-16">Gap:</span>
                      <span className="text-warning">{personalizedCareerInsights.personalBrand.brandGap}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Format Recommendation - Industry-Specific */}
      {formatRecommendation && (
        <div className="rounded-2xl bg-card border border-border p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <LayoutList className="w-4 h-4 text-primary" />
            <h4 className="font-semibold flex-1">Resume Format Recommendation</h4>
            <span className={cn(
              "text-xs px-2 py-1 rounded-full font-medium capitalize",
              formatRecommendation.recommendedStyle === "traditional" ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" :
              formatRecommendation.recommendedStyle === "modern" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400" :
              formatRecommendation.recommendedStyle === "creative" ? "bg-pink-500/20 text-pink-600 dark:text-pink-400" :
              "bg-primary/20 text-primary"
            )}>
              {formatRecommendation.recommendedStyle} style
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Based on {industry} industry standards and your experience level
          </p>

          {/* Current Format Assessment */}
          <div className={cn(
            "p-4 rounded-xl mb-4 border",
            formatRecommendation.currentFormatAssessment.isAppropriate 
              ? "bg-success/10 border-success/20" 
              : "bg-warning/10 border-warning/20"
          )}>
            <div className="flex items-start gap-3">
              {formatRecommendation.currentFormatAssessment.isAppropriate ? (
                <CheckCircle className="w-5 h-5 text-success shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
              )}
              <div>
                <p className={cn(
                  "font-medium",
                  formatRecommendation.currentFormatAssessment.isAppropriate ? "text-success" : "text-warning"
                )}>
                  {formatRecommendation.currentFormatAssessment.isAppropriate 
                    ? "Your format fits your industry!" 
                    : "Format needs adjustment"}
                </p>
                {!formatRecommendation.currentFormatAssessment.isAppropriate && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatRecommendation.currentFormatAssessment.mainIssue}
                  </p>
                )}
                <p className="text-sm font-medium text-primary mt-2">
                  Quick fix: {formatRecommendation.currentFormatAssessment.quickFix}
                </p>
              </div>
            </div>
          </div>

          {/* Layout Advice */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">Layout</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.layoutAdvice.columns === "one_column" ? "Single Column" : "Two Column"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">Color</p>
              <p className="text-sm font-semibold">
                {formatRecommendation.layoutAdvice.useColor ? "✓ Acceptable" : "✗ Avoid"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">Visuals</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.layoutAdvice.visualElements}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center col-span-2 md:col-span-1">
              <p className="text-xs text-muted-foreground mb-1">Style</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.recommendedStyle}
              </p>
            </div>
          </div>

          {/* Industry Norms */}
          {formatRecommendation.industryNorms && formatRecommendation.industryNorms.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-semibold mb-3">What top {industry} resumes do:</p>
              <div className="space-y-2">
                {formatRecommendation.industryNorms.map((norm, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded shrink-0 mt-0.5",
                      norm.importance === "must_have" ? "bg-destructive/20 text-destructive" :
                      norm.importance === "recommended" ? "bg-primary/20 text-primary" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {norm.importance === "must_have" ? "Must" : norm.importance === "recommended" ? "Rec" : "Opt"}
                    </span>
                    <p className="text-sm text-foreground">{norm.norm}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Things to Avoid */}
          {formatRecommendation.avoidList && formatRecommendation.avoidList.length > 0 && (
            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 mb-4">
              <p className="text-xs font-semibold text-destructive mb-2">Avoid for {industry}:</p>
              <div className="flex flex-wrap gap-2">
                {formatRecommendation.avoidList.map((item, index) => (
                  <span key={index} className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive">
                    ✗ {item}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Template Suggestion */}
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
            <p className="text-sm">
              <span className="font-semibold text-primary">Ideal template: </span>
              <span className="text-muted-foreground">{formatRecommendation.templateSuggestion}</span>
            </p>
          </div>
        </div>
      )}

      {/* ATS System Compatibility */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <FileCheck className="w-4 h-4 text-primary" />
          <h4 className="font-semibold flex-1">Estimated ATS Parsing Compatibility</h4>
          <MetricTooltip metricKey="atsCompatibility" />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Estimated compatibility based on your resume's format and structure
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

        {/* Best & Worst Systems Grid - Using bands instead of exact percentages */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Best Systems */}
          <div className="p-4 rounded-xl bg-success/5 border border-success/20">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-success" />
              <span className="text-sm font-semibold text-success">Works Best With</span>
            </div>
            <div className="space-y-2">
              {(atsSystemCompatibility.bestSystems || []).map((system, index) => (
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
                      {system.score >= 80 ? "High" : system.score >= 60 ? "Medium" : "Low"}
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
              {(atsSystemCompatibility.worstSystems || []).map((system, index) => (
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
                      {system.score >= 70 ? "Medium" : "Low"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Disclaimer about estimates */}
        <p className="text-[10px] text-muted-foreground/70 italic mb-3">
          * Compatibility ratings are estimates based on format analysis. Actual results may vary by company configuration.
        </p>

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

        {/* Premium Package CTA */}
        <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 border border-primary/20">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 text-center sm:text-left">
              <p className="font-semibold text-foreground">
                {getProductCtaCopy('control', formatPrice, isLocalCurrency).premiumPackage.headline}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Get an AI-rewritten resume that's optimized for ALL major ATS systems
              </p>
            </div>
            <PremiumPackageButton variant="control" isPrimary section="ats_compatibility" />
          </div>
        </div>
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

          {/* Premium Package CTA */}
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 text-center sm:text-left">
                <p className="font-semibold text-foreground text-sm">
                  Want all your quick wins done for you?
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Our Premium Package includes an AI-rewritten resume with all fixes applied
                </p>
              </div>
              <PremiumPackageButton variant="control" isPrimary section="quick_wins" />
            </div>
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
            <span className="text-xs text-primary">Get all your bullet points rewritten in the full {priceDisplay} analysis</span>
          </div>
        </div>
      )}

      {/* Score-Gated Premium Insights */}
      <div className="space-y-4 mb-6">
        <LockedPremiumInsight
          title="AI-Rewritten Bullet Points"
          description="Get every bullet point rewritten with measurable impact and power verbs"
          previewLines={[
            "• Replace 'Responsible for managing team of 5' → 'Led cross-functional team of 5, driving 32% efficiency gain'",
            "• Replace 'Helped with customer support' → 'Resolved 150+ customer tickets/week, achieving 98% satisfaction'",
            "• Add metrics to 6 bullet points that currently lack quantification",
            "• Restructure 3 responsibility-focused bullets into achievement statements",
          ]}
          onUnlock={() => handleUpgradeClick('locked_bullet_rewrites')}
          isLoading={isLoading}
          variant="highlight"
        />

        <LockedPremiumInsight
          title="Complete Keyword Gap Analysis"
          description={`50+ missing keywords specific to ${effectiveIndustry.replace(/_/g, ' ')} that ATS systems look for`}
          previewLines={[
            "• 12 critical hard skills missing from your resume",
            "• 8 industry certifications to mention (even in progress)",
            "• 15 action verbs that outperform your current word choices",
            "• 6 methodology keywords your competitors are using",
          ]}
          onUnlock={() => handleUpgradeClick('locked_keyword_gap')}
          isLoading={isLoading}
        />

        <LockedPremiumInsight
          title="Personalized Career Strategy"
          description="Salary insights, next-role suggestions, and interview talking points based on your profile"
          previewLines={[
            "• Estimated salary range: $85,000 - $120,000 (based on role + location signals)",
            "• 3 natural next-role progressions with gap analysis for each",
            "• 4 interview talking points derived from your strongest achievements",
            "• Personal brand assessment: current vs ideal positioning",
          ]}
          onUnlock={() => handleUpgradeClick('locked_career_strategy')}
          isLoading={isLoading}
        />
      </div>

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
      <div className="rounded-2xl bg-gradient-to-br from-destructive/15 via-destructive/10 to-destructive/5 border-2 border-destructive/40 p-6 mb-5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-destructive/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-2 rounded-full bg-destructive/20 animate-pulse">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider text-destructive/80">Action Required</span>
          </div>
          <h4 className="text-lg font-bold text-foreground mb-2">
            {redFlags.length}+ Issues Holding Your Resume Back
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            Get specific fixes, rewritten bullet points, and ATS-optimized suggestions tailored to your industry.
          </p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Button 
              onClick={() => handleUpgradeClick('cta_box_1')}
              size="lg"
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lg shadow-destructive/25 hover:shadow-xl hover:shadow-destructive/30 transition-all"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              {getFirstCtaText()}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <span className="text-xs text-muted-foreground">Takes 2 minutes • Instant results</span>
          </div>
        </div>
      </div>

      {/* Premium Resume Package CTA - Clear single action */}
      {onGenerateTailoredResume && (
        <div className="rounded-2xl bg-gradient-to-br from-success/20 via-success/10 to-primary/10 border-2 border-success/40 p-6 mb-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-success/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-full bg-success/20">
                <Download className="w-5 h-5 text-success" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Premium Package</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                  {isLocalCurrency ? `$${PRODUCTS.premiumPackage.priceUsd} ≈ ${formatPrice(PRODUCTS.premiumPackage.priceUsd)}` : `$${PRODUCTS.premiumPackage.priceUsd}`}
                </span>
              </div>
            </div>
            <h4 className="text-xl font-bold text-foreground mb-2">
              🎯 Get Your ATS-Optimized Resume + Cover Letter
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              Our AI rewrites your entire resume to match your target role, plus generates a tailored cover letter — download both as PDFs.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">AI-rewritten resume</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">Custom cover letter</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">PDF download</span>
              </div>
            </div>
            
            {/* Before/After Comparison */}
            <div className="mb-4">
              <ResumeBeforeAfter />
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <PremiumPackageButton variant="control" isPrimary section="tailored_resume" />
            </div>
            <Link to="/pricing" onClick={() => window.scrollTo(0, 0)} className="inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-3">
              See all packages <ArrowRight className="w-3 h-3" />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">
              Complete package: ATS-optimized resume + personalized cover letter ready to send to employers
            </p>
          </div>
        </div>
      )}

      {/* Red Flags Details - Priority sorted with severity indicators */}
      <RedFlagsSection
        redFlags={redFlags}
        onUpgradeClick={() => handleUpgradeClick('red_flags')}
        premiumButton={<PremiumPackageButton variant="control" isPrimary section="red_flags" />}
      />

      {/* Missing Keywords - Priority sorted with impact indicators */}
      <KeywordsSection
        keywords={keywords}
        industry={effectiveIndustry}
        keywordFixButton={<KeywordFixButton variant="control" section="keyword_suggestions" />}
        keywordFixHeadline={getProductCtaCopy('control', formatPrice, isLocalCurrency).keywordFix.headline}
        keywordFixPrice={isLocalCurrency ? `$${PRODUCTS.basicKeywordFix.priceUsd} ≈ ${formatPrice(PRODUCTS.basicKeywordFix.priceUsd)}` : `$${PRODUCTS.basicKeywordFix.priceUsd}`}
      />

      {/* Upgrade CTA Box 2 */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border-2 border-primary/30 p-6 mb-5 relative overflow-hidden">
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex -space-x-1">
              <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-success" />
              </div>
              <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-success" />
              </div>
              <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-success" />
              </div>
            </div>
            <span className="text-xs font-medium text-muted-foreground">10,000+ resumes improved</span>
          </div>
          <h4 className="text-lg font-bold text-foreground mb-2">
            Turn Problems Into Interview Invites
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            Get recruiter-approved rewrites and industry-specific keywords that actually work.
          </p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="text-center p-2 rounded-lg bg-background/50">
              <div className="text-lg font-bold text-primary">10+</div>
              <div className="text-[10px] text-muted-foreground">Sections</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-background/50">
              <div className="text-lg font-bold text-primary">50+</div>
              <div className="text-[10px] text-muted-foreground">Insights</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-background/50">
              <div className="text-lg font-bold text-primary">∞</div>
              <div className="text-[10px] text-muted-foreground">Rewrites</div>
            </div>
          </div>
          <Button 
            onClick={() => handleUpgradeClick('cta_box_2')}
            size="lg"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {getSecondCtaText()}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
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

      {/* Cover Letter CTA - requires job description */}
      <div className="rounded-2xl bg-gradient-to-br from-accent/10 via-primary/5 to-accent/10 border border-accent/30 p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-accent/20 shrink-0">
            <FileText className="w-5 h-5 text-accent-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-bold text-foreground">Custom Cover Letter</h4>
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground font-medium">
                {isLocalCurrency ? `$${PRODUCTS.coverLetter.priceUsd} ≈ ${formatPrice(PRODUCTS.coverLetter.priceUsd)}` : `$${PRODUCTS.coverLetter.priceUsd}`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {getProductCtaCopy('control', formatPrice, isLocalCurrency).coverLetter.description}
            </p>
            <div className="flex flex-wrap gap-2 mb-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Personalized opening</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Skills highlighted</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> Instant download</span>
            </div>
            <CoverLetterButton hasJobDescription={uploadedJobs.length > 0} variant="control" section="cover_letter_cta" />
          </div>
        </div>
      </div>

      {/* Premium Package Hero CTA */}
      <div className="rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-primary/80 border-2 border-primary p-6 mb-5 relative overflow-hidden shadow-xl shadow-primary/20">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary-foreground/80">Best Value</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-primary-foreground font-bold">{PRODUCTS.premiumPackage.savings}</span>
          </div>
          <h3 className="text-2xl font-bold text-primary-foreground mb-2">
            {getProductCtaCopy('control', formatPrice, isLocalCurrency).premiumPackage.headline}
          </h3>
          <p className="text-sm text-primary-foreground/80 mb-4">
            {getProductCtaCopy('control', formatPrice, isLocalCurrency).premiumPackage.subtext}: full analysis + AI-rewritten resume + custom cover letter.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              "Complete ATS analysis",
              "AI-rewritten resume",
              "Custom cover letter",
              "Before/after comparison",
              "Keyword optimization",
              "Priority processing"
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-primary-foreground/90">
                <CheckCircle2 className="w-3 h-3 text-primary-foreground shrink-0" />
                {feature}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <PremiumPackageButton variant="control" isPrimary section="bottom_cta" />
            <div className="text-primary-foreground">
              <span className="text-2xl font-bold">
                {isLocalCurrency ? `$${PRODUCTS.premiumPackage.priceUsd} ≈ ${formatPrice(PRODUCTS.premiumPackage.priceUsd)}` : `$${PRODUCTS.premiumPackage.priceUsd}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tiered Pricing Options */}
      <TieredPricingSection onFullAnalysisCheckout={onGetFullAnalysis} />

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

      {/* Job Comparison CTA - show when jobs are uploaded (FREE feature) */}
      {uploadedJobs.length > 0 && (
        <div className="p-5 rounded-2xl border border-success/30 bg-gradient-to-br from-success/5 via-background to-success/10 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-success" />
            <h4 className="font-medium text-foreground">Want to see how you compare for <span className="text-primary">{uploadedJobs[0]?.title}</span> at <span className="text-primary">{uploadedJobs[0]?.company}</span>?</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {uploadedJobs.slice(0, 3).map((job, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => onGetJobAnalysis?.(job.title, job.company)}
                disabled={isLoading}
                className="group border-success/30 hover:border-success hover:bg-success/10 transition-all"
              >
                <Target className="w-3.5 h-3.5 mr-1.5 text-success" />
                <span className="truncate max-w-[180px]">Get Job-Specific Analysis</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-success" />
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Get personalized insights for your target role
          </p>
        </div>
      )}

      {/* Final CTA */}
      <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-background to-primary/5 border border-primary/20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-medium mb-3">
          <CheckCircle2 className="w-3 h-3" />
          One-time payment • Instant access
        </div>
        <Button 
          size="lg" 
          onClick={() => handleUpgradeClick('final_cta')}
          disabled={isLoading}
          className="gap-2 px-10 h-14 text-lg font-bold bg-gradient-to-r from-primary via-primary to-primary/80 hover:from-primary/90 hover:via-primary/90 hover:to-primary/70 shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          {getFinalCtaText()} — {t('freeScan.cta.price')}
          <ArrowRight className="w-5 h-5" />
        </Button>
        <WalletPaymentBadge className="mt-3" />
        <p className="text-sm text-muted-foreground mt-2">
          <span className="text-success font-medium">One interview = {priceDisplay} paid for itself</span>
        </p>
      </div>
    </div>
    </TooltipProvider>
  );
}
