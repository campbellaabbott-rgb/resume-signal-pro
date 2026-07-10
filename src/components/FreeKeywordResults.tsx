import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { useTranslation } from "react-i18next";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useTodayScanCount } from "@/hooks/use-shared-data";
import { useABTest } from "@/hooks/use-ab-test";
import { 
  Sparkles, ArrowRight, CheckCircle2, Target, Zap, Lock, Mail, Loader2, ListChecks, Award,
  FileCheck, FileText, AlertTriangle, Type, User, LayoutList, Phone, 
  Trophy, Hash, Pencil, XCircle, CheckCircle, HelpCircle, Briefcase, Download, Apple, X,
  TrendingUp, RefreshCw, Share2, Star, DollarSign, MessageSquare, Lightbulb, Copy, Rocket,
  BarChart3, Shield, Search, Settings2, Eye, Flame, FileEdit, Send
} from "lucide-react";
import { LockedPremiumInsight } from "./LockedPremiumInsight";
import { ScanOutcomeAsk } from "./ScanOutcomeAsk";
import { SaveResumeVersion } from "./SaveResumeVersion";
import { WalletPaymentBadge } from "./WalletPaymentBadge";
import { PersonalizedInsights } from "./PersonalizedInsights";
import { ElevatorPitchGenerator } from "./ElevatorPitchGenerator";
import { RecruiterViewMode } from "./RecruiterViewMode";
import { ResumeRoast } from "./ResumeRoast";
import { InterviewCoach } from "./InterviewCoach";
import { CareerPathSimulator } from "./CareerPathSimulator";
import { TieredPricingSection } from "./TieredPricingSection";
import { ResumeBeforeAfter } from "./ResumeBeforeAfter";
import { JobKeywordMatcher } from "./JobKeywordMatcher";
import { ATSParseSimulator } from "./ATSParseSimulator";
import { PeerBenchmark } from "./PeerBenchmark";
import { ReturningUserInsights } from "./ReturningUserInsights";
import { IndustryKeywordSuggestions } from "./IndustryKeywordSuggestions";
import { RoleKeywordSuggestions } from "./RoleKeywordSuggestions";
import { analyzeKeywordPresence } from "@/config/industry-keywords";
import { AddOnsShowcase } from "./AddOnsShowcase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useScanHistory, generateChecklist } from "@/hooks/use-scan-history";
import { emailSchema } from "@/lib/security-validation";
import { InteractiveChecklist } from "./InteractiveChecklist";
import { AISummary } from "./AISummary";
import { ShareableScoreCard } from "./ShareableScoreCard";
import { ResumeXRay } from "./ResumeXRay";
import { ScoreSimulatorCard, AtsVendorChecksCard, WeakestBulletsCard, CareerBridgeCard, ScoreAuditCard, ShareScoreCard, FreelanceGuidanceCard, IndustryChecksCard, CountryStandardsCard, DiagnosticHeader, FindingsIndex, computeVendorChecks, type Finding } from "./ReportInsightCards";
import { EmailReportCapture } from "./EmailReportCapture";
import { CardErrorBoundary } from "./CardErrorBoundary";
import { getAvailableIndustries } from "./IndustryConfidenceIndicator";
import { diffWords } from "@/lib/diff-words";
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

// Tooltip explanations for each metric — built from translation keys since this
// is consumed by the standalone MetricTooltip component below, which doesn't
// otherwise have a t() in scope at module-evaluation time.
const METRIC_TOOLTIP_KEYS = [
  "atsScore", "format", "metrics", "verbs", "pages", "words", "sections",
  "contact", "readability", "bulletImpact", "keywordDensity",
  "improvementPotential", "industryBenchmark", "timeline", "atsCompatibility"
] as const;

type MetricTooltipKey = typeof METRIC_TOOLTIP_KEYS[number];

const getMetricTooltip = (t: (key: string) => string, metricKey: MetricTooltipKey) => ({
  title: t(`freeResults.metricTooltips.${metricKey}.title`),
  description: t(`freeResults.metricTooltips.${metricKey}.description`),
  whyMatters: t(`freeResults.metricTooltips.${metricKey}.whyMatters`),
});

// A/B Test copy variants for product CTAs - reads from translation keys so
// every variant is localized; the variant key itself maps to a camelCase
// translation sub-key (benefit_focused -> benefitFocused).
const getProductCtaCopy = (
  variant: 'control' | 'benefit_focused' | 'scarcity',
  t: (key: string, options?: Record<string, unknown>) => string,
  formatLocalPrice: (usd: number) => string,
  isLocal: boolean
) => {
  const variantKey = variant === 'benefit_focused' ? 'benefitFocused' : variant;
  const coverLetterPrice = isLocal
    ? `$${PRODUCTS.coverLetter.priceUsd} ≈ ${formatLocalPrice(PRODUCTS.coverLetter.priceUsd)}`
    : `$${PRODUCTS.coverLetter.priceUsd}`;
  const premiumPrice = isLocal
    ? `$${PRODUCTS.premiumPackage.priceUsd} ≈ ${formatLocalPrice(PRODUCTS.premiumPackage.priceUsd)}`
    : `$${PRODUCTS.premiumPackage.priceUsd}`;

  return {
    coverLetter: {
      button: t(`freeResults.ctaCopy.coverLetter.${variantKey}.button`, { price: coverLetterPrice }),
      description: t(`freeResults.ctaCopy.coverLetter.${variantKey}.description`),
    },
    keywordFix: {
      button: t(`freeResults.ctaCopy.keywordFix.${variantKey}.button`),
      headline: t(`freeResults.ctaCopy.keywordFix.${variantKey}.headline`),
    },
    premiumPackage: {
      button: t(`freeResults.ctaCopy.premiumPackage.${variantKey}.button`, { price: premiumPrice }),
      headline: t(`freeResults.ctaCopy.premiumPackage.${variantKey}.headline`),
      subtext: t(`freeResults.ctaCopy.premiumPackage.${variantKey}.subtext`),
    },
    tailoredResume: {
      button: t(`freeResults.ctaCopy.tailoredResume.${variantKey}.button`),
      description: t(`freeResults.ctaCopy.tailoredResume.${variantKey}.description`),
    },
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
  const { t } = useTranslation();
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'coverLetter';
  const copy = getProductCtaCopy(variant, t, formatPrice, isLocalCurrency).coverLetter;

  if (!hasJobDescription) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="w-4 h-4" />
        <span>{t('freeResults.addJobDescriptionToUnlock')}</span>
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
          {t('freeResults.processing')}
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
  const { t } = useTranslation();
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'basicKeywordFix';
  const copy = getProductCtaCopy(variant, t, formatPrice, isLocalCurrency).keywordFix;

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
          {t('freeResults.processing')}
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

// Apply Assistant Button component — requires a job description to be present,
// since the product tailors a resume + cover letter to a specific posting.
const ApplyAssistantButton = ({
  hasJobDescription,
  section = 'default'
}: {
  hasJobDescription: boolean;
  section?: string;
}) => {
  const { t } = useTranslation();
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const isPurchasing = isLoading && currentProduct === 'applyAssistant';

  if (!hasJobDescription) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="w-4 h-4" />
        <span>{t('freeResults.addJobDescriptionToUnlock')}</span>
      </div>
    );
  }

  return (
    <Button
      onClick={() => purchaseProduct('applyAssistant', { ctaSection: section })}
      disabled={isPurchasing}
      size="sm"
      className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
      {...checkoutPrefetchProps}
    >
      {isPurchasing ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('freeResults.processing')}
        </>
      ) : (
        <>
          <Send className="w-4 h-4" />
          {t('freeResults.buildApplicationPackage', { price: PRODUCTS.applyAssistant.priceUsd })}
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
  const { t } = useTranslation();
  const { purchaseProduct, isLoading, currentProduct, checkoutPrefetchProps } = useProductCheckout();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const isPurchasing = isLoading && currentProduct === 'premiumPackage';
  const copy = getProductCtaCopy(variant, t, formatPrice, isLocalCurrency).premiumPackage;

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
            {t('freeResults.processing')}
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
          {t('freeResults.processing')}
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
const MetricTooltip = ({ metricKey }: { metricKey: MetricTooltipKey }) => {
  const { t } = useTranslation();
  const [showMobileTooltip, setShowMobileTooltip] = useState(false);
  const isMobile = useIsMobile();
  const tooltip = getMetricTooltip(t, metricKey);

  if (isMobile) {
    return (
      <div className="relative inline-block">
        <button
          onClick={() => setShowMobileTooltip(!showMobileTooltip)}
          className="p-1 -m-1 touch-manipulation"
          aria-label={t('freeResults.learnAboutMetric', { metric: tooltip.title })}
        >
          <HelpCircle className="w-3 h-3 text-muted-foreground/50" />
        </button>
        {showMobileTooltip && (
          <div className="absolute z-50 left-0 top-6 w-64 p-3 rounded-xl bg-card border border-border shadow-lg animate-fade-in">
            <button
              onClick={() => setShowMobileTooltip(false)}
              className="absolute top-2 right-2 p-1 text-muted-foreground"
              aria-label={t('common.close')}
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
  frequencyWeight?: number;
  suggestedSection?: 'summary' | 'experience' | 'skills';
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
  sectionQuality?: {
    summary?: "strong" | "adequate" | "thin" | "missing";
    experience?: "strong" | "adequate" | "thin" | "missing";
    skills?: "strong" | "adequate" | "thin" | "missing";
    education?: "strong" | "adequate" | "thin" | "missing";
  };
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
  severity?: "critical" | "moderate" | "minor";
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
  scoreImpact?: number;
  category?: string;
}

interface SampleRewrite {
  before: string;
  after: string;
  improvement: string;
}

// Matches what the scan actually returns (atsCompatibility): an overall
// rating plus best-for/worst-for context. The old shape here (per-vendor
// arrays with numeric scores) was never sent by the server — the card fell
// back to identical hardcoded vendor scores for every user. Real per-vendor
// behavior lives in AtsVendorChecksCard (deterministic, documented checks).
interface AtsSystemCompatibility {
  overallRating: string; // "Poor" | "Fair" | "Good" | "Excellent" (any case)
  topIssue?: string;
  bestFor?: string;
  worstFor?: string;
}

interface ApplicationRecommendation {
  recommendation: "strong_apply" | "apply_with_changes" | "apply_as_stretch" | "do_not_apply";
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

interface MissingSkillDetail {
  skill: string;
  category: "hard_skill" | "soft_skill" | "tool" | "certification" | "methodology";
  importance: "critical" | "important" | "nice_to_have";
  isImplicit: boolean;
  fixSuggestion: string;
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

export interface FreeKeywordResultsProps {
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
  powerWords?: Array<string | { word: string; why: string }>;
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
  missingSkillsDetailed?: MissingSkillDetail[];
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
  // Set only for PDF uploads (needs position data from text extraction) — see
  // ATSParseSimulator, which skips the layout check entirely when undefined.
  multiColumnDetected?: boolean;
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
  // Pre-detected weak bullets quoted directly from resume
  weakBulletsDetected?: { text: string; role: string; reason: string }[];
  unquantifiedBulletsDetected?: { text: string; role: string }[];
  bulletQuantRate?: number;
  projectedScore?: number | null;
  // Market intelligence
  marketIntelligence?: {
    country: string; countryName: string; countrySource: string;
    hotSkills: string[]; risingKeywords: string[]; cvNorms: string[];
    salaryContext: string | null; marketSummary: string;
  };
  skillsRecency?: { agingSkills: string[]; freshSkills: string[]; freshnessScore: number; hasAgingSignals: boolean };
  careerTrajectory?: { trajectory: string; promotionCount: number; industryTransitionDetected: boolean; fromIndustry: string | null; progressionSummary: string };
  atsSystemDetected?: { system: string; name: string; parsingStrength: string } | null;
  competitiveGap?: { missingHighFrequency: string[]; presentHighFrequency: string[]; gapScore: number };
  gatedKeywords?: Array<{ keyword: string; category: string; gated: true }>;
  detectionQualityScore?: number;
  resumeTimeline?: {
    totalExperienceMonths: number;
    hasSignificantGap: boolean;
    hasShortTenures: boolean;
    gapPeriods: Array<{ afterTitle: string; monthsGap: number }>;
    averageTenureMonths: number;
    rolesDetected: number;
    summary: string;
  };
  // 10 reporting improvements (batch 1)
  scoreBreakdown?: { keywords: number; format: number; quantification: number };
  additionalRewrites?: Array<{ before: string; after: string; improvement: string }>;
  nextBestAction?: { action: string; why: string; estimatedImpact: string };
  recruiterFirstPassSummary?: string;
  formatGradeDrivers?: Array<{ driver: string; impact: string }>;
  // 10 reporting improvements (batch 2)
  atsParsedPreview?: string;
  peerPercentile?: number;
  applicationPassRate?: number;
  titleLevelMismatch?: { detected: boolean; claimedLevel: string; bulletLevel: string; icVerbs: string[]; tip: string };
  toneAudit?: { passiveCount: number; activeCount: number; firstPersonCount: number; passiveRatio: number; verdict: 'too_passive' | 'mixed' | 'active' };
  sectionWordCounts?: Record<string, { current: number; idealMin: number; idealMax: number; verdict: 'too_few' | 'ideal' | 'too_many' }>;
  // Personalization & coverage batch
  subIndustry?: { id: string; label: string; matchedSignals: string[] };
  jdTargetIndustry?: string;
  industryBlend?: { primary: string; secondary: string; primaryPct: number; secondaryPct: number };
  interviewLikelihood?: { band: 'strong' | 'moderate' | 'low' | 'very_low'; composite: number; topFactor: string };
  competitorSilhouette?: {
    archetype: { quantifiedBullets: number; leadershipSignals: number; keywordCoveragePct: number };
    user: { quantifiedBullets: number; leadershipSignals: number; keywordCoveragePct: number };
  };
  fixRoadmap?: {
    steps: Array<{ order: number; step: string; minutes: number; scoreImpact: number; projectedScoreAfter: number }>;
    totalMinutes: number;
    finalProjectedScore: number;
  };
  // Enterprise reporting batch
  reportVerdict?: string;
  dualIndustryComparison?: {
    primary: { industry: string; score: number; keywordCoveragePct: number; benchmarkMedian: number };
    secondary: { industry: string; score: number; keywordCoveragePct: number; benchmarkMedian: number };
  };
  premiumTeaser?: { rewritePreview: string; totalRewritesAvailable: number };
  executiveScopeCheck?: {
    level: string;
    signals: { teamSize: string | null; budgetOrPL: string | null; revenueImpact: string | null; boardExposure: boolean; strategicLanguage: boolean };
    presentCount: number;
    missing: string[];
  };
  resumeTriggeredQuestions?: Array<{ question: string; trigger: string; howToPrepare: string }>;
  /** User-stated situation from the pre-scan intent capture */
  scanSituation?: string;
  /** Persist confirmed labels (industry/experience) to the user's remembered context */
  onContextConfirm?: (ctx: { confirmedIndustry?: string | null; confirmedExperience?: string | null }) => void;
  recruiterPanel?: {
    screener: { verdict: string; wouldPass?: boolean };
    hiringManager: { verdict: string; biggestDoubt?: string };
    hrScreener: { verdict: string; levelRead?: string };
  };
  weakestBullets?: Array<{ original: string; grade: string; issues: string[]; rewrite: string }>;
  careerChangeBridge?: {
    fromField: string; toField: string; carryOver: string[];
    needsReframing: Array<{ current: string; reframed: string }>;
    gapToClose: string;
  } | null;
  scoreAudit?: { total: number; items: Array<{ label: string; earned: number; possible: number; detail: string }> } | null;
  /** When the JD's industry differs from the resume's, benchmarks use this */
  benchmarkIndustry?: string | null;
  /** Detection wasn't high-confidence — make the confirmation strip prominent */
  industryNeedsConfirmation?: boolean;
  /** Full-text vs recent-role detection disagreed — likely career transition */
  industryTransition?: { historical: string; recent: string } | null;
  freelanceGuidance?: {
    positioning: string;
    projectsAsExperience: Array<{ project: string; presentAs: string }>;
    employerTransition?: string;
  } | null;
  /** Present when benchmarks come from our real scan corpus, not estimates */
  realBenchmark?: { n: number; median: number; p25: number; p75: number; industry: string } | null;
  industrySpecificChecks?: { industry: string; items: Array<{ label: string; present: boolean; note: string }> } | null;
  countryStandards?: import("./ReportInsightCards").CountryStandardsData | null;
  platformProfileDetected?: { signals: string[] } | null;
  reportMeta?: { reportId: string; engineVersion: string; generatedAt: string; industry: string; industryConfidence: string; benchmarkSource: string } | null;
  parseQuality?: { verdict: 'good' | 'fair' | 'poor'; wordCount: number; issues: string[] } | null;
  /** Honest score band spanning the rule-based computation and AI estimate */
  scoreBand?: { low: number; high: number } | null;
  /** A real job posting was part of this scan — keyword analysis is exact */
  hadJobDescription?: boolean;
  /** Text came from a real file extraction, not pasted text */
  sourceWasFile?: boolean;
  /** Provenance of keyword expectations: employer's posting, O*NET, or model */
  keywordSource?: { source: 'job_description' | 'onet' | 'model'; occupation?: string; code?: string } | null;
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
  missingSkillsDetailed = [],
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
  multiColumnDetected,
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
  onIndustryChange,
  weakBulletsDetected = [],
  unquantifiedBulletsDetected = [],
  bulletQuantRate,
  projectedScore,
  marketIntelligence,
  skillsRecency,
  careerTrajectory,
  atsSystemDetected,
  competitiveGap,
  gatedKeywords,
  detectionQualityScore,
  resumeTimeline,
  scoreBreakdown,
  additionalRewrites,
  nextBestAction,
  recruiterFirstPassSummary,
  formatGradeDrivers,
  atsParsedPreview,
  peerPercentile,
  applicationPassRate,
  titleLevelMismatch,
  toneAudit,
  sectionWordCounts,
  subIndustry,
  jdTargetIndustry,
  industryBlend,
  interviewLikelihood,
  competitorSilhouette,
  fixRoadmap,
  reportVerdict,
  dualIndustryComparison,
  premiumTeaser,
  executiveScopeCheck,
  resumeTriggeredQuestions,
  recruiterPanel,
  scanSituation,
  onContextConfirm,
  weakestBullets,
  careerChangeBridge,
  scoreAudit,
  benchmarkIndustry,
  industryNeedsConfirmation,
  industryTransition,
  freelanceGuidance,
  realBenchmark,
  industrySpecificChecks,
  countryStandards,
  platformProfileDetected,
  reportMeta,
  parseQuality,
  scoreBand,
  hadJobDescription,
  sourceWasFile,
  keywordSource,
}: FreeKeywordResultsProps) {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const { trackButtonClick } = useConversionTracking();
  const scanCountData = useTodayScanCount();
  const { variant: contentDepthVariant, trackConversion: trackContentDepthConversion } = useABTest('free_content_depth');
  // Diagnostic layout supersedes the gated-content experiment: locked/blurred
  // cards mid-report are interleaved commerce, which the layout decision
  // rejected. Deep insights render ungated for everyone.
  const gateDeepInsights = false;
  void contentDepthVariant;
  // Diagnostic-report layout — promoted from A/B test to the default by owner
  // decision (2026-07-05): findings run uninterrupted, every offer lives in
  // the "Next steps" section at the end, professional tone throughout.
  const diagnosticLayout = true;
  // Strip decorative emoji from headings in the diagnostic variant
  const tone = (s: string) => diagnosticLayout ? s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*/gu, '').trim() : s;
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { toast } = useToast();
  const { addScanEntry, setUserEmail, isReturningUser, getLatestScan, getPreviousScan } = useScanHistory();
  // Direct product checkout for Next Steps offers that are NOT the $25 full
  // analysis (audit 2026-07-08: the $5 Interview Coach button was routing
  // into the $25 flow via handleUpgradeClick).
  const { purchaseProduct: purchaseProductDirect } = useProductCheckout();
  const [hasRecordedScan, setHasRecordedScan] = useState(false);
  const [correctedIndustry, setCorrectedIndustry] = useState<string | null>(null);
  const [showExitOffer, setShowExitOffer] = useState(false);
  const [scanTimestamp] = useState(() => Date.now());

  // Exit-intent fallback offer: if someone scrolls through every upsell and
  // starts to leave without buying anything, show the cheapest paid product
  // once instead of just losing them. Fires on the classic "mouse left
  // toward the top of the viewport" signal, once per session (sessionStorage
  // guard) so it can't become an annoyance on repeat visits or re-renders.
  useEffect(() => {
    if (sessionStorage.getItem('exitOfferShown')) return;

    const handleMouseOut = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) {
        setShowExitOffer(true);
        sessionStorage.setItem('exitOfferShown', 'true');
        document.removeEventListener('mouseout', handleMouseOut);
      }
    };

    document.addEventListener('mouseout', handleMouseOut);
    return () => document.removeEventListener('mouseout', handleMouseOut);
  }, []);

  // Use corrected industry if set, otherwise use detected
  const effectiveIndustry = correctedIndustry || industry;

  // Real counts for the "Complete Keyword Gap Analysis" upsell card below —
  // these used to be the same hardcoded marketing copy for every user
  // ("50+ missing keywords", "12 critical hard skills") regardless of what's
  // actually in their resume, which is exactly the kind of fake-precision
  // claim that undercuts trust right in the section meant to convert. Computed
  // from the same analyzeKeywordPresence() used by IndustryKeywordSuggestions.
  const realKeywordGapStats = useMemo(() => {
    if (!resumeText) return null;
    const analysis = analyzeKeywordPresence(effectiveIndustry, resumeText);
    if (analysis.missing.length === 0 && analysis.present.length === 0) return null; // No config for this industry

    const byCategory = (category: string) => analysis.missing.filter((k) => k.category === category).length;
    return {
      totalMissing: analysis.missing.length,
      criticalMissing: analysis.missing.filter((k) => k.importance === 'critical').length,
      technical: byCategory('technical'),
      certifications: byCategory('certification'),
      tools: byCategory('tool'),
      methodology: byCategory('methodology'),
    };
  }, [effectiveIndustry, resumeText]);

  // Handle industry correction
  const handleIndustryChange = (newIndustry: string) => {
    setCorrectedIndustry(newIndustry);
    onIndustryChange?.(newIndustry);
    // Feed the detection feedback loop: recurring detected→corrected pairs
    // surface in the weekly digest and become disambiguation rules.
    if (industry && newIndustry !== industry) {
      supabase.rpc('log_industry_correction' as never, {
        p_detected: industry,
        p_corrected: newIndustry,
        p_source: 'report_confirmation_strip',
        p_confidence: null,
      } as never).then(() => {}, () => {});
    }
    toast({
      title: t('freeResults.industryUpdated'),
      description: t('freeResults.industryUpdatedDescription', { industry: newIndustry.replace(/_/g, ' ') }),
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
      
      addScanEntry({
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

      setHasRecordedScan(true);
    }
  }, [atsScoreEstimate, hasRecordedScan]);
  
  // Get current scan with checklist
  const currentScan = getLatestScan();
  
  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;
  const priceDisplay = isLocalCurrency ? `$${fullAnalysisPrice} ≈ ${formatPrice(fullAnalysisPrice)}` : `$${fullAnalysisPrice}`;
  
  const getFirstCtaText = () => t('freeResults.cta.fixIssues', { price: priceDisplay });
  const getSecondCtaText = () => t('freeResults.cta.getFullAnalysis', { price: priceDisplay });
  const getFinalCtaText = () => t('freeScan.cta.button');

  // Track which CTA converts, then trigger checkout
  const handleUpgradeClick = (source: string) => {
    trackButtonClick('fullAnalysis', source);
    trackContentDepthConversion({ source });
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

  // Real weak bullets for the "AI-Rewritten Bullet Points" upsell card below —
  // this used to show the same generic stock example ("Replace 'Responsible
  // for managing team of 5'...") to every single user. Quoting their own
  // actual bullet that lacks a number is both more honest and a much harder
  // claim to dismiss than a made-up illustration. Deliberately NOT showing a
  // fabricated "after" rewrite of their specific bullet — that's the actual
  // paid output, not something to give away or fake in the free preview.
  const realWeakBullets = useMemo(() => {
    const expText = getExperienceSectionText();
    const bullets = extractBullets(expText);
    if (!bullets.length) return null;

    const hasNumber = (s: string) => /(\$|%|\b\d[\d,.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);
    const weak = bullets.filter((b) => !hasNumber(b) && b.length >= 30 && b.length <= 180);

    return {
      weakCount: weak.length,
      totalCount: bullets.length,
      examples: weak.slice(0, 2),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeText]);

  const computeQuantificationFromText = (): QuantificationScore | null => {
    const expText = getExperienceSectionText();
    const bullets = extractBullets(expText);
    if (!bullets.length) return null;

    const hasNumber = (s: string) => /(\$|%|\b\d[\d,.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);

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

    const hasNumber = (s: string) => /(\$|%|\b\d[\d,.]*\b|\b\d+\s*(k|m|b)\b)/i.test(s);
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
  // Honest fallbacks only (audit 2026-07-08): when the scan omits these
  // fields, derive from the actual resume text instead of showing every user
  // the same invented numbers. Non-derivable metrics fall through as null and
  // their tiles hide.
  const realWordCount = (resumeText ?? "").split(/\s+/).filter(Boolean).length;
  const resumeLength = resumeLengthProp || (realWordCount > 0 ? (() => {
    const pages = Math.max(1, Math.ceil(realWordCount / 550));
    const recommended = (experienceLevelProp?.level === "senior" || experienceLevelProp?.level === "executive") ? 2 : 1;
    return { currentPages: pages, recommendedPages: recommended, verdict: (pages > recommended ? "too_long" : pages < recommended ? "too_short" : "just_right") as "too_short" | "just_right" | "too_long" };
  })() : null);
  const wordCount = wordCountProp || (realWordCount > 0
    ? { current: realWordCount, idealMin: 400, idealMax: 850, verdict: (realWordCount < 400 ? "too_few" : realWordCount > 850 ? "too_many" : "ideal") as "too_few" | "ideal" | "too_many" }
    : null);
  const [correctedExperience, setCorrectedExperience] = useState<string | null>(null);
  const experienceLevelBase = experienceLevelProp || { level: "mid" as const, yearsEstimate: "3-5 years" };
  const experienceLevel = correctedExperience
    ? { ...experienceLevelBase, level: correctedExperience as typeof experienceLevelBase.level }
    : experienceLevelBase;

  const confirmExperience = async (level: string) => {
    if (level === experienceLevelBase.level) { setCorrectedExperience(null); return; }
    setCorrectedExperience(level);
    onContextConfirm?.({ confirmedExperience: level });
    try {
      await supabase.rpc('log_seniority_correction' as never, {
        p_detected_level: experienceLevelBase.level,
        p_corrected_level: level,
        p_detected_years: experienceLevelBase.yearsEstimate ?? null,
        p_industry: effectiveIndustry,
        p_resume_text_length: resumeText?.length ?? null,
        p_visitor_id: localStorage.getItem('ab_visitor_id') || null,
      } as never);
    } catch { /* non-blocking */ }
  };

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
  // Not derivable client-side — null hides the tile rather than fabricating.
  const actionVerbGrade = actionVerbGradeProp || null;
  const readabilityScore = readabilityScoreProp || null;
  const bulletImpactScore =
    bulletImpactScoreProp ||
    computedBulletImpactScore ||
    ({ score: 0, verdict: "balanced" as const, tip: "Bullet impact could not be detected from this text." } satisfies BulletImpactScore);
  const keywordDensity = keywordDensityProp || null;
  const improvementPotential = improvementPotentialProp || null;
  const redFlags = redFlagsProp || [];
  const topSkipReasons = topSkipReasonsProp || [];
  const powerWords = powerWordsProp || [];
  const weakPhrases = weakPhrasesProp || [];
  const timelineAnalysis = timelineAnalysisProp || { avgTenure: "2 years", progression: "steady" as const, hasGaps: false, totalYears: computedTotalYears ?? "—" };
  const industryBenchmark = industryBenchmarkProp || { industryAvg: 72, comparison: "at" as const, percentile: "Top 50%" };
  const quickWins = quickWinsProp || [];
  const sampleRewrite = sampleRewriteProp;
  // No fallback, deliberately: the old hardcoded default showed every user
  // the same invented per-vendor scores. Absent data now hides the section.
  const atsSystemCompatibility = atsSystemCompatibilityProp
    ? { ...atsSystemCompatibilityProp, overallRating: atsSystemCompatibilityProp.overallRating?.toLowerCase?.() ?? "fair" }
    : null;

  const getScoreColor = (score: number) => {
    if (score >= 70) return "text-success";
    if (score >= 50) return "text-warning";
    return "text-destructive";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return "bg-success/10 border-success/20";
    if (score >= 50) return "bg-warning/10 border-warning/20";
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
    if (level === "entry") return t('scoreHero.experienceLevel.entry');
    if (level === "mid") return t('scoreHero.experienceLevel.mid');
    if (level === "senior") return t('scoreHero.experienceLevel.senior');
    return t('scoreHero.experienceLevel.executive');
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

  const sectionsPresent = useMemo(
    () => [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills].filter(Boolean).length,
    [sectionCheck.hasContact, sectionCheck.hasSummary, sectionCheck.hasExperience, sectionCheck.hasEducation, sectionCheck.hasSkills]
  );

  const getSectionScore = () => `${sectionsPresent}/5`;

  const getSectionColor = () => {
    if (sectionsPresent === 5) return "text-success";
    if (sectionsPresent >= 3) return "text-warning";
    return "text-destructive";
  };

  const getSectionBgColor = () => {
    if (sectionsPresent === 5) return "bg-success/10 border-success/20";
    if (sectionsPresent >= 3) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const contactItemsPresent = useMemo(
    () => [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn].filter(Boolean).length,
    [contactInfo.hasEmail, contactInfo.hasPhone, contactInfo.hasLinkedIn]
  );

  const getContactScore = () => `${contactItemsPresent}/3`;

  const getContactColor = () => {
    if (contactItemsPresent === 3) return "text-success";
    if (contactItemsPresent >= 2) return "text-warning";
    return "text-destructive";
  };

  const getContactBgColor = () => {
    if (contactItemsPresent === 3) return "bg-success/10 border-success/20";
    if (contactItemsPresent >= 2) return "bg-warning/10 border-warning/20";
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

    if (!emailSchema.safeParse(email).success) {
      toast({
        title: t('freeResults.toast.invalidEmail'),
        description: t('freeResults.toast.invalidEmailDescription'),
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
              title: t('freeResults.toast.couldntSaveEmail'),
              description: parsed.error || t('freeResults.toast.tryAgain'),
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
          title: t('freeResults.toast.couldntSaveEmail'),
          description: data.error,
          variant: "destructive",
        });
        return;
      }

      setIsSubscribed(true);
      // Also save email to scan history for returning user tracking
      setUserEmail(email);
      toast({
        title: t('freeResults.toast.onTheList'),
        description: t('freeResults.toast.onTheListDescription'),
      });
    } catch (error: unknown) {
      console.error("Email capture error:", error);
      toast({
        title: t('freeResults.toast.somethingWrong'),
        description: t('freeResults.toast.tryAgain'),
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
      { id: "section-overview", label: t('freeResults.nav.overview'), icon: "📊" },
      { id: "section-metrics", label: t('freeResults.nav.metrics'), icon: "📈" },
      { id: "section-issues", label: t('freeResults.nav.issues'), icon: "⚠️" },
    ];
    if (jobMatchScore !== undefined) {
      sections.push({ id: "section-job-match", label: t('freeResults.nav.jobMatch'), icon: "🎯" });
    }
    sections.push(
      { id: "section-insights", label: t('freeResults.nav.insights'), icon: "💡" },
      { id: "section-upgrade", label: t('freeResults.nav.nextSteps'), icon: "🚀" },
    );
    return sections;
  }, [jobMatchScore, t]);

  // Findings index — one deterministic severity roll-up across every check
  // the report runs. Derived entirely from data already on screen.
  const findings: Finding[] = (() => {
    const out: Finding[] = [];
    if (parseQuality?.verdict === 'poor') out.push({ severity: 'critical', label: 'Resume text may not have extracted correctly — scores below could be unreliable' });
    else if (parseQuality?.verdict === 'fair') out.push({ severity: 'warning', label: 'Extraction quality is imperfect — verify the parse preview below' });
    for (const flag of (redFlags || []).slice(0, 3)) {
      const sev = (flag as { severity?: string }).severity === 'critical' ? 'critical' : 'warning';
      const title = (flag as { title?: string; flag?: string }).title || (flag as { flag?: string }).flag;
      if (title) out.push({ severity: sev, label: title });
    }
    if (!contactInfo.hasEmail) out.push({ severity: 'critical', label: 'No email address detected — screeners cannot contact you' });
    if (!contactInfo.hasPhone) out.push({ severity: 'warning', label: 'No phone number detected' });
    for (const item of industrySpecificChecks?.items || []) {
      out.push(item.present ? { severity: 'pass', label: item.label } : { severity: 'warning', label: `${item.label}: missing — see field-specific checks` });
    }
    if (resumeText) {
      for (const v of computeVendorChecks({ resumeText, multiColumnDetected })) {
        out.push(v.status === 'fail' ? { severity: 'critical', label: `${v.vendor} parsing: likely failure` } : v.status === 'warn' ? { severity: 'warning', label: `${v.vendor} parsing: needs review` } : { severity: 'pass', label: `${v.vendor} parsing` });
      }
    }
    if ((weakestBullets?.length ?? 0) > 0) out.push({ severity: 'warning', label: `${weakestBullets!.length} bullet${weakestBullets!.length === 1 ? '' : 's'} graded D or below — rewrites provided` });
    if (typeof quantificationScore === 'number' && quantificationScore < 40) out.push({ severity: 'warning', label: 'Under 40% of bullets carry a number — recruiters anchor on metrics' });
    else if (typeof quantificationScore === 'number' && quantificationScore >= 60) out.push({ severity: 'pass', label: 'Quantified impact' });
    if (sectionCheck.hasExperience && sectionCheck.hasEducation && sectionCheck.hasSkills) out.push({ severity: 'pass', label: 'Core sections present' });
    return out;
  })();

  // One payload for BOTH email-capture placements (compact at the verdict,
  // full at the end of the report) — identical email either way.
  const emailReportPayload = {
    verdict: reportVerdict,
    score: atsScoreEstimate,
    projectedScore: projectedScore ?? null,
    scoreBreakdown: scoreBreakdown ?? null,
    peerPercentile: peerPercentile ?? null,
    applicationPassRate: applicationPassRate ?? null,
    redFlags: redFlags.map(f => ({ issue: f.issue })),
    fixRoadmap: fixRoadmap ?? null,
    industry: effectiveIndustry,
    reportId: reportMeta?.reportId ?? null,
    scoreBand: scoreBand ?? null,
    findingsSummary: {
      critical: findings.filter(f => f.severity === 'critical').length,
      warnings: findings.filter(f => f.severity === 'warning').length,
      passed: findings.filter(f => f.severity === 'pass').length,
    },
    keywordSource: keywordSource ?? null,
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div className="w-full max-w-3xl mx-auto animate-fade-in">
      {showExitOffer && !diagnosticLayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 animate-slide-up">
            <button
              onClick={() => setShowExitOffer(false)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-lg font-bold mb-1">{t('freeResults.exitOffer.title')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {realKeywordGapStats && realKeywordGapStats.totalMissing > 0
                ? t('freeResults.exitOffer.withStats', { count: realKeywordGapStats.totalMissing, industry: effectiveIndustry.replace(/_/g, ' ') })
                : t('freeResults.exitOffer.noStats')}
            </p>
            <KeywordFixButton variant="benefit_focused" section="exit_intent" />
          </div>
        </div>
      )}

      {/* ── Verdict-first hero — one sentence the whole report is evidence for ── */}
      {reportVerdict && (
        <div className="rounded-2xl border-2 border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5 p-5 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1.5">{t('freeResults.enterprise.verdictLabel', 'The Verdict')}</p>
          <p className="text-base md:text-lg font-semibold text-foreground leading-snug">{reportVerdict}</p>
          {/* Lead with the thing a chatbot can't say: placement in a REAL
              distribution. Quartile language only — exact percentiles aren't
              derivable from the published quartiles, so we don't invent them. */}
          {realBenchmark && realBenchmark.n >= 20 && (
            <p className="text-sm font-semibold text-primary mt-1.5">
              {t(
                atsScoreEstimate >= realBenchmark.p75 ? 'freeResults.enterprise.placementTopQuartile'
                : atsScoreEstimate >= realBenchmark.median ? 'freeResults.enterprise.placementAboveMedian'
                : atsScoreEstimate >= realBenchmark.p25 ? 'freeResults.enterprise.placementBelowMedian'
                : 'freeResults.enterprise.placementBottomQuartile',
                { n: realBenchmark.n.toLocaleString(), industry: realBenchmark.industry.replace(/_/g, ' ') },
              )}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
            <p className="text-xs text-muted-foreground">{t('freeResults.enterprise.verdictEvidence', 'Everything below is the evidence — and the fix.')}</p>
            <button
              onClick={async () => {
                const { default: JsPDF } = await import('jspdf');
                const doc = new JsPDF({ unit: 'pt', format: 'a4' });
                const W = doc.internal.pageSize.getWidth();
                const margin = 48;
                let y = 56;
                const line = (text: string, size = 10, bold = false, color: [number, number, number] = [40, 40, 40]) => {
                  doc.setFontSize(size);
                  doc.setFont('helvetica', bold ? 'bold' : 'normal');
                  doc.setTextColor(...color);
                  const wrapped = doc.splitTextToSize(text, W - margin * 2);
                  doc.text(wrapped, margin, y);
                  y += wrapped.length * (size * 1.35) + 4;
                };
                // Diagnostic anatomy — same specimen header, findings
                // triage, band, and provenance as the on-screen report.
                line('RESUME DIAGNOSTIC REPORT', 15, true, [30, 30, 30]);
                if (reportMeta) {
                  line(`Report #${reportMeta.reportId}  ·  ${new Date(reportMeta.generatedAt).toLocaleDateString()}  ·  Engine ${reportMeta.engineVersion}`, 8.5, false, [120, 120, 120]);
                  line(`Subject: ${candidateName || 'Candidate'}  ·  Industry: ${reportMeta.industry.replace(/_/g, ' ')} (${reportMeta.industryConfidence} confidence)  ·  Benchmarks: ${reportMeta.benchmarkSource === 'measured' ? 'measured from real scans' : 'industry estimates'}`, 8.5, false, [120, 120, 120]);
                } else {
                  line(new Date().toLocaleDateString(), 9, false, [120, 120, 120]);
                }
                y += 8;
                line(reportVerdict, 11, true);
                y += 4;
                line(`ATS Score: ${atsScoreEstimate}/100${scoreBand ? `  (modeling band ${scoreBand.low}–${scoreBand.high})` : ''}${projectedScore ? `  →  ${projectedScore} after fixes` : ''}`, 12, true);
                if (scoreBreakdown) line(`Breakdown — Keywords: ${scoreBreakdown.keywords}%  ·  Format: ${scoreBreakdown.format}%  ·  Quantification: ${scoreBreakdown.quantification}%`, 10);
                if (peerPercentile != null) line(`Peer percentile: ${peerPercentile} of 100 ${industry.replace(/_/g, ' ')} candidates  ·  Est. ATS pass rate: ${applicationPassRate ?? '—'}%`, 10);
                y += 6;
                {
                  const crit = findings.filter(f => f.severity === 'critical');
                  const warn = findings.filter(f => f.severity === 'warning');
                  const passN = findings.filter(f => f.severity === 'pass').length;
                  line(`Findings: ${crit.length} critical  ·  ${warn.length} warnings  ·  ${passN} passed`, 11, true);
                  [...crit, ...warn].slice(0, 6).forEach(f => line(`${f.severity === 'critical' ? '✗' : '!'}  ${f.label}`, 9.5, false, f.severity === 'critical' ? [180, 40, 40] : [160, 110, 20]));
                  y += 4;
                }
                if (fixRoadmap && fixRoadmap.steps.length > 0) {
                  line(`Your ${fixRoadmap.totalMinutes}-minute fix plan:`, 11, true);
                  fixRoadmap.steps.forEach(s => line(`${s.order}. ${s.step} (~${s.minutes} min, +${s.scoreImpact} pts)`, 10));
                  y += 4;
                }
                if (keywordSource?.source === 'onet') line(`Keyword expectations sourced from O*NET ${keywordSource.code} (U.S. Department of Labor — ${keywordSource.occupation}).`, 8.5, false, [120, 120, 120]);
                if (keywordSource?.source === 'job_description') line('Keyword analysis matched against the job posting you provided.', 8.5, false, [120, 120, 120]);
                line('Every quoted line in the full report is verified against your resume. Full detail: resumebooster.work', 8.5, false, [120, 120, 120]);
                doc.save(`resume-diagnostic-${reportMeta?.reportId ?? 'report'}.pdf`);
                trackButtonClick('download_pdf_summary', 'verdict_hero');
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors"
            >
              <FileText className="w-3 h-3" />
              {t('freeResults.enterprise.downloadPdf', 'Download PDF summary')}
            </button>
          </div>
        </div>
      )}

      {/* Email capture at peak attention — compact, optional, hidden for
          visitors whose email we already have. The full variant (with the
          pulse/drip opt-ins) stays at the end of the report. */}
      <EmailReportCapture payload={emailReportPayload} variant="compact" hideIfKnown />

      {/* Specimen header — report ID, engine, provenance */}
      {reportMeta && <DiagnosticHeader meta={reportMeta} candidateName={candidateName} />}

      {/* Honest routing: a platform profile isn't a resume, and scoring it as
          one misleads. Say so at the very top and point at the right tool. */}
      {platformProfileDetected && (
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 mb-6">
          <p className="text-sm font-semibold text-foreground mb-0.5">This looks like a freelance platform profile, not a resume</p>
          <p className="text-xs text-muted-foreground mb-3">
            We detected {platformProfileDetected.signals.slice(0, 3).join(", ")} — the markers of a profile export.
            The score below treats this as a resume, which understates you: recruiters need your projects translated
            into employer language, not platform stats. That's exactly what Freelance Boost does.
          </p>
          <Link to="/freelance-boost" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
            Turn this profile into resume experience →
          </Link>
        </div>
      )}

      {/* The fix→verify payoff: when this person scanned before, lead with
          what changed. Same-candidate guard keeps household/multi-resume
          usage from producing nonsense deltas. */}
      {(() => {
        const prev = getPreviousScan();
        if (!hasRecordedScan || !prev) return null;
        const sameCandidate = (prev.candidateName ?? null) === (candidateName ?? null);
        if (!sameCandidate) return null;
        const delta = atsScoreEstimate - prev.atsScore;
        const prevFlags = prev.redFlagCount ?? null;
        const flagsNow = redFlagsProp?.length ?? null;
        return (
          <div className={`rounded-2xl border p-4 mb-6 ${delta > 0 ? "border-success/40 bg-success/5" : delta < 0 ? "border-warning/40 bg-warning/5" : "border-border bg-card/60"}`}>
            <p className="text-sm font-semibold text-foreground">
              Since your last scan: {prev.atsScore} → {atsScoreEstimate}
              {delta !== 0 && (
                <span className={delta > 0 ? "text-success" : "text-warning"}> ({delta > 0 ? "+" : ""}{delta})</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {prevFlags != null && flagsNow != null && prevFlags !== flagsNow
                ? `Red flags ${prevFlags} → ${flagsNow}. `
                : ""}
              {delta > 0
                ? "The fixes registered — this is the measured improvement, same rubric both times."
                : delta < 0
                  ? "Lower than last time — usually a different target or trimmed content. The findings below explain each point."
                  : "No score change — the findings below show what would move it."}
            </p>
          </div>
        );
      })()}

      {/* ── Detection confirmation strip — confirmed labels are 100% accurate ── */}
      {industryNeedsConfirmation && !correctedIndustry && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 mb-2 text-xs text-foreground">
          <span className="font-semibold">Quick check:</span> we weren't fully sure of your industry on this one
          {industryTransition ? (
            <> — your history reads as <span className="font-semibold capitalize">{industryTransition.historical.replace(/_/g, ' ')}</span> but your latest role reads as <span className="font-semibold capitalize">{industryTransition.recent.replace(/_/g, ' ')}</span>. Confirm below and the whole report recalibrates.</>
          ) : (
            <>. Confirm or correct it below — benchmarks and keywords sharpen instantly.</>
          )}
        </div>
      )}
      <div className={`rounded-xl border px-4 py-2.5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs ${industryNeedsConfirmation && !correctedIndustry ? 'border-warning/50 bg-warning/5 ring-1 ring-warning/30' : 'border-border/60 bg-card/60'}`}>
        <span className="text-muted-foreground">We read this as:</span>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Industry</span>
          <select
            value={effectiveIndustry}
            onChange={(e) => { handleIndustryChange(e.target.value); onContextConfirm?.({ confirmedIndustry: e.target.value }); }}
            className="bg-transparent border border-border/60 rounded-md px-1.5 py-0.5 text-foreground font-medium capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40"
            aria-label="Confirm or correct detected industry"
          >
            {getAvailableIndustries().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Level</span>
          <select
            value={experienceLevel.level}
            onChange={(e) => confirmExperience(e.target.value)}
            className="bg-transparent border border-border/60 rounded-md px-1.5 py-0.5 text-foreground font-medium capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40"
            aria-label="Confirm or correct detected experience level"
          >
            <option value="entry">Entry</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="executive">Executive</option>
          </select>
        </label>
        {experienceLevel.yearsEstimate && <span className="text-muted-foreground">~{experienceLevel.yearsEstimate}</span>}
        <span className="text-muted-foreground/60 ml-auto hidden sm:inline">Corrections retrain our detection</span>
      </div>

      {/* ── Intent-adaptive spotlight — the report leads with what THEY came for ── */}
      {scanSituation && (() => {
        const spotlight = ({
          actively_applying: {
            title: "🎯 You're actively applying — here's your fastest path",
            body: fixRoadmap && fixRoadmap.steps.length > 0
              ? `Your ${fixRoadmap.totalMinutes}-minute fix plan below takes this resume from ${atsScoreEstimate} to ~${fixRoadmap.finalProjectedScore}. Do it before your next application, then check the interview questions your resume will trigger.`
              : "Start with the fix plan and the interview questions your resume will trigger — both below.",
          },
          exploring: {
            title: "🧭 You're exploring — here's where you stand",
            body: peerPercentile != null
              ? `You're at the ${peerPercentile}th percentile for ${effectiveIndustry.replace(/_/g, " ")} candidates. The market intelligence and career trajectory sections below show what's rising in your field and where your profile points next.`
              : "The market intelligence and career trajectory sections below show what's rising in your field and where your profile points next.",
          },
          career_change: {
            title: "🔄 You're changing careers — framing is everything",
            body: dualIndustryComparison
              ? `Your resume reads two ways — see the side-by-side comparison below to pick your stronger lane, then use the transition advice to reframe your transferable experience.`
              : "The career-situation advice below focuses on reframing your transferable experience for the new field.",
          },
          first_job: {
            title: "🌱 First job — your projects ARE your experience",
            body: "Advice below is calibrated for entry level: elevating projects and internships, and the exact keywords entry screeners look for. Nobody expects P&L ownership — ignore any tool that does.",
          },
          freelance: {
            title: "💼 Freelancing — package the portfolio like a career",
            body: "Independent work confuses ATS parsers and skeptical recruiters. The freelance guidance below shows how to position your client work as one coherent track and turn projects into experience bullets with real scope.",
          },
        } as Record<string, { title: string; body: string }>)[scanSituation];
        if (!spotlight) return null;
        return (
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 mb-4">
            <p className="text-sm font-semibold text-foreground mb-1">{tone(spotlight.title)}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{spotlight.body}</p>
          </div>
        );
      })()}

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
        projectedScore={projectedScore ?? undefined}
      />

      {/* Resume Builder CTA */}
      {resumeText && (
        <Link
          to="/builder"
          className="flex items-center justify-between gap-3 mb-4 p-4 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary/10 shrink-0">
              <FileEdit className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm">{t('freeResults.resumeBuilderCta.title')}</p>
              <p className="text-xs text-muted-foreground">{t('freeResults.resumeBuilderCta.subtitle')}</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}

      {/* Mechanical ATS Parse Simulation — distinct from the AI judgment below */}
      {resumeText && (
        <div className="mb-4">
          <ATSParseSimulator resumeText={resumeText} multiColumnDetected={multiColumnDetected} isActualExtraction={sourceWasFile} />
        </div>
      )}

      {/* Field-specific screener checks (portfolio, clearance, license, publications) */}
      {industrySpecificChecks && (
        <div className="mb-4">
          <IndustryChecksCard checks={industrySpecificChecks} />
        </div>
      )}

      {/* Country-specific resume standards for the scanner's geo-resolved
          market (photo norms, personal-data rules, local boilerplate) */}
      {countryStandards && (
        <div className="mb-4">
          <CountryStandardsCard data={countryStandards} />
        </div>
      )}

      {/* Vendor-specific parse behavior (Workday/Greenhouse/Lever/iCIMS) */}
      {resumeText && (
        <div className="mb-4">
          <AtsVendorChecksCard resumeText={resumeText} multiColumnDetected={multiColumnDetected} />
        </div>
      )}

      {/* Section Navigation */}
      <SectionNav sections={navSections} className="mb-4" />

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Overview */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-overview">

      {/* Findings index — severity roll-up of every check */}
      <FindingsIndex findings={findings} />

      {/* Score band — no real screening process resolves to one integer */}
      {scoreBand && (
        <p className="text-[11px] text-muted-foreground -mt-2 mb-4 px-1">
          Score {atsScoreEstimate} sits in a modeling band of {scoreBand.low}–{scoreBand.high}. The band spans our deterministic
          calculation and the AI estimate — single-point precision would be false confidence.
        </p>
      )}

      {/* Keyword expectation provenance */}
      {keywordSource?.source === 'onet' && (
        <p className="text-[11px] text-muted-foreground mb-3 px-1">
          Keyword expectations for this scan are sourced from <span className="font-medium text-foreground">O*NET {keywordSource.code}</span> —
          the U.S. Department of Labor's occupational database entry for <span className="font-medium text-foreground capitalize">{keywordSource.occupation}</span> — not just our own model.
        </p>
      )}
      {keywordSource?.source === 'job_description' && (
        <p className="text-[11px] text-muted-foreground mb-3 px-1">
          Keyword analysis on this scan is <span className="font-medium text-foreground">exact</span> — matched against the job posting you provided, and every suggestion is verified to appear in it.
        </p>
      )}

      {/* Realism nudge: modeled vs exact expectations */}
      {!hadJobDescription && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 mb-4 flex flex-col sm:flex-row sm:items-center gap-2.5">
          <p className="text-xs text-muted-foreground flex-1">
            <span className="font-semibold text-foreground">This scan modeled expectations for {effectiveIndustry.replace(/_/g, ' ')} generally.</span>{' '}
            Paste a real job posting and the keyword analysis becomes exact — matched against what that employer actually asked for, not an industry model.
          </p>
          <button
            onClick={() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="shrink-0 text-xs font-semibold text-primary hover:underline text-left"
          >
            Add a job posting →
          </button>
        </div>
      )}

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

      {/* Why this score — deterministic audit trail */}
      {scoreAudit && (
        <div className="mt-4">
          <ScoreAuditCard audit={scoreAudit} />
        </div>
      )}

      {/* Real-corpus benchmark badge — only shown when the comparison data
          is our own observed distribution, not an estimate */}
      {realBenchmark && (
        <div className="mt-3 rounded-xl border border-success/25 bg-success/5 p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Real benchmark:</span> comparisons in this report are measured against{' '}
            <span className="font-semibold text-foreground">{realBenchmark.n.toLocaleString()} actual {realBenchmark.industry.replace(/_/g, ' ')} resumes</span>{' '}
            scanned here in the last 6 months (median {Math.round(realBenchmark.median)}, middle half {Math.round(realBenchmark.p25)}–{Math.round(realBenchmark.p75)}) — not industry estimates.
          </p>
        </div>
      )}

      {/* JD-industry arbitration note */}
      {benchmarkIndustry && (
        <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Heads up:</span> your job description is in{' '}
            <span className="font-semibold text-foreground">{benchmarkIndustry.replace(/_/g, ' ')}</span> while your resume reads as{' '}
            <span className="font-semibold text-foreground">{effectiveIndustry.replace(/_/g, ' ')}</span> — so benchmarks and keyword expectations below are calibrated to where you're <em>going</em>, not where you've been.
          </p>
        </div>
      )}

      {/* Career-change bridge — transferable skills map */}
      {careerChangeBridge && (
        <div className="mt-4">
          <CareerBridgeCard bridge={careerChangeBridge} />
        </div>
      )}

      {/* Freelance / project-career guidance */}
      {freelanceGuidance && (
        <div className="mt-4">
          <FreelanceGuidanceCard guidance={freelanceGuidance} />
        </div>
      )}

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

      {/* ── DETECTION CONFIDENCE WARNING (improvement #7) ── */}
      {detectionQualityScore !== undefined && detectionQualityScore < 45 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground mb-0.5">Industry auto-detected — does this look right?</p>
            <p className="text-xs text-muted-foreground">
              We detected <span className="font-medium text-foreground">{effectiveIndustry.replace(/_/g, ' ')}</span> based on limited signals. If that's wrong, use the industry selector above — it changes every recommendation below.
            </p>
          </div>
        </div>
      )}

      {/* ── Specialization, hybrid blend & target-industry context ── */}
      {(subIndustry || industryBlend || jdTargetIndustry) && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-5 space-y-2">
          {subIndustry && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-semibold">
                Specialization: {subIndustry.label}
              </span>
              {subIndustry.matchedSignals?.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  Detected from: {subIndustry.matchedSignals.slice(0, 3).join(', ')}
                </span>
              )}
            </div>
          )}
          {industryBlend && (
            <p className="text-xs text-foreground/80">
              {candidateName ? `${candidateName.split(' ')[0]}, your` : 'Your'} resume reads as{' '}
              <span className="font-semibold text-foreground">{industryBlend.primaryPct}% {industryBlend.primary.replace(/_/g, ' ')}</span>
              {' / '}
              <span className="font-semibold text-foreground">{industryBlend.secondaryPct}% {industryBlend.secondary.replace(/_/g, ' ')}</span>
              {' '}— recruiters in both fields will consider you, and the advice below covers both.
            </p>
          )}
          {jdTargetIndustry && (
            <p className="text-xs text-foreground/80">
              The job you're targeting sits in <span className="font-semibold text-foreground">{jdTargetIndustry.replace(/_/g, ' ')}</span> — gaps below are framed as a transition into that field.
            </p>
          )}
        </div>
      )}

      {/* ── Dual-industry comparison — uncertainty turned into extra depth ── */}
      {dualIndustryComparison && (
        <div className="rounded-2xl border border-border bg-card p-5 mb-5">
          <h4 className="font-semibold text-foreground text-sm mb-1">Your Resume, Read Two Ways</h4>
          <p className="text-xs text-muted-foreground mb-3">
            Your background fits two fields — here's how you score in each, so you can target the stronger one.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {([dualIndustryComparison.primary, dualIndustryComparison.secondary]).map((side, i) => (
              <div key={i} className={cn("rounded-xl border p-3", side.score >= (i === 0 ? dualIndustryComparison.secondary : dualIndustryComparison.primary).score ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20")}>
                <p className="text-xs font-semibold text-foreground capitalize mb-1">As a {side.industry.replace(/_/g, ' ')} candidate</p>
                <p className="text-2xl font-bold text-foreground">{side.score}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Keyword coverage: {side.keywordCoveragePct}% · Industry median: {side.benchmarkMedian}
                </p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Methodology: the alternative score shifts your real score by the keyword-coverage difference between the two fields.
          </p>
        </div>
      )}

      {/* Returning User Insights - shown for users who have scanned before */}
      <ReturningUserInsights
        currentScore={atsScoreEstimate}
        currentIndustry={effectiveIndustry}
      />

      {/* Industry & Role Keyword Suggestions */}
      <CollapsibleSection
        id="keywords-suggestions"
        title={t('freeResults.industryKeywordsSection.title')}
        subtitle={t('freeResults.industryKeywordsSection.subtitle')}
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

      {/* Compact Action CTA — interleaved urgency; hidden in the diagnostic layout */}
      {!diagnosticLayout && (
      <div className="rounded-xl bg-gradient-to-r from-destructive/10 to-destructive/5 border border-destructive/20 p-4 mb-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {redFlags.length > 0
                ? t('freeResults.actionBanner.issuesFound', { count: redFlags.length })
                : t(atsScoreEstimate < 70 ? 'freeResults.actionBanner.criticalImprovements' : 'freeResults.actionBanner.keyImprovements')
              }
            </p>
            <p className="text-xs text-muted-foreground">
              {currentRole
                ? t('freeResults.actionBanner.withRole', { industry: effectiveIndustry.replace(/_/g, ' '), role: currentRole })
                : t('freeResults.actionBanner.withoutRole')
              }
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
            <Button
              onClick={() => handleUpgradeClick('action_required_banner')}
              disabled={isLoading}
              size="sm"
              className="gap-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {getFirstCtaText()}
            </Button>
            <span className="text-[10px] text-muted-foreground">{t('freeResults.cta.resultsExpiry', { hours: 48 })}</span>
          </div>
        </div>
      </div>
      )}

      {/* Job Match Section - Show when job description was provided */}
      {jobMatchScore !== undefined && jobMatchGrade && (
        <div id="section-job-match" className="rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-success/10 border-2 border-primary/30 p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-primary/20">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-lg">{t('freeResults.jobMatch.title')}</h4>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success font-medium">{t('freeResults.jobMatch.badge')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('freeResults.jobMatch.subtitle')}</p>
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
                    {applicationRecommendation.recommendation === "strong_apply" ? t('freeResults.appRecommendation.strongApply') :
                     applicationRecommendation.recommendation === "apply_with_changes" ? t('freeResults.appRecommendation.applyWithChanges') :
                     applicationRecommendation.recommendation === "apply_as_stretch" ? t('freeResults.appRecommendation.applyAsStretch') :
                     t('freeResults.appRecommendation.doNotApply')}
                  </p>
                  <p className="text-sm text-muted-foreground">{applicationRecommendation.reasoning}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{t('freeResults.jobMatch.confidence')}</span>
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
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.jobMatch.matchScore')}</p>
              <p className={cn("text-2xl font-bold", getScoreColor(jobMatchScore))}>
                {jobMatchScore}<span className="text-sm text-muted-foreground">%</span>
              </p>
            </div>

            {/* Match Grade */}
            <div className={cn("rounded-xl border p-3", getGradeBgColor(jobMatchGrade))}>
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.jobMatch.matchGrade')}</p>
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
                <p className="text-xs text-muted-foreground mb-1">{t('freeResults.jobMatch.experienceFit')}</p>
                <p className={cn("text-lg font-bold capitalize", 
                  experienceFit === "good_fit" ? "text-success" : "text-warning"
                )}>
                  {experienceFit === "good_fit" ? t('freeResults.experienceFit.goodFit') : experienceFit === "overqualified" ? t('freeResults.experienceFit.over') : t('freeResults.experienceFit.under')}
                </p>
              </div>
            )}

            {/* Title Alignment */}
            {titleAlignment && (
              <div className={cn("rounded-xl border p-3", 
                titleAlignment === "strong" ? "bg-success/10 border-success/20" : 
                titleAlignment === "partial" ? "bg-warning/10 border-warning/20" : "bg-destructive/10 border-destructive/20"
              )}>
                <p className="text-xs text-muted-foreground mb-1">{t('freeResults.jobMatch.titleMatch')}</p>
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
                {t('freeResults.jobMatch.howYouCompare')}
              </h5>
              <div className="flex items-center gap-3 mb-3">
                <div className={cn(
                  "px-3 py-1.5 rounded-lg font-semibold text-sm",
                  competitiveAssessment.likelyPosition === "top_candidate" ? "bg-success/20 text-success" :
                  competitiveAssessment.likelyPosition === "competitive" ? "bg-primary/20 text-primary" :
                  competitiveAssessment.likelyPosition === "middle_of_pack" ? "bg-warning/20 text-warning" :
                  "bg-destructive/20 text-destructive"
                )}>
                  {competitiveAssessment.likelyPosition === "top_candidate" ? t('freeResults.competitivePosition.top') :
                   competitiveAssessment.likelyPosition === "competitive" ? t('freeResults.competitivePosition.competitive') :
                   competitiveAssessment.likelyPosition === "middle_of_pack" ? t('freeResults.competitivePosition.middle') :
                   t('freeResults.competitivePosition.unlikely')}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-xs text-success font-medium mb-1">{t('freeResults.competitivePosition.yourAdvantage')}</p>
                  <p className="text-sm text-foreground">{competitiveAssessment.strengthVsField}</p>
                </div>
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-destructive font-medium mb-1">{t('freeResults.competitivePosition.yourGap')}</p>
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
                  <p className="text-sm font-medium text-success">{t('freeResults.jobMatch.skillsYouHave')}</p>
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
                  <p className="text-sm font-medium text-destructive">{t('freeResults.jobMatch.skillsToAdd')}</p>
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
                {t('freeResults.jobMatch.whatYouNeedToDo')}
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
                      {action.priority === "must_have" ? t('freeResults.priority.must') : action.priority === "should_have" ? t('freeResults.priority.should') : t('freeResults.priority.nice')}
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
                <span className="font-medium text-foreground">{t('freeResults.jobMatch.summary')}</span> {jobMatchSummary}
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
                  <h5 className="font-bold text-foreground">{t('freeResults.jobMatch.readyToApply.title')}</h5>
                  <p className="text-xs text-muted-foreground">{t('freeResults.jobMatch.readyToApply.subtitle')}</p>
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
                    {t('freeResults.jobMatch.readyToApply.generating')}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {t('freeResults.jobMatch.readyToApply.button')}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
              <p className="text-[10px] text-success/70 mt-2 text-center">
                {t('freeResults.jobMatch.readyToApply.footnote')}
              </p>
            </div>
          )}

          {/* Apply Assistant upsell — full tailored package, not just suggestions */}
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 border-2 border-primary/30">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-full bg-primary/20">
                <Send className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h5 className="font-bold text-foreground">{t('freeResults.jobMatch.completePackage.title')}</h5>
                <p className="text-xs text-muted-foreground">
                  {t('freeResults.jobMatch.completePackage.subtitle')}
                </p>
              </div>
            </div>
            <ApplyAssistantButton hasJobDescription={!!jobDescriptionText} section="job_match_apply_assistant" />
          </div>
        </div>
      )}
      
      {/* Deep Job Keyword Matching Analysis */}
      {resumeText && jobDescriptionText && (
        <div className="mb-6">
          <JobKeywordMatcher
            jobTitle={jobTitle}
            jobCompany={jobCompany}
            matchingSkills={matchingSkills}
            missingSkillsDetailed={missingSkillsDetailed}
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
                  {atsScoreEstimate < 60 ? t('freeResults.atRiskOrNeedsImprovement.atRisk') : t('freeResults.atRiskOrNeedsImprovement.needsImprovement')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {atsScoreEstimate < 60 ? t('freeResults.atsBanner.require60') : t('freeResults.atsBanner.require75')}
                </p>
              </div>
            </div>
            <span className="text-lg font-bold text-success shrink-0">{t('freeResults.atsBanner.targetScore')}</span>
          </div>
        </div>
      )}

      {/* Personalized Insights */}
      <CollapsibleSection
        id="personalized-tips"
        title={t('freeResults.personalizedTipsSection.title')}
        subtitle={t('freeResults.personalizedTipsSection.subtitle')}
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

      {/* Elevator Pitch Generator */}
      {resumeText && (
        <CollapsibleSection
          id="elevator-pitch"
          title={t('freeResults.elevatorPitchSection.title')}
          subtitle={t('freeResults.elevatorPitchSection.subtitle')}
          icon={<Rocket className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('uploader.badges.free')}
            </span>
          }
        >
          <ElevatorPitchGenerator
            resumeText={resumeText}
            industry={industry}
            currentRole={currentRole}
            experienceLevel={experienceLevel?.level}
            candidateName={candidateName || undefined}
          />
        </CollapsibleSection>
      )}

      {/* Recruiter View Mode */}
      {resumeText && (
        <CollapsibleSection
          id="recruiter-view"
          title={t('freeResults.recruiterViewSection.title')}
          subtitle={t('freeResults.recruiterViewSection.subtitle')}
          icon={<Eye className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('uploader.badges.free')}
            </span>
          }
        >
          <RecruiterViewMode
            resumeText={resumeText}
            industry={industry}
            currentRole={currentRole}
          />
        </CollapsibleSection>
      )}

      {/* Resume Roast */}
      {resumeText && (
        <CollapsibleSection
          id="resume-roast"
          title={t('freeResults.resumeRoastSection.title')}
          subtitle={t('freeResults.resumeRoastSection.subtitle')}
          icon={<Flame className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
              {t('uploader.badges.free')}
            </span>
          }
        >
          <ResumeRoast
            resumeText={resumeText}
            industry={industry}
            currentRole={currentRole}
          />
        </CollapsibleSection>
      )}

      {/* Interview Coach */}
      {resumeText && (
        <CollapsibleSection
          id="interview-coach"
          title={t('freeResults.interviewCoachSection.title')}
          subtitle={t('freeResults.interviewCoachSection.subtitle')}
          icon={<MessageSquare className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('uploader.badges.free')}
            </span>
          }
        >
          <InterviewCoach
            resumeText={resumeText}
            industry={industry}
            currentRole={currentRole}
          />
        </CollapsibleSection>
      )}

      {/* Career Path Simulator */}
      {resumeText && (
        <CollapsibleSection
          id="career-path"
          title={t('freeResults.careerPathSection.title')}
          subtitle={t('freeResults.careerPathSection.subtitle')}
          icon={<TrendingUp className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('uploader.badges.free')}
            </span>
          }
        >
          <CareerPathSimulator
            resumeText={resumeText}
            industry={industry}
            currentRole={currentRole}
          />
        </CollapsibleSection>
      )}

      {currentScan && currentScan.checklist && currentScan.checklist.length > 0 && (
        <CollapsibleSection
          id="fix-checklist"
          title={t('freeResults.fixChecklistTitle')}
          subtitle={t('freeResults.checklistCompleted', { completed: currentScan.checklist.filter((i) => i.completed).length, total: currentScan.checklist.length })}
          icon={<CheckCircle2 className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {t('freeResults.trackProgress')}
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
            <p className="text-xs font-medium text-primary uppercase tracking-wider">{t('freeResults.eliteSignals.title')}</p>
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
          <h4 className="font-semibold">{t('freeResults.shareResults.title')}</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">
            {t('freeResults.shareResults.badge')}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t('freeResults.shareResults.subtitle')}
        </p>
        <ShareableScoreCard
          candidateName={candidateName}
          atsScore={atsScoreEstimate}
          formatGrade={formatGrade}
          industry={industry}
          experienceLevel={getExperienceLevelLabel(experienceLevel.level)}
          topStrength={topStrength.title}
          improvementPotential={improvementPotential?.estimatedScoreIncrease}
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
            <h4 className="font-bold text-lg">{t('freeResults.topSkipReasons.title')}</h4>
          </div>
          
          {/* Code-style block */}
          <div className="rounded-xl bg-[hsl(222,47%,11%)] border border-border/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-[hsl(222,47%,8%)] border-b border-border/30">
              <span className="text-xs text-muted-foreground font-mono">priority</span>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(topSkipReasons.map((r, i) => `${i + 1}. ${r}`).join('\n'));
                  toast({
                    title: t('freeResults.toast.copiedToClipboard'),
                    description: t('freeResults.toast.shareWithFriend')
                  });
                }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                {t('freeResults.topSkipReasons.copyButton')}
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
              <span className="font-medium text-foreground">{t('freeResults.topSkipReasons.whyLabel')}</span>{" "}
              {t('freeResults.topSkipReasons.whyNote')}
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
            <h4 className="font-semibold flex-1">{t('freeResults.howYouCompare.title')}</h4>
            <MetricTooltip metricKey="industryBenchmark" />
          </div>
          <p className="text-xs text-muted-foreground mb-4">{t('freeResults.howYouCompare.subtitle', { industry })}</p>
          
          {/* Score Comparison */}
          <div className="flex items-center gap-3 mb-4">
            {/* Your Score */}
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-xs font-medium text-foreground">{t('freeResults.howYouCompare.you')}</span>
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
                <span className="text-xs font-medium text-foreground">{t('freeResults.howYouCompare.others')}</span>
                <span className="text-lg font-bold text-muted-foreground">{industryBenchmark.industryAvg}</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-muted-foreground/40 rounded-full" style={{ width: `${industryBenchmark.industryAvg}%` }} />
              </div>
            </div>
          </div>
          
          {/* Peer Percentile — emotionally specific: names the person, role, seniority */}
          {(() => {
            const isTop = industryBenchmark.comparison === "above";
            const isAt = industryBenchmark.comparison === "at";
            const isBelow = industryBenchmark.comparison === "below";
            const firstName = candidateName?.split(' ')[0];
            const roleLabel = industryDetection?.detectedRole || currentRole || null;
            const senLabel = seniorityLevel || industryDetection?.seniorityLevel || null;
            // Build cohort label: "Senior Software Engineer" or "Technology" fallback
            const cohortLabel = [senLabel, roleLabel].filter(Boolean).join(' ') || industry.replace(/_/g, ' ');
            // Compute numeric percentile for emotional framing
            const pctRaw = industryBenchmark.percentile;
            const numMatch = pctRaw.match(/\d+/);
            const numPct = numMatch ? parseInt(numMatch[0]) : null;
            // bottom X% or top X%
            const isBottomFrame = pctRaw.toLowerCase().includes("bottom") || (!isTop && !isAt && numPct !== null && numPct <= 50);
            const pctDisplay = pctRaw.includes("%") || pctRaw.toLowerCase().includes("top") || pctRaw.toLowerCase().includes("bottom")
              ? pctRaw
              : isTop ? "Top 25%" : isAt ? "Top 50%" : "Bottom 40%";

            const headlineText = (() => {
              if (isTop) return `${firstName ? firstName + "'s" : "Your"} resume outperforms most ${cohortLabel} resumes`;
              if (isAt) return `${firstName ? firstName + "'s" : "Your"} resume is average among ${cohortLabel} resumes`;
              return `${firstName ? firstName + "'s" : "Your"} resume scores below most ${cohortLabel} resumes`;
            })();

            const bodyText = (() => {
              if (isTop) return `Recruiters scanning ${cohortLabel} candidates will likely pass your resume to the next round based on ATS score alone.`;
              if (isAt) return `Half the ${cohortLabel} resumes we've analyzed score the same or higher. A few targeted fixes could move you into the top quarter.`;
              return `Most ${cohortLabel} resumes that make it to a recruiter's desk score higher than yours. The gap is fixable — but it needs to close before you apply.`;
            })();

            return (
              <div className={cn(
                "rounded-lg mb-3 overflow-hidden border",
                isTop ? "border-success/30" : isAt ? "border-warning/30" : "border-destructive/30"
              )}>
                <div className={cn(
                  "px-4 py-3 flex items-center gap-3",
                  isTop ? "bg-success/10" : isAt ? "bg-warning/10" : "bg-destructive/10"
                )}>
                  <div className={cn(
                    "text-2xl font-black tabular-nums shrink-0",
                    isTop ? "text-success" : isAt ? "text-warning" : "text-destructive"
                  )}>
                    {pctDisplay}
                  </div>
                  <div>
                    <p className={cn("text-sm font-semibold leading-tight",
                      isTop ? "text-success" : isAt ? "text-warning" : "text-destructive"
                    )}>{headlineText}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{bodyText}</p>
                  </div>
                </div>
                {!isTop && (
                  <div className="px-4 py-2 bg-background/60 border-t border-border/40">
                    <p className="text-xs text-muted-foreground">
                      {isBelow
                        ? "Resumes that score in the top 25% get 3× more interview callbacks in your field."
                        : "Top-quartile resumes in your field get called back 2× more often."}
                      {!diagnosticLayout && <>{" "}<button onClick={() => handleUpgradeClick('peer_percentile_cta')} className="text-primary font-semibold hover:underline">See what's holding you back →</button></>}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* What This Means - Clear, non-contradictory guidance */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-1">
              {industryBenchmark.comparison === "above"
                ? t('freeResults.peerBenchmark.strongPosition')
                : industryBenchmark.comparison === "at"
                  ? t('freeResults.peerBenchmark.roomForImprovement')
                  : t('freeResults.peerBenchmark.belowAverage')}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {industryBenchmark.comparison === "above"
                ? t('freeResults.peerBenchmark.strongResult')
                : industryBenchmark.comparison === "at"
                  ? t('freeResults.peerBenchmark.competitiveResult')
                : t('freeResults.peerBenchmark.weakResult')}
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
                {t('freeResults.howYouCompare.getJobSpecific')}
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
            <h4 className="font-semibold flex-1">{t('freeResults.careerTimeline.title')}</h4>
            <MetricTooltip metricKey="timeline" />
          </div>
          
          <div className="space-y-3">
            {/* Total Experience */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">{t('freeResults.careerTimeline.totalExp')}</span>
                <span className="text-sm font-bold text-primary">{timelineAnalysis.totalYears}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('freeResults.careerTimeline.totalExpDesc')}
              </p>
            </div>
            
            {/* Avg Job Tenure */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">{t('freeResults.careerTimeline.avgTenure')}</span>
                <span className={cn("text-sm font-bold",
                  parseFloat(timelineAnalysis.avgTenure) >= 2 ? "text-success" : 
                  parseFloat(timelineAnalysis.avgTenure) >= 1 ? "text-warning" : "text-destructive"
                )}>{timelineAnalysis.avgTenure}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {parseFloat(timelineAnalysis.avgTenure) >= 2
                  ? t('freeResults.careerTimeline.tenureGood')
                  : parseFloat(timelineAnalysis.avgTenure) >= 1
                    ? t('freeResults.careerTimeline.tenureWarning')
                    : t('freeResults.careerTimeline.tenurePoor')}
              </p>
            </div>
            
            {/* Career Progression */}
            <div className="p-3 rounded-lg bg-muted/30">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-foreground">{t('freeResults.careerTimeline.careerGrowth')}</span>
                <span className={cn("text-sm font-bold capitalize",
                  timelineAnalysis.progression === "rapid" ? "text-success" :
                  timelineAnalysis.progression === "steady" ? "text-success" :
                  timelineAnalysis.progression === "stagnant" ? "text-warning" : "text-muted-foreground"
                )}>
                  {timelineAnalysis.progression === "rapid" ? t('freeResults.timelineProgression.rapidLabel') :
                   timelineAnalysis.progression === "steady" ? t('freeResults.timelineProgression.steadyLabel') :
                   timelineAnalysis.progression === "stagnant" ? t('freeResults.timelineProgression.stagnantLabel') : t('freeResults.timelineProgression.unclearLabel')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {timelineAnalysis.progression === "rapid"
                  ? t('freeResults.timelineProgression.rapid')
                  : timelineAnalysis.progression === "steady"
                    ? t('freeResults.timelineProgression.steady')
                    : timelineAnalysis.progression === "stagnant"
                      ? t('freeResults.timelineProgression.stagnant')
                      : t('freeResults.timelineProgression.unclear')}
              </p>
            </div>

            {/* Employment Gaps Warning */}
            {timelineAnalysis.hasGaps && (
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  <span className="text-sm font-medium text-warning">{t('freeResults.timelineProgression.gapDetected')}</span>
                </div>
                <p className="text-xs text-warning/80">
                  {timelineAnalysis.gapNote || t('freeResults.timelineProgression.gapNoteDefault')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      </div> {/* end section-issues */}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Insights */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-insights">

      {/* Career Situation Detection */}
      {careerSituation && careerSituation.situation !== "standard" && (
        <div className="rounded-2xl bg-card border border-border p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            {careerSituation.situation === "career_changer" && <Briefcase className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "returning_to_workforce" && <User className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "military_transition" && <Target className="w-4 h-4 text-primary" />}
            {careerSituation.situation === "recent_grad" && <Trophy className="w-4 h-4 text-primary" />}
            <h4 className="font-semibold flex-1">
              {careerSituation.situation === "career_changer" && t('freeResults.careerSituationLabel.careerChanger')}
              {careerSituation.situation === "returning_to_workforce" && t('freeResults.careerSituationLabel.returningToWorkforce')}
              {careerSituation.situation === "military_transition" && t('freeResults.careerSituationLabel.militaryTransition')}
              {careerSituation.situation === "recent_grad" && t('freeResults.careerSituationLabel.recentGrad')}
            </h4>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              careerSituation.confidence === "high" ? "bg-success/20 text-success" :
              careerSituation.confidence === "medium" ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
            )}>
              {t('freeResults.confidencePercent', { confidence: careerSituation.confidence })}
            </span>
          </div>
          
          <p className="text-sm text-muted-foreground mb-4">
            {careerSituation.situationSummary}
          </p>

          {/* Indicators */}
          {careerSituation.indicators && careerSituation.indicators.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">{t('freeResults.careerSituationDetected.whatDetected')}</p>
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
              <p className="text-sm font-semibold text-foreground">{t('freeResults.careerSituationDetected.tailoredAdvice')}</p>
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

      {/* Personalized Career Insights */}
      {personalizedCareerInsights && (
        <CollapsibleSection
          id="career-insights"
          title={t('freeResults.personalizedCareerInsightsTitle')}
          subtitle={t('freeResults.tailoredForYou', { name: candidateName || t('freeResults.you') })}
          icon={<Sparkles className="w-4 h-4" />}
          defaultOpen={false}
          badge={<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{t('freeResults.aiPowered')}</span>}
        >
        <div className="rounded-xl bg-gradient-to-br from-primary/5 via-card to-card border border-primary/20 p-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.08),transparent_50%)] pointer-events-none" />
          
          <div className="relative">

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
                  <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.headlineTitle')}</h5>
                </div>
                <div className="p-3 rounded-xl bg-muted/50 border border-border">
                  <p className="font-medium text-foreground">{personalizedCareerInsights.suggestedHeadline}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t('freeResults.personalizedCareerInsights.headlineTip')}</p>
                </div>
              </div>
            )}

            {/* Unique Value Proposition */}
            {personalizedCareerInsights.uniqueValue && (
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-primary" />
                  <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.uniqueValue')}</h5>
                </div>
                <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-xl">
                  {personalizedCareerInsights.uniqueValue}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Next Role Suggestions */}
              {personalizedCareerInsights.nextRoleSuggestions && personalizedCareerInsights.nextRoleSuggestions.length > 0 && (
                gateDeepInsights ? (
                  <LockedPremiumInsight
                    title={t('freeResults.personalizedCareerInsights.nextMoves')}
                    description={t('freeResults.lockedInsights.careerNextRole')}
                    previewLines={personalizedCareerInsights.nextRoleSuggestions.slice(0, 2).map(r => `→ ${r.title}`)}
                    onUnlock={() => handleUpgradeClick('locked_next_roles')}
                    isLoading={isLoading}
                  />
                ) : (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Rocket className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.nextMoves')}</h5>
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
                            {role.fit === "natural_progression" ? t('freeResults.roleFit.naturalProgression') :
                             role.fit === "lateral_move" ? t('freeResults.roleFit.lateralMove') : t('freeResults.roleFit.stretchGoal')}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{role.gapToClose}</p>
                      </div>
                    ))}
                  </div>
                </div>
                )
              )}

              {/* Interview Talking Points */}
              {personalizedCareerInsights.interviewTalkingPoints && personalizedCareerInsights.interviewTalkingPoints.length > 0 && (
                gateDeepInsights ? (
                  <LockedPremiumInsight
                    title={t('freeResults.personalizedCareerInsights.interviewStories')}
                    description={t('freeResults.lockedInsights.careerInterview')}
                    previewLines={personalizedCareerInsights.interviewTalkingPoints.slice(0, 2).map(p => `"${p.achievement.substring(0, 60)}..."`)}
                    onUnlock={() => handleUpgradeClick('locked_interview_stories')}
                    isLoading={isLoading}
                  />
                ) : (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.interviewStories')}</h5>
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
                )
              )}
            </div>

            {/* Salary Insight */}
            {personalizedCareerInsights.salaryInsight && (gateDeepInsights ? (
              <div className="mt-5">
                <LockedPremiumInsight
                  title={t('freeResults.personalizedCareerInsights.salaryInsightTitle')}
                  description={t('freeResults.lockedInsights.careerSalary')}
                  previewLines={[`💰 ${personalizedCareerInsights.salaryInsight.estimatedRange}`, ...(personalizedCareerInsights.salaryInsight.leveragePoints?.slice(0,2) ?? [])]}
                  onUnlock={() => handleUpgradeClick('locked_salary')}
                  isLoading={isLoading}
                  variant="highlight"
                />
              </div>
            ) : (
              <div className="mt-5 p-4 rounded-xl bg-gradient-to-r from-success/5 to-primary/5 border border-success/20">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-success" />
                  <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.salaryInsightTitle')}</h5>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full ml-auto",
                    personalizedCareerInsights.salaryInsight.marketPosition === "above_market" ? "bg-success/20 text-success" :
                    personalizedCareerInsights.salaryInsight.marketPosition === "at_market" ? "bg-primary/20 text-primary" :
                    "bg-warning/20 text-warning"
                  )}>
                    {personalizedCareerInsights.salaryInsight.marketPosition === "above_market" ? t('freeResults.marketPosition.aboveMarket') :
                     personalizedCareerInsights.salaryInsight.marketPosition === "at_market" ? t('freeResults.marketPosition.atMarket') : t('freeResults.marketPosition.belowMarket')}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-2xl font-bold text-success">{personalizedCareerInsights.salaryInsight.estimatedRange}</span>
                  <span className="text-xs text-muted-foreground">{t('freeResults.personalizedCareerInsights.estimatedRange')}</span>
                </div>
                {personalizedCareerInsights.salaryInsight.leveragePoints && personalizedCareerInsights.salaryInsight.leveragePoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">{t('freeResults.personalizedCareerInsights.negotiationLeverage')}</p>
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
            ))}

            {/* Hidden Strengths & Personal Brand */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
              {/* Hidden Strengths */}
              {personalizedCareerInsights.hiddenStrengths && personalizedCareerInsights.hiddenStrengths.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4 text-warning" />
                    <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.hiddenStrengths')}</h5>
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
                gateDeepInsights ? (
                  <LockedPremiumInsight
                    title={t('freeResults.personalizedCareerInsights.personalBrand')}
                    description={t('freeResults.lockedInsights.careerBrand')}
                    previewLines={[
                      `${t('freeResults.personalizedCareerInsights.currentLabel')} ${personalizedCareerInsights.personalBrand.currentBrand.substring(0, 50)}...`,
                      `${t('freeResults.personalizedCareerInsights.idealLabel')} ...`,
                    ]}
                    onUnlock={() => handleUpgradeClick('locked_personal_brand')}
                    isLoading={isLoading}
                  />
                ) : (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-primary" />
                    <h5 className="font-semibold text-sm">{t('freeResults.personalizedCareerInsights.personalBrand')}</h5>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-16">{t('freeResults.personalizedCareerInsights.currentLabel')}</span>
                      <span className="text-muted-foreground">{personalizedCareerInsights.personalBrand.currentBrand}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-success shrink-0 w-16">{t('freeResults.personalizedCareerInsights.idealLabel')}</span>
                      <span className="text-success font-medium">{personalizedCareerInsights.personalBrand.idealBrand}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-warning shrink-0 w-16">{t('freeResults.personalizedCareerInsights.gapLabel')}</span>
                      <span className="text-warning">{personalizedCareerInsights.personalBrand.brandGap}</span>
                    </div>
                  </div>
                </div>
                )
              )}
            </div>
          </div>
        </div>
        </CollapsibleSection>
      )}

      {/* Format Recommendation - Industry-Specific */}
      {formatRecommendation && (
        <CollapsibleSection
          id="format-recommendation"
          title={t('freeResults.formatRecommendationSection.title')}
          subtitle={t('freeResults.formatRecommendationSection.subtitle', { style: formatRecommendation.recommendedStyle, industry })}
          icon={<LayoutList className="w-4 h-4" />}
          defaultOpen={false}
          badge={
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize",
              "bg-primary/20 text-primary"
            )}>
              {formatRecommendation.recommendedStyle}
            </span>
          }
        >
        <div className="rounded-xl bg-card border border-border p-4">
          <p className="text-xs text-muted-foreground mb-4">
            {t('freeResults.formatRecommendationSection.basedOnStandards', { industry })}
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
                    ? t('freeResults.formatRecommendationSection.fitsIndustry')
                    : t('freeResults.formatRecommendationSection.needsAdjustment')}
                </p>
                {!formatRecommendation.currentFormatAssessment.isAppropriate && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatRecommendation.currentFormatAssessment.mainIssue}
                  </p>
                )}
                <p className="text-sm font-medium text-primary mt-2">
                  {t('freeResults.formatRecommendationSection.quickFixLabel', { fix: formatRecommendation.currentFormatAssessment.quickFix })}
                </p>
              </div>
            </div>
          </div>

          {/* Layout Advice */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.formatRecommendationSection.layoutLabel')}</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.layoutAdvice.columns === "one_column" ? t('freeResults.columns.oneColumn') : t('freeResults.columns.twoColumn')}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.formatRecommendationSection.colorLabel')}</p>
              <p className="text-sm font-semibold">
                {formatRecommendation.layoutAdvice.useColor ? t('freeResults.formatRecommendationSection.colorAcceptable') : t('freeResults.formatRecommendationSection.colorAvoid')}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.formatRecommendationSection.visualsLabel')}</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.layoutAdvice.visualElements}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-center col-span-2 md:col-span-1">
              <p className="text-xs text-muted-foreground mb-1">{t('freeResults.formatRecommendationSection.styleLabel')}</p>
              <p className="text-sm font-semibold capitalize">
                {formatRecommendation.recommendedStyle}
              </p>
            </div>
          </div>

          {/* Industry Norms */}
          {formatRecommendation.industryNorms && formatRecommendation.industryNorms.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-semibold mb-3">{t('freeResults.formatRecommendationSection.whatTopResumesDo', { industry })}</p>
              <div className="space-y-2">
                {formatRecommendation.industryNorms.map((norm, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded shrink-0 mt-0.5",
                      norm.importance === "must_have" ? "bg-destructive/20 text-destructive" :
                      norm.importance === "recommended" ? "bg-primary/20 text-primary" :
                      "bg-muted text-muted-foreground"
                    )}>
                      {norm.importance === "must_have" ? t('freeResults.formatRecommendationSection.importance.must') : norm.importance === "recommended" ? t('freeResults.formatRecommendationSection.importance.rec') : t('freeResults.formatRecommendationSection.importance.opt')}
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
              <p className="text-xs font-semibold text-destructive mb-2">{t('freeResults.formatRecommendationSection.avoidForIndustry', { industry })}</p>
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
              <span className="font-semibold text-primary">{t('freeResults.formatRecommendationSection.idealTemplate')}</span>
              <span className="text-muted-foreground">{formatRecommendation.templateSuggestion}</span>
            </p>
          </div>
        </div>
        </CollapsibleSection>
      )}

      {/* ATS System Compatibility — hidden entirely when the scan didn't
          return the assessment (never fabricated) */}
      {atsSystemCompatibility && (
      <CollapsibleSection
        id="ats-compatibility"
        title={t('freeResults.atsParsingSection.title')}
        subtitle={t('freeResults.atsParsingSection.subtitle')}
        icon={<FileCheck className="w-4 h-4" />}
        defaultOpen={false}
      >
      <div className="rounded-xl bg-card border border-border p-4">

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
            {atsSystemCompatibility.overallRating === "excellent" ? t('freeResults.atsParsingSection.excellentRating') :
             atsSystemCompatibility.overallRating === "good" ? t('freeResults.atsParsingSection.goodRating') :
             atsSystemCompatibility.overallRating === "fair" ? t('freeResults.atsParsingSection.fairRating') : t('freeResults.atsParsingSection.poorRating')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {atsSystemCompatibility.overallRating === "excellent"
              ? t('freeResults.atsParsingSection.excellent')
              : atsSystemCompatibility.overallRating === "good"
                ? t('freeResults.atsParsingSection.good')
                : atsSystemCompatibility.overallRating === "fair"
                  ? t('freeResults.atsParsingSection.fair')
                  : t('freeResults.atsParsingSection.poor')}
          </p>
        </div>

        {/* Best-for / worst-for context from the actual analysis. Per-vendor
            behavior (Workday/Greenhouse/Lever/iCIMS) is covered by the
            deterministic vendor-checks card — no invented vendor scores here. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {atsSystemCompatibility.bestFor && (
            <div className="p-4 rounded-xl bg-success/5 border border-success/20">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-success" />
                <span className="text-sm font-semibold text-success">Where this resume competes well</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{atsSystemCompatibility.bestFor}</p>
            </div>
          )}
          {atsSystemCompatibility.worstFor && (
            <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm font-semibold text-destructive">Where it will struggle</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{atsSystemCompatibility.worstFor}</p>
            </div>
          )}
        </div>

        {/* Disclaimer about estimates */}
        <p className="text-[10px] text-muted-foreground/70 italic mb-3">
          {t('freeResults.atsCompat.disclaimer')}
        </p>

        {/* Top Issue to Fix */}
        {atsSystemCompatibility.topIssue && (
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-xs font-medium text-foreground mb-1">
              {t('freeResults.atsCompat.topIssueLabel')}
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
                {getProductCtaCopy('control', t, formatPrice, isLocalCurrency).premiumPackage.headline}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('freeResults.atsCompat.ctaSubtext')}
              </p>
            </div>
            <PremiumPackageButton variant="control" isPrimary section="ats_compatibility" />
          </div>
        </div>
      </div>
      </CollapsibleSection>
      )}

      {/* Power Words & Weak Phrases */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Power Words */}
        {powerWords.length > 0 && (
          <div className="rounded-2xl bg-success/5 border border-success/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-4 h-4 text-success" />
              <h4 className="font-semibold text-success">{t('freeResults.powerWords.title')}</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {powerWords.map((word, index) => {
                const label = typeof word === 'string' ? word : word.word;
                const why = typeof word === 'object' ? word.why : undefined;
                return (
                  <span key={index} title={why} className="px-3 py-1 bg-success/10 text-success text-sm font-medium rounded-full border border-success/20 cursor-default" style={why ? { textDecorationLine: 'underline', textDecorationStyle: 'dotted' } : undefined}>
                    {label}
                  </span>
                );
              })}
            </div>
            {powerWords.some(w => typeof w === 'object' && (w as { why?: string }).why) && (
              <p className="text-xs text-success/60 mt-2">Hover each word to see why it stands out.</p>
            )}
            <p className="text-xs text-success/70 mt-1">{t('freeResults.powerWords.keepUsing')}</p>
          </div>
        )}

        {/* Weak Phrases */}
        {weakPhrases.length > 0 && (
          <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <XCircle className="w-4 h-4 text-destructive" />
              <h4 className="font-semibold text-destructive">{t('freeResults.weakPhrases.title')}</h4>
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

      {/* Weak Bullets — quoted directly from the resume so the report feels specific */}
      {(weakBulletsDetected.length > 0 || unquantifiedBulletsDetected.length > 0) && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold text-foreground">
              {candidateName ? `${candidateName?.split(' ')[0]}'s bullets that need fixing` : 'Bullets that need fixing'}
            </h4>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
              From your resume
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">These exact lines were found in your resume and are dragging your score down.</p>
          <div className="space-y-2">
            {weakBulletsDetected.map((b, i) => (
              <div key={i} className="rounded-lg border border-destructive/20 bg-background/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-destructive/15 flex items-center justify-center">
                    <span className="text-[10px] text-destructive font-bold">✕</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground/90 italic">"{b.text}"</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium">{b.role}</span> · {b.reason}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {unquantifiedBulletsDetected.map((b, i) => (
              <div key={`uq-${i}`} className="rounded-lg border border-warning/20 bg-background/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-warning/15 flex items-center justify-center">
                    <span className="text-[10px] text-warning font-bold">#</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground/90 italic">"{b.text}"</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium">{b.role}</span> · no measurable metric
                      {bulletQuantRate !== undefined && <span className="ml-1">({bulletQuantRate}% of your bullets have metrics)</span>}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MARKET INTELLIGENCE CARD ── */}
      {marketIntelligence && (
        <div className="rounded-2xl border border-primary/20 bg-card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground">
              {marketIntelligence.countryName} Market Intelligence
            </h4>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {marketIntelligence.countryName}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{marketIntelligence.marketSummary}</p>
          {marketIntelligence.hotSkills.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground mb-1.5">🔥 Hot skills right now</p>
              <div className="flex flex-wrap gap-1.5">
                {marketIntelligence.hotSkills.map((skill, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20 font-medium">{skill}</span>
                ))}
              </div>
            </div>
          )}
          {marketIntelligence.risingKeywords.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-foreground mb-1.5">📈 Rising keywords in job postings</p>
              <div className="flex flex-wrap gap-1.5">
                {marketIntelligence.risingKeywords.map((kw, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20 font-medium">{kw}</span>
                ))}
              </div>
            </div>
          )}
          {marketIntelligence.cvNorms.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-foreground mb-1.5">📋 {marketIntelligence.countryName} CV norms</p>
              <ul className="space-y-1">
                {marketIntelligence.cvNorms.map((norm, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-0.5 shrink-0">•</span>{norm}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {marketIntelligence.salaryContext && (
            <p className="text-xs text-muted-foreground mt-2 border-t border-border/40 pt-2">
              <span className="font-medium text-foreground">💰 Salary context: </span>{marketIntelligence.salaryContext}
            </p>
          )}
        </div>
      )}

      {/* ── SKILLS RECENCY CARD ── */}
      {skillsRecency && (skillsRecency.agingSkills.length > 0 || skillsRecency.freshSkills.length > 0) && (
        <div className={cn(
          "rounded-2xl border p-5 mb-5",
          skillsRecency.hasAgingSignals ? "border-warning/30 bg-warning/5" : "border-success/20 bg-success/5"
        )}>
          <div className="flex items-center gap-2 mb-3">
            <RefreshCw className={cn("w-4 h-4", skillsRecency.hasAgingSignals ? "text-warning" : "text-success")} />
            <h4 className="font-semibold text-foreground">Skills Freshness</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-semibold",
              skillsRecency.freshnessScore >= 75 ? "bg-success/15 text-success" :
              skillsRecency.freshnessScore >= 50 ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"
            )}>
              {skillsRecency.freshnessScore}/100
            </span>
          </div>
          {skillsRecency.agingSkills.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-warning mb-1.5">⚠️ Aging skills (declining in job postings)</p>
              <div className="flex flex-wrap gap-1.5">
                {skillsRecency.agingSkills.map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20 line-through">{s}</span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">These appear in fewer current job postings — consider pairing with modern equivalents.</p>
            </div>
          )}
          {skillsRecency.freshSkills.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-success mb-1.5">✓ Current skills (high demand 2025)</p>
              <div className="flex flex-wrap gap-1.5">
                {skillsRecency.freshSkills.map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20 font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CAREER TRAJECTORY CARD ── */}
      {careerTrajectory && careerTrajectory.trajectory !== 'unknown' && (
        <div className="rounded-2xl border border-border bg-card p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground">Career Trajectory</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-medium",
              careerTrajectory.trajectory === 'upward' ? "bg-success/15 text-success" :
              careerTrajectory.trajectory === 'transition' ? "bg-primary/10 text-primary" :
              careerTrajectory.trajectory === 'regression' ? "bg-warning/15 text-warning" :
              "bg-muted text-muted-foreground"
            )}>
              {careerTrajectory.trajectory === 'upward' ? '↑ Upward' :
               careerTrajectory.trajectory === 'lateral' ? '→ Lateral' :
               careerTrajectory.trajectory === 'transition' ? '⇄ Transition' :
               careerTrajectory.trajectory === 'regression' ? '↓ Regression' :
               careerTrajectory.trajectory === 'early_career' ? '◎ Early Career' : careerTrajectory.trajectory}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{careerTrajectory.progressionSummary}</p>
          {careerTrajectory.industryTransitionDetected && careerTrajectory.fromIndustry && (
            <div className="mt-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs text-primary font-medium">Career transition detected: {careerTrajectory.fromIndustry} → current field</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your resume should explicitly bridge your previous experience to your target role — this is a key quick win.</p>
            </div>
          )}
          {careerTrajectory.promotionCount > 0 && (
            <p className="text-xs text-success mt-2">✓ {careerTrajectory.promotionCount} promotion{careerTrajectory.promotionCount !== 1 ? 's' : ''} detected — make sure each title change is clearly visible.</p>
          )}
        </div>
      )}

      {/* ── COMPETITIVE KEYWORD GAP CARD ── */}
      {competitiveGap && competitiveGap.missingHighFrequency.length > 0 && (
        <div className="rounded-2xl border border-destructive/20 bg-card p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold text-foreground">Competitive Keyword Gap</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-semibold",
              competitiveGap.gapScore >= 70 ? "bg-success/15 text-success" :
              competitiveGap.gapScore >= 40 ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"
            )}>
              {competitiveGap.gapScore}% coverage
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Keywords that appear in 70%+ of top-quartile resumes at your level — and are missing from yours.
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {competitiveGap.missingHighFrequency.map((kw, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-full border border-destructive/30 bg-destructive/5 text-destructive font-medium">
                − {kw}
              </span>
            ))}
          </div>
          {competitiveGap.presentHighFrequency.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {competitiveGap.presentHighFrequency.map((kw, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                  ✓ {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ATS SYSTEM CARD ── */}
      {atsSystemDetected && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 mb-5">
          <div className="flex items-center gap-2 mb-1">
            <Settings2 className="w-4 h-4 text-warning" />
            <p className="text-sm font-semibold text-foreground">
              Target ATS: <span className="text-warning">{atsSystemDetected.name}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            We detected this company uses {atsSystemDetected.name}. Formatting recommendations above are tailored for this specific system.
          </p>
        </div>
      )}

      {/* ── RESUME TIMELINE CARD (improvement #5) ── */}
      {resumeTimeline && (resumeTimeline.hasSignificantGap || resumeTimeline.hasShortTenures) && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h4 className="font-semibold text-foreground">Employment Timeline</h4>
            {resumeTimeline.rolesDetected > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium">
                {resumeTimeline.rolesDetected} role{resumeTimeline.rolesDetected !== 1 ? 's' : ''} detected
              </span>
            )}
          </div>
          {resumeTimeline.hasSignificantGap && (
            <div className="mb-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20">
              <p className="text-xs font-semibold text-warning mb-0.5">Employment gap detected</p>
              <p className="text-xs text-muted-foreground">
                Gaps longer than 6 months are flagged by many ATS systems. Add a brief explanation in your summary (freelance consulting, caregiving, upskilling) or add a short consulting/contract entry.
              </p>
              {resumeTimeline.gapPeriods.filter(g => g.monthsGap > 6).map((g, i) => (
                <p key={i} className="text-xs text-warning mt-1 font-medium">
                  ~{Math.round(g.monthsGap)} months after "{g.afterTitle.substring(0, 50)}"
                </p>
              ))}
            </div>
          )}
          {resumeTimeline.hasShortTenures && (
            <div className="p-2.5 rounded-lg bg-warning/10 border border-warning/20">
              <p className="text-xs font-semibold text-warning mb-0.5">Short tenure detected</p>
              <p className="text-xs text-muted-foreground">
                One or more roles under 12 months may raise recruiter questions. Add context (contract role, startup folded, layoff) to prevent filtering.
              </p>
            </div>
          )}
          {resumeTimeline.averageTenureMonths > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Average tenure: {(resumeTimeline.averageTenureMonths / 12).toFixed(1)} years · Total detected: {(resumeTimeline.totalExperienceMonths / 12).toFixed(1)} years
            </p>
          )}
        </div>
      )}

      {/* Interactive score simulator — check fixes, watch the projection */}
      {quickWins.length > 0 && (
        <div className="mb-5">
          <ScoreSimulatorCard
            key={`sim-${atsScoreEstimate}-${quickWins.length}`}
            atsScore={atsScoreEstimate}
            fixes={quickWins.slice(0, 5).map(w => ({ label: w.fix, impact: w.scoreImpact ?? (w.impact === 'high' ? 6 : w.impact === 'medium' ? 4 : 2) }))}
          />
        </div>
      )}

      {/* Quick Wins */}
      {quickWins.length > 0 && (
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-primary" />
            <h4 className="font-semibold">{t('freeResults.quickWins.title')}</h4>
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
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">⏱️ {win.timeEstimate}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      win.impact === "high" ? "bg-success/10 text-success" :
                      win.impact === "medium" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                    )}>
                      {t('freeResults.quickWins.impact', { level: win.impact })}
                    </span>
                    {win.scoreImpact != null && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                        +{win.scoreImpact} pts
                      </span>
                    )}
                    {win.category && (
                      <span className="text-xs text-muted-foreground capitalize">{win.category}</span>
                    )}
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
                  {t('freeResults.quickWins.wantAllDone')}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('freeResults.quickWins.premiumIncludes')}
                </p>
              </div>
              <PremiumPackageButton variant="control" isPrimary section="quick_wins" />
            </div>
          </div>
        </div>
      )}

      {/* Projected Score Gap — shown when we have a meaningful improvement estimate */}
      {projectedScore && projectedScore > atsScoreEstimate + 3 && (
        <div className="rounded-2xl border border-success/30 bg-success/5 p-5 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-success" />
            <h4 className="font-semibold text-foreground text-sm">Your Score Potential</h4>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-foreground">{atsScoreEstimate}</p>
              <p className="text-xs text-muted-foreground">Current</p>
            </div>
            <div className="flex-1 flex items-center gap-1">
              <div className="flex-1 h-1 rounded-full bg-muted" />
              <span className="text-xs font-semibold text-success px-1">+{projectedScore - atsScoreEstimate} pts</span>
              <div className="flex-1 h-1 rounded-full bg-success/40" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-success">{projectedScore}</p>
              <p className="text-xs text-muted-foreground">After fixes</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Estimated after addressing top quick wins above.</p>
        </div>
      )}

      {/* Sample Rewrite */}
      {sampleRewrite && (
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-success/10 border border-primary/30 p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-primary" />
            <h4 className="font-semibold">{t('freeResults.sampleRewrite.title')}</h4>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary ml-auto">{t('freeResults.sampleRewrite.badge')}</span>
          </div>
          
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium mb-1">{t('freeResults.sampleRewrite.before')}</p>
              <p className="text-sm text-foreground italic">"{sampleRewrite.before}"</p>
            </div>
            
            <div className="flex justify-center">
              <ArrowRight className="w-4 h-4 text-primary" />
            </div>
            
            <div className="p-3 rounded-xl bg-success/10 border border-success/20">
              <p className="text-xs text-success font-medium mb-1">{t('freeResults.sampleRewrite.after')}</p>
              <p className="text-sm text-foreground font-medium">"{sampleRewrite.after}"</p>
            </div>

            {/* Word-level diff — the transformation legible in one glance */}
            <div className="p-3 rounded-xl bg-background/50 border border-border/50">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">What changed</p>
              <p className="text-sm leading-relaxed">
                {diffWords(sampleRewrite.before, sampleRewrite.after).map((seg, i) => (
                  seg.type === 'removed'
                    ? <span key={i} className="text-destructive/80 line-through mr-1">{seg.text}</span>
                    : seg.type === 'added'
                      ? <span key={i} className="text-success font-medium bg-success/10 rounded px-0.5 mr-1">{seg.text}</span>
                      : <span key={i} className="text-muted-foreground mr-1">{seg.text}</span>
                ))}
              </p>
            </div>

            <div className="text-center p-2 rounded-lg bg-background/50 border border-border/50">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t('freeResults.sampleRewrite.whyBetter')}</span> {sampleRewrite.improvement}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-4 p-2 rounded-lg bg-primary/10 border border-primary/20">
            <Lock className="w-3 h-3 text-primary" />
            <span className="text-xs text-primary">{t('freeResults.sampleRewrite.cta', { price: priceDisplay })}</span>
          </div>
        </div>
      )}

      {/* ── Weakest bullets, graded + rewritten ─────────────────────────────── */}
      {weakestBullets && weakestBullets.length > 0 && (
        <div className="mb-5">
          <WeakestBulletsCard bullets={weakestBullets} />
        </div>
      )}

      {/* ── Resume X-Ray — their actual document, annotated inline ─────────── */}
      {resumeText && (weakBulletsDetected.length > 0 || unquantifiedBulletsDetected.length > 0 || powerWords.length > 0) && (
        <CardErrorBoundary section="resume-xray">
          <ResumeXRay
            resumeText={resumeText}
            weakBullets={weakBulletsDetected}
            unquantifiedBullets={unquantifiedBulletsDetected}
            powerWords={powerWords}
          />
        </CardErrorBoundary>
      )}

      {/* ── Score Breakdown ─────────────────────────────────────────────────── */}
      {scoreBreakdown && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h4 className="font-semibold text-foreground text-sm">Score Breakdown</h4>
          {(["keywords", "format", "quantification"] as const).map((key) => {
            const val = scoreBreakdown[key];
            const colors = { keywords: "bg-primary", format: "bg-warning", quantification: "bg-success" };
            const labels = { keywords: "Keyword Match", format: "Format", quantification: "Quantification" };
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{labels[key]}</span>
                  <span className="font-medium text-foreground">{val}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${colors[key]}`} style={{ width: `${Math.min(val, 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Peer Percentile + Application Pass Rate ─────────────────────────── */}
      {(peerPercentile != null || applicationPassRate != null) && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <h4 className="font-semibold text-foreground text-sm">{t('freeResults.enterprise.howYouCompare', 'How You Compare')}</h4>
          <div className="grid grid-cols-2 gap-3">
            {peerPercentile != null && (
              <div className={cn(
                "rounded-xl border p-3 text-center",
                peerPercentile >= 60 ? "border-success/30 bg-success/5" : peerPercentile >= 40 ? "border-warning/30 bg-warning/5" : "border-destructive/30 bg-destructive/5"
              )}>
                <p className="text-2xl font-bold text-foreground">{peerPercentile}<span className="text-sm font-normal text-muted-foreground">{(() => { const v = peerPercentile % 100; if (v >= 11 && v <= 13) return 'th'; return ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'; })()}</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">Percentile vs {industry.replace(/_/g, ' ')} candidates</p>
                <p className={cn("text-[10px] font-semibold mt-1", peerPercentile >= 60 ? "text-success" : peerPercentile >= 40 ? "text-warning" : "text-destructive")}>
                  {peerPercentile >= 70 ? "Top tier" : peerPercentile >= 50 ? "Above average" : peerPercentile >= 30 ? "Below average" : "Bottom tier"}
                </p>
              </div>
            )}
            {applicationPassRate != null && (
              <div className={cn(
                "rounded-xl border p-3 text-center",
                applicationPassRate >= 70 ? "border-success/30 bg-success/5" : applicationPassRate >= 50 ? "border-warning/30 bg-warning/5" : "border-destructive/30 bg-destructive/5"
              )}>
                <p className="text-2xl font-bold text-foreground">{applicationPassRate}<span className="text-sm font-normal text-muted-foreground">%</span></p>
                <p className="text-xs text-muted-foreground mt-0.5">Est. ATS pass rate</p>
                <p className={cn("text-[10px] font-semibold mt-1", applicationPassRate >= 70 ? "text-success" : applicationPassRate >= 50 ? "text-warning" : "text-destructive")}>
                  {applicationPassRate >= 70 ? "Likely to pass" : applicationPassRate >= 50 ? "At risk" : "High rejection risk"}
                </p>
              </div>
            )}
          </div>
          {/* Percentile bell curve — "you're here, they're there" in one glance */}
          {peerPercentile != null && (() => {
            const W = 300, H = 70, sigma = 18, mu = 50;
            const pts = Array.from({ length: 61 }, (_, i) => {
              const x = (i / 60) * 100;
              const y = Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
              return `${(x / 100) * W},${H - 8 - y * (H - 18)}`;
            }).join(' ');
            const markerX = (peerPercentile / 100) * W;
            const topQuartileX = (75 / 100) * W;
            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label={`Score distribution: you are at the ${peerPercentile}th percentile`}>
                {/* top-quartile zone */}
                <rect x={topQuartileX} y={6} width={W - topQuartileX} height={H - 14} className="fill-success/10" rx={3} />
                <polyline points={pts} className="fill-none stroke-muted-foreground/50" strokeWidth={1.5} />
                <line x1={markerX} y1={4} x2={markerX} y2={H - 8} className={cn("stroke-2", peerPercentile >= 60 ? "stroke-success" : peerPercentile >= 40 ? "stroke-warning" : "stroke-destructive")} />
                <circle cx={markerX} cy={4} r={3} className={cn(peerPercentile >= 60 ? "fill-success" : peerPercentile >= 40 ? "fill-warning" : "fill-destructive")} />
                <text x={Math.min(Math.max(markerX, 18), W - 18)} y={H} textAnchor="middle" className="fill-current text-[9px] text-muted-foreground">You</text>
                <text x={topQuartileX + (W - topQuartileX) / 2} y={14} textAnchor="middle" className="fill-current text-[8px] text-success">Top 25%</text>
              </svg>
            );
          })()}
          <p className="text-[10px] text-muted-foreground">
            Methodology: percentile is a normal-distribution estimate against your industry's median ATS score; pass rate is banded from your score against common ATS filter thresholds. Both are estimates, not guarantees.
          </p>
        </div>
      )}

      {/* ── Interview Likelihood ─────────────────────────────────────────────── */}
      {interviewLikelihood && (
        <div className={cn(
          "rounded-2xl border p-5",
          interviewLikelihood.band === 'strong' ? "border-success/30 bg-success/5" :
          interviewLikelihood.band === 'moderate' ? "border-primary/30 bg-primary/5" :
          "border-destructive/30 bg-destructive/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-foreground" />
            <h4 className="font-semibold text-foreground text-sm">{t('freeResults.enterprise.interviewLikelihood', 'Interview Callback Likelihood')}</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-semibold capitalize",
              interviewLikelihood.band === 'strong' ? "bg-success/15 text-success" :
              interviewLikelihood.band === 'moderate' ? "bg-primary/15 text-primary" :
              "bg-destructive/15 text-destructive"
            )}>
              {interviewLikelihood.band.replace('_', ' ')}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
            <div
              className={cn(
                "h-full rounded-full",
                interviewLikelihood.band === 'strong' ? "bg-success" :
                interviewLikelihood.band === 'moderate' ? "bg-primary" : "bg-destructive"
              )}
              style={{ width: `${interviewLikelihood.composite}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Biggest factor:</span> {interviewLikelihood.topFactor}
          </p>
          <p className="text-[10px] text-muted-foreground mt-2">
            Methodology: weighted blend of ATS pass rate (45%), peer percentile (35%), and critical red flags (20%).
          </p>
        </div>
      )}

      {/* ── Competitor Silhouette ────────────────────────────────────────────── */}
      {competitorSilhouette && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-1">You vs. a Top-Quartile Candidate</h4>
          <p className="text-xs text-muted-foreground mb-3">
            What shortlisted {industry.replace(/_/g, ' ')} resumes typically show, next to {candidateName ? `${candidateName.split(' ')[0]}'s` : 'your'} resume today.
          </p>
          <div className="space-y-3">
            {([
              { label: 'Quantified bullets', them: competitorSilhouette.archetype.quantifiedBullets, you: competitorSilhouette.user.quantifiedBullets, max: 12 },
              { label: 'Leadership signals', them: competitorSilhouette.archetype.leadershipSignals, you: competitorSilhouette.user.leadershipSignals, max: 8 },
              { label: 'Keyword coverage %', them: competitorSilhouette.archetype.keywordCoveragePct, you: competitorSilhouette.user.keywordCoveragePct, max: 100 },
            ]).map((row, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground font-medium">{row.label}</span>
                  <span className="text-muted-foreground">You: <span className={cn("font-semibold", row.you >= row.them ? "text-success" : "text-destructive")}>{row.you}</span> · Top quartile: <span className="font-semibold text-foreground">{row.them}</span></span>
                </div>
                <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                  <div className="absolute h-full rounded-full bg-primary/80" style={{ width: `${Math.min((row.you / row.max) * 100, 100)}%` }} />
                  <div className="absolute h-full w-0.5 bg-foreground/70" style={{ left: `${Math.min((row.them / row.max) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Dark marker = top-quartile benchmark.</p>
        </div>
      )}

      {/* ── Skill Gap Heat Map ───────────────────────────────────────────────── */}
      {keywords.length > 0 && keywords.some(k => k.frequencyWeight != null) && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-3">Keyword Gap Heat Map</h4>
          <p className="text-xs text-muted-foreground mb-3">Bar width = how often this keyword appears in job postings for your role.</p>
          <div className="space-y-2">
            {keywords.map((kw, i) => {
              const w = kw.frequencyWeight ?? 1;
              const pct = w === 3 ? 100 : w === 2 ? 65 : 35;
              const color = w === 3 ? "bg-destructive" : w === 2 ? "bg-warning" : "bg-muted-foreground/50";
              const label = w === 3 ? "Very common" : w === 2 ? "Common" : "Occasional";
              const sectionBadge = kw.suggestedSection
                ? ({ summary: "Summary", experience: "Experience", skills: "Skills" })[kw.suggestedSection]
                : null;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{kw.keyword}</span>
                    <div className="flex items-center gap-1.5">
                      {sectionBadge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                          → {sectionBadge}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{label}</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Executive Scope Check — senior/exec resumes are judged on scope ── */}
      {executiveScopeCheck && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">Executive Scope Check</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-semibold",
              executiveScopeCheck.presentCount >= 4 ? "bg-success/10 text-success" :
              executiveScopeCheck.presentCount >= 2 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
            )}>
              {executiveScopeCheck.presentCount}/5 scope signals
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            At the {executiveScopeCheck.level} level, recruiters screen for scope evidence before anything else.
          </p>
          <div className="space-y-1.5">
            {([
              { label: "Team size", value: executiveScopeCheck.signals.teamSize },
              { label: "Budget / P&L ownership", value: executiveScopeCheck.signals.budgetOrPL },
              { label: "Quantified business impact", value: executiveScopeCheck.signals.revenueImpact },
              { label: "Board / governance exposure", value: executiveScopeCheck.signals.boardExposure ? "present" : null },
              { label: "Strategic-scope language", value: executiveScopeCheck.signals.strategicLanguage ? "present" : null },
            ]).map((row, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {row.value
                  ? <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                <span className="text-foreground">{row.label}</span>
                {row.value && row.value !== "present" && (
                  <span className="text-xs text-muted-foreground truncate">— "{row.value}"</span>
                )}
              </div>
            ))}
          </div>
          {executiveScopeCheck.missing.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              <span className="font-medium text-foreground">Add next:</span> {executiveScopeCheck.missing[0]}
            </p>
          )}
        </div>
      )}

      {/* ── Title-to-Level Mismatch ──────────────────────────────────────────── */}
      {titleLevelMismatch?.detected && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h4 className="font-semibold text-foreground text-sm">Title vs. Bullet Language Mismatch</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Your title signals <strong>{titleLevelMismatch.claimedLevel}</strong> but your bullets read like <strong>{titleLevelMismatch.bulletLevel}</strong> work.
          </p>
          {titleLevelMismatch.icVerbs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {titleLevelMismatch.icVerbs.map((v, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 line-through">{v}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-foreground/80">{titleLevelMismatch.tip}</p>
        </div>
      )}

      {/* ── Tone / Voice Audit ───────────────────────────────────────────────── */}
      {toneAudit && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="font-semibold text-foreground text-sm">Tone & Voice Audit</h4>
            <span className={cn(
              "ml-auto text-xs px-2 py-0.5 rounded-full font-semibold",
              toneAudit.verdict === 'active' ? "bg-success/10 text-success" : toneAudit.verdict === 'mixed' ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
            )}>
              {toneAudit.verdict === 'active' ? "Strong active voice" : toneAudit.verdict === 'mixed' ? "Mixed voice" : "Too passive"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/40 p-2">
              <p className="text-lg font-bold text-foreground">{toneAudit.activeCount}</p>
              <p className="text-[10px] text-muted-foreground">Active bullets</p>
            </div>
            <div className={cn("rounded-lg p-2", toneAudit.passiveCount > 3 ? "bg-destructive/10" : "bg-muted/40")}>
              <p className={cn("text-lg font-bold", toneAudit.passiveCount > 3 ? "text-destructive" : "text-foreground")}>{toneAudit.passiveCount}</p>
              <p className="text-[10px] text-muted-foreground">Passive phrases</p>
            </div>
            <div className={cn("rounded-lg p-2", toneAudit.firstPersonCount > 2 ? "bg-warning/10" : "bg-muted/40")}>
              <p className={cn("text-lg font-bold", toneAudit.firstPersonCount > 2 ? "text-warning" : "text-foreground")}>{toneAudit.firstPersonCount}</p>
              <p className="text-[10px] text-muted-foreground">"I / My" count</p>
            </div>
          </div>
          {toneAudit.firstPersonCount > 2 && (
            <p className="text-xs text-warning mt-2">Most resume guides recommend removing first-person pronouns — ATS and recruiters expect a third-person implied style.</p>
          )}
          {toneAudit.verdict === 'too_passive' && (
            <p className="text-xs text-destructive mt-2">Replace passive phrases ("was responsible for", "was involved in") with strong action verbs ("Led", "Built", "Drove").</p>
          )}
        </div>
      )}

      {/* ── Section Word Count Audit ─────────────────────────────────────────── */}
      {sectionWordCounts && Object.keys(sectionWordCounts).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-3">Section Length Audit</h4>
          <div className="space-y-3">
            {(["summary", "experience", "skills", "education"] as const).map((sec) => {
              const s = sectionWordCounts[sec];
              if (!s) return null;
              const pct = s.idealMax > 0 ? Math.min(100, Math.round((s.current / s.idealMax) * 100)) : 0;
              const color = s.verdict === 'ideal' ? "bg-success" : s.verdict === 'too_many' ? "bg-warning" : "bg-destructive";
              const badge = s.verdict === 'ideal' ? "text-success" : s.verdict === 'too_many' ? "text-warning" : "text-destructive";
              const label = s.verdict === 'ideal' ? "Good" : s.verdict === 'too_many' ? "Too long" : s.current === 0 ? "Missing" : "Too short";
              return (
                <div key={sec} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground capitalize font-medium">{sec}</span>
                    <span className="text-muted-foreground">{s.current} words <span className="text-muted-foreground/60">(target {s.idealMin}–{s.idealMax})</span></span>
                    <span className={cn("font-semibold", badge)}>{label}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ATS Parse Preview ────────────────────────────────────────────────── */}
      {atsParsedPreview && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h4 className="font-semibold text-foreground text-sm">ATS Parse Preview</h4>
            <span className="ml-auto text-xs text-muted-foreground">What the ATS actually reads</span>
          </div>
          <pre className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
            {atsParsedPreview}
          </pre>
          <p className="text-xs text-muted-foreground mt-2">Formatting (bold, columns, icons) is stripped. If your name, title, or key sections don't appear clearly here, an ATS may miss them.</p>
        </div>
      )}

      {/* ── Additional Rewrites ──────────────────────────────────────────────── */}
      {additionalRewrites && additionalRewrites.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <h4 className="font-semibold text-foreground text-sm">More Bullet Rewrites</h4>
          {additionalRewrites.map((rw, i) => (
            <div key={i} className="space-y-2">
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
                <p className="text-[10px] font-semibold text-destructive uppercase tracking-wide mb-1">Before</p>
                <p className="text-sm text-foreground italic">"{rw.before}"</p>
              </div>
              <div className="rounded-lg bg-success/5 border border-success/20 p-3">
                <p className="text-[10px] font-semibold text-success uppercase tracking-wide mb-1">After</p>
                <p className="text-sm leading-relaxed">
                  {diffWords(rw.before, rw.after).map((seg, j) => (
                    seg.type === 'removed'
                      ? <span key={j} className="text-destructive/70 line-through mr-1">{seg.text}</span>
                      : seg.type === 'added'
                        ? <span key={j} className="text-success font-medium bg-success/10 rounded px-0.5 mr-1">{seg.text}</span>
                        : <span key={j} className="text-foreground mr-1">{seg.text}</span>
                  ))}
                </p>
              </div>
              {rw.improvement && (
                <p className="text-xs text-muted-foreground px-1">
                  <span className="font-medium text-foreground">Why better:</span> {rw.improvement}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Format Grade Drivers ─────────────────────────────────────────────── */}
      {formatGradeDrivers && formatGradeDrivers.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-3">What's Driving Your Format Grade</h4>
          <div className="space-y-2">
            {formatGradeDrivers.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-2 h-2 rounded-full bg-warning shrink-0 mt-1.5" />
                <div>
                  <span className="text-sm text-foreground font-medium">{d.driver}</span>
                  {d.impact && <span className="text-xs text-muted-foreground ml-2">— {d.impact}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section Quality Signals ──────────────────────────────────────────── */}
      {sectionCheck?.sectionQuality && Object.keys(sectionCheck.sectionQuality).length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-3">Section Quality</h4>
          <div className="grid grid-cols-2 gap-2">
            {(["summary", "experience", "skills", "education"] as const).map((sec) => {
              const q = sectionCheck.sectionQuality?.[sec];
              if (!q) return null;
              const cfg = {
                strong: { color: "text-success", bg: "bg-success/10 border-success/20", dot: "bg-success" },
                adequate: { color: "text-primary", bg: "bg-primary/10 border-primary/20", dot: "bg-primary" },
                thin: { color: "text-warning", bg: "bg-warning/10 border-warning/20", dot: "bg-warning" },
                missing: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/20", dot: "bg-destructive" },
              }[q];
              return (
                <div key={sec} className={`flex items-center gap-2 rounded-lg border p-2 ${cfg.bg}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                  <div>
                    <p className="text-xs font-semibold text-foreground capitalize">{sec}</p>
                    <p className={`text-[10px] capitalize ${cfg.color}`}>{q}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recruiter First-Pass Summary ─────────────────────────────────────── */}
      {recruiterFirstPassSummary && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <User className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">How a Recruiter Sees You (6-Second Scan)</h4>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed italic">"{recruiterFirstPassSummary}"</p>
        </div>
      )}

      {/* ── Fix Roadmap ──────────────────────────────────────────────────────── */}
      {fixRoadmap && fixRoadmap.steps.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <ListChecks className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">
              {candidateName ? `${candidateName.split(' ')[0]}'s` : 'Your'} {fixRoadmap.totalMinutes}-Minute Fix Plan
            </h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Work top to bottom — ordered by points gained per minute. Finishing all steps takes you from {atsScoreEstimate} to ~{fixRoadmap.finalProjectedScore}.
          </p>
          <div className="space-y-2">
            {fixRoadmap.steps.map((s) => (
              <div key={s.order} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
                <div className="shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
                  {s.order}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-foreground">{s.step}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>⏱️ ~{s.minutes} min</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success font-semibold">+{s.scoreImpact} pts</span>
                    <span className="ml-auto">→ score ~{s.projectedScoreAfter}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Post-fix rescan loop — the return visit is where conversion happens */}
          <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
            <p className="text-xs text-foreground/80">
              Fixed these? <span className="font-semibold text-foreground">Rescan free</span> to confirm your new score.
            </p>
            <button
              onClick={() => { onForceReanalyze?.(); document.getElementById('free-results')?.scrollIntoView({ behavior: 'smooth' }); }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Rescan now
            </button>
          </div>
        </div>
      )}

      {/* ── Premium receipt — a REAL computed artifact, blurred at the gate ── */}
      {premiumTeaser && !diagnosticLayout && (
        <div className="rounded-2xl border border-primary/30 bg-card p-5 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-foreground text-sm">Your rewritten resume is already drafted</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            This isn't a template — it's built from your actual bullets. Here's the opening of one rewrite:
          </p>
          <div className="rounded-lg bg-success/5 border border-success/20 p-3 select-none">
            <p className="text-sm text-foreground font-medium">
              "{premiumTeaser.rewritePreview.split(' ').slice(0, 4).join(' ')} <span className="blur-[4px]">{premiumTeaser.rewritePreview.split(' ').slice(4).join(' ')} and the rest of this bullet</span>"
            </p>
          </div>
          <button
            onClick={() => handleUpgradeClick('premium_receipt')}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            Unlock all {premiumTeaser.totalRewritesAvailable}+ rewrites
          </button>
        </div>
      )}

      {/* ── Email me my report — first lead-capture touchpoint ──────────────── */}
      <EmailReportCapture payload={emailReportPayload} />

      {/* ── The Recruiter Panel — three personas, three verdicts ────────────── */}
      {recruiterPanel && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-1">The Recruiter Panel</h4>
          <p className="text-xs text-muted-foreground mb-3">
            Three people read your resume before anyone calls you. Here's what each one sees.
          </p>
          <div className="space-y-2.5">
            <div className={cn("rounded-xl border p-3", recruiterPanel.screener.wouldPass === false ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5")}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-foreground">⏱️ The 6-Second Screener</span>
                {recruiterPanel.screener.wouldPass != null && (
                  <span className={cn("ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold", recruiterPanel.screener.wouldPass ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive")}>
                    {recruiterPanel.screener.wouldPass ? "Survives the pile" : "At risk of the pile"}
                  </span>
                )}
              </div>
              <p className="text-sm text-foreground/90 italic">"{recruiterPanel.screener.verdict}"</p>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs font-bold text-foreground mb-1">🧐 The Skeptical Hiring Manager</p>
              <p className="text-sm text-foreground/90 italic">"{recruiterPanel.hiringManager.verdict}"</p>
              {recruiterPanel.hiringManager.biggestDoubt && (
                <p className="text-xs text-muted-foreground mt-1"><span className="font-medium text-foreground">Biggest doubt:</span> {recruiterPanel.hiringManager.biggestDoubt}</p>
              )}
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-bold text-foreground mb-1">💼 The HR / Level Screener</p>
              <p className="text-sm text-foreground/90 italic">"{recruiterPanel.hrScreener.verdict}"</p>
              {recruiterPanel.hrScreener.levelRead && (
                <p className="text-xs text-muted-foreground mt-1"><span className="font-medium text-foreground">Reads as:</span> {recruiterPanel.hrScreener.levelRead}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Questions your resume will trigger ──────────────────────────────── */}
      {resumeTriggeredQuestions && resumeTriggeredQuestions.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h4 className="font-semibold text-foreground text-sm mb-1">Questions Your Resume Will Trigger</h4>
          <p className="text-xs text-muted-foreground mb-3">
            These aren't generic interview prep — they're the questions THIS resume invites. Fix the trigger, or prepare the answer.
          </p>
          <div className="space-y-3">
            {resumeTriggeredQuestions.slice(0, 3).map((q, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-sm font-semibold text-foreground">“{q.question}”</p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  <span className="font-medium text-destructive">Triggered by:</span> {q.trigger}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-success">Prepare:</span> {q.howToPrepare}
                </p>
              </div>
            ))}
          </div>
          {!diagnosticLayout && (
          <button
            onClick={() => handleUpgradeClick('triggered_questions')}
            className="mt-3 w-full text-center text-xs text-primary hover:underline"
          >
            Get full answers and mock-interview practice with the Interview Coach →
          </button>
          )}
        </div>
      )}

      {/* ── Next Best Action ─────────────────────────────────────────────────── */}
      {nextBestAction && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-primary" />
            <h4 className="font-semibold text-primary text-sm uppercase tracking-wide">{t('freeResults.enterprise.nextActionLabel', 'Your #1 Next Action')}</h4>
          </div>
          <p className="text-base font-semibold text-foreground mb-1">{nextBestAction.action}</p>
          {nextBestAction.why && (
            <p className="text-xs text-muted-foreground mb-2">{nextBestAction.why}</p>
          )}
          {nextBestAction.estimatedImpact && (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              Est. impact: {nextBestAction.estimatedImpact}
            </span>
          )}
        </div>
      )}

      {/* Shareable score card */}
      <div className="mb-5">
        <ShareScoreCard
          atsScore={atsScoreEstimate}
          industry={effectiveIndustry}
          percentile={peerPercentile ?? undefined}
          previousScore={(() => {
            // Same-candidate guard as the delta banner: a household member's
            // earlier scan must not produce a bogus before/after card.
            const prev = getPreviousScan();
            return prev && (prev.candidateName ?? null) === (candidateName ?? null) ? prev.atsScore : undefined;
          })()}
        />
      </div>

      {/* Credibility: no invented testimonials. Trust here comes from the
          audit trail and verifiable checks above, not manufactured quotes. */}

      {/* Outcome loop + version saving: the report's data flywheel */}
      {reportMeta?.reportId && <ScanOutcomeAsk reportId={reportMeta.reportId} />}
      {resumeText && resumeText.trim().length > 100 && (
        <SaveResumeVersion resumeText={resumeText} score={atsScoreEstimate} reportId={reportMeta?.reportId} />
      )}

      {/* Diagnosis → treatment: hand the builder this resume plus every
          rewrite from the report. sessionStorage carries the payload; the
          builder applies matching bullet rewrites and shows missing keywords. */}
      {resumeText && resumeText.trim().length > 100 && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 mb-6">
          <p className="text-sm font-semibold text-foreground mb-0.5">Turn this diagnosis into a finished resume</p>
          <p className="text-xs text-muted-foreground mb-3">
            Open the free builder with your resume loaded and this report's bullet rewrites already applied —
            then export a cleanly typeset PDF or DOCX.
          </p>
          <Link
            to="/builder"
            onClick={() => {
              try {
                sessionStorage.setItem('rb_resume_text', resumeText);
                const rewrites = [
                  ...(weakestBullets ?? []).map((b) => ({ before: b.original, after: b.rewrite })),
                  ...(additionalRewrites ?? []).map((r) => ({ before: r.before, after: r.after })),
                ].filter((r) => r.before && r.after);
                sessionStorage.setItem('rb_scan_fixes', JSON.stringify({
                  rewrites,
                  keywords: (keywords ?? []).slice(0, 12).map((k) => k.keyword),
                  reportId: reportMeta?.reportId ?? null,
                }));
              } catch { /* session storage unavailable — builder still opens */ }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Open in builder with fixes applied →
          </Link>
        </div>
      )}

      {/* Diagnostic layout: all offers live here, after the findings end */}
      {diagnosticLayout && (
        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Next steps</p>
          <h3 className="font-semibold text-foreground mb-1">If you want help executing the fixes above</h3>
          <p className="text-xs text-muted-foreground mb-4">
            The diagnosis above is complete and free. These are the paid tools that do the work for you — no pressure, the fix plan stands on its own.
          </p>
          <div className="space-y-2.5">
            <button onClick={() => handleUpgradeClick('next_steps_full_analysis')} className="w-full flex items-center justify-between rounded-xl border border-border p-3.5 text-left hover:border-primary/50 transition-colors">
              <span>
                <span className="block text-sm font-medium text-foreground">Full Analysis — every bullet rewritten</span>
                <span className="block text-xs text-muted-foreground">Applies the fixes from this report to your actual resume content.</span>
              </span>
              <span className="text-sm font-semibold text-primary shrink-0 ml-3">{priceDisplay}</span>
            </button>
            <button onClick={() => { trackButtonClick('interviewCoach', 'next_steps_interview_coach'); purchaseProductDirect('interviewCoach', { ctaSection: 'next_steps' }); }} className="w-full flex items-center justify-between rounded-xl border border-border p-3.5 text-left hover:border-primary/50 transition-colors">
              <span>
                <span className="block text-sm font-medium text-foreground">Interview Coach — answers to the questions above</span>
                <span className="block text-xs text-muted-foreground">Preparation for the exact questions this resume will trigger.</span>
              </span>
              <span className="text-sm font-semibold text-primary shrink-0 ml-3">$5</span>
            </button>
            <Link to="/pricing" className="block text-center text-xs text-muted-foreground hover:text-foreground pt-1">
              See everything, including the all-access plan →
            </Link>
          </div>
        </div>
      )}

      {/* Score-Gated Premium Insights — pure upsell; moved to Next Steps in diagnostic */}
      {!diagnosticLayout && (
      <div className="space-y-4 mb-6">
        <LockedPremiumInsight
          title={t('freeResults.bulletRewriteSection.title')}
          description={t('freeResults.bulletRewriteSection.description')}
          previewLines={
            realWeakBullets && realWeakBullets.weakCount > 0
              ? [
                  ...realWeakBullets.examples.map((bullet) => {
                    const truncated = bullet.length > 100 ? `${bullet.slice(0, 100)}...` : bullet;
                    return t('freeResults.lockedInsights.bulletWithData1', { bullet: truncated });
                  }),
                  t('freeResults.lockedInsights.bulletWithData2', { weak: realWeakBullets.weakCount, total: realWeakBullets.totalCount }),
                  t('freeResults.lockedInsights.bulletWithData3'),
                ]
              : [
                  t('freeResults.lockedInsights.bulletLine1'),
                  t('freeResults.lockedInsights.bulletLine2'),
                  t('freeResults.lockedInsights.bulletLine3'),
                  t('freeResults.lockedInsights.bulletLine4'),
                ]
          }
          onUnlock={() => handleUpgradeClick('locked_bullet_rewrites')}
          isLoading={isLoading}
          variant="highlight"
        />

        <LockedPremiumInsight
          title={t('freeResults.keywordGapSection.title')}
          description={
            realKeywordGapStats && realKeywordGapStats.totalMissing > 0
              ? t('freeResults.lockedInsights.kwDescWithStats', { count: realKeywordGapStats.totalMissing, industry: effectiveIndustry.replace(/_/g, ' ') })
              : realKeywordGapStats
                ? t('freeResults.lockedInsights.kwDescGood', { industry: effectiveIndustry.replace(/_/g, ' ') })
                : t('freeResults.lockedInsights.kwDescDefault', { industry: effectiveIndustry.replace(/_/g, ' ') })
          }
          previewLines={
            realKeywordGapStats && realKeywordGapStats.totalMissing > 0
              ? [
                  t('freeResults.lockedInsights.kwHard', { count: realKeywordGapStats.criticalMissing, plural: realKeywordGapStats.criticalMissing === 1 ? '' : 's' }),
                  ...(realKeywordGapStats.certifications > 0
                    ? [t('freeResults.lockedInsights.kwCerts', { count: realKeywordGapStats.certifications, plural: realKeywordGapStats.certifications === 1 ? '' : 's' })]
                    : []),
                  ...(realKeywordGapStats.tools > 0
                    ? [t('freeResults.lockedInsights.kwTools', { count: realKeywordGapStats.tools, plural: realKeywordGapStats.tools === 1 ? '' : 's' })]
                    : []),
                  ...(realKeywordGapStats.methodology > 0
                    ? [t('freeResults.lockedInsights.kwMethodology', { count: realKeywordGapStats.methodology, plural: realKeywordGapStats.methodology === 1 ? '' : 's' })]
                    : []),
                ]
              : realKeywordGapStats
                ? [
                    t('freeResults.lockedInsights.kwPlacement'),
                    t('freeResults.lockedInsights.kwVerbs'),
                    t('freeResults.lockedInsights.kwDensity'),
                  ]
                : [
                    t('freeResults.lockedInsights.kwHardDefault'),
                    t('freeResults.lockedInsights.kwCertsDefault'),
                    t('freeResults.lockedInsights.kwVerbsDefault'),
                    t('freeResults.lockedInsights.kwMethodDefault'),
                  ]
          }
          onUnlock={() => handleUpgradeClick('locked_keyword_gap')}
          isLoading={isLoading}
        />

        <LockedPremiumInsight
          title={t('freeResults.careerStrategySection.title')}
          description={
            currentRole
              ? t('freeResults.lockedInsights.careerDescWithRole', { role: currentRole })
              : t('freeResults.lockedInsights.careerDescDefault', { industry: effectiveIndustry.replace(/_/g, ' ') })
          }
          previewLines={[
            t('freeResults.lockedInsights.careerSalary'),
            t('freeResults.lockedInsights.careerNextRole'),
            t('freeResults.lockedInsights.careerInterview'),
            t('freeResults.lockedInsights.careerBrand'),
          ]}
          onUnlock={() => handleUpgradeClick('locked_career_strategy')}
          isLoading={isLoading}
        />
      </div>
      )}

      {/* Detailed Section Check */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <LayoutList className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeResults.sectionChecklistTitle')}</h4>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: t('freeResults.sectionLabels.contact'), has: sectionCheck.hasContact },
            { label: t('freeResults.sectionLabels.summary'), has: sectionCheck.hasSummary },
            { label: t('freeResults.sectionLabels.experience'), has: sectionCheck.hasExperience },
            { label: t('freeResults.sectionLabels.education'), has: sectionCheck.hasEducation },
            { label: t('freeResults.sectionLabels.skills'), has: sectionCheck.hasSkills },
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

      </div> {/* end section-insights */}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* SECTION: Upgrade / Next Steps */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div id="section-upgrade">

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
                <span className="text-xs font-bold uppercase tracking-wider text-primary">{t('freeResults.premiumCta.package')}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary font-medium">
                  {isLocalCurrency ? `$${PRODUCTS.premiumPackage.priceUsd} ≈ ${formatPrice(PRODUCTS.premiumPackage.priceUsd)}` : `$${PRODUCTS.premiumPackage.priceUsd}`}
                </span>
              </div>
            </div>
            <h4 className="text-xl font-bold text-foreground mb-2">
              {t('freeResults.premiumCta.title')}
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              {t('freeResults.premiumCta.subtitle')}
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">{t('freeResults.premiumCta.aiResume')}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">{t('freeResults.premiumCta.customCoverLetter')}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-success/20">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <span className="text-xs text-foreground">{t('freeResults.premiumCta.pdfDownload')}</span>
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
              {t('freeResults.premiumCta.seeAll')} <ArrowRight className="w-3 h-3" />
            </Link>
            <p className="text-xs text-muted-foreground mt-3">
              {t('freeResults.premiumCta.footnote')}
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

      {/* Gated "hidden issues" card — shows that more problems exist but gates the detail */}
      {redFlags.length >= 1 && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 mb-5 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold text-foreground">
              {redFlags.length + 2} more issues detected in {candidateName ? `${candidateName.split(' ')[0]}'s` : 'your'} resume
            </h4>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold">
              Premium Only
            </span>
          </div>
          {/* Blurred fake issue rows */}
          <div className="space-y-2 select-none pointer-events-none">
            {[
              { label: "ATS Rejection Trigger", detail: "A formatting pattern on line 3 of your experience section causes 4 major ATS systems to drop your resume before human review." },
              { label: "Keyword Density Issue", detail: "Your top 2 skills appear only once — most shortlisted candidates in your industry mention them 3-5 times across different sections." },
              { label: "Experience Gap Signal", detail: "A 7-month gap between your last two roles is flagged by applicant tracking systems without a framing fix." },
            ].map((item, i) => (
              <div key={i} className="rounded-lg border border-destructive/15 bg-background/60 p-3 blur-[3px]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Unlock overlay */}
          <div className="absolute inset-x-0 bottom-0 top-16 flex flex-col items-center justify-end pb-5 bg-gradient-to-t from-destructive/10 via-destructive/5 to-transparent">
            <p className="text-sm font-medium text-foreground mb-3 text-center px-4">
              These issues are specific to your resume — not generic tips.
            </p>
            <button
              onClick={() => handleUpgradeClick('hidden_issues_gate')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-destructive text-white font-semibold text-sm shadow-lg hover:bg-destructive/90 transition-colors"
            >
              <Lock className="w-4 h-4" />
              Unlock Full Analysis
            </button>
          </div>
        </div>
      )}

      {/* Missing Keywords - Priority sorted with impact indicators */}
      <KeywordsSection
        keywords={keywords}
        industry={effectiveIndustry}
        keywordFixButton={<KeywordFixButton variant="control" section="keyword_suggestions" />}
        keywordFixHeadline={getProductCtaCopy('control', t, formatPrice, isLocalCurrency).keywordFix.headline}
        keywordFixPrice={isLocalCurrency ? `$${PRODUCTS.basicKeywordFix.priceUsd} ≈ ${formatPrice(PRODUCTS.basicKeywordFix.priceUsd)}` : `$${PRODUCTS.basicKeywordFix.priceUsd}`}
      />

      {/* ── GATED KEYWORDS (improvement #8) — blurred pills showing there's more ── */}
      {gatedKeywords && gatedKeywords.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 mb-5 relative overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h4 className="font-semibold text-foreground">+ {gatedKeywords.length} more high-priority keywords</h4>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These appear in 50–80% of job postings for your role — the top-quartile candidates have all of them.
          </p>
          <div className="flex flex-wrap gap-2 mb-4 select-none pointer-events-none">
            {gatedKeywords.slice(0, 6).map((kw, i) => (
              <span
                key={i}
                className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium blur-[5px]"
                aria-hidden="true"
              >
                {kw.keyword}
              </span>
            ))}
          </div>
          <button
            onClick={() => handleUpgradeClick('gated_keywords')}
            className="w-full text-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            Unlock all {gatedKeywords.length} keywords →
          </button>
        </div>
      )}

      {/* Email Capture */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">{t('freeScan.emailCapture.title')}</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t('freeResults.emailCapture.joinMessage')}
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
        <p className="text-xs text-muted-foreground mt-2">{t('freeResults.emailCapture.noSpam')}</p>
      </div>

      {/* Cover Letter CTA - requires job description */}
      <div className="rounded-2xl bg-gradient-to-br from-accent/10 via-primary/5 to-accent/10 border border-accent/30 p-5 mb-5">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-accent/20 shrink-0">
            <FileText className="w-5 h-5 text-accent-foreground" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-bold text-foreground">{t('freeResults.coverLetterCta.title')}</h4>
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent-foreground font-medium">
                {isLocalCurrency ? `$${PRODUCTS.coverLetter.priceUsd} ≈ ${formatPrice(PRODUCTS.coverLetter.priceUsd)}` : `$${PRODUCTS.coverLetter.priceUsd}`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {getProductCtaCopy('control', t, formatPrice, isLocalCurrency).coverLetter.description}
            </p>
            <div className="flex flex-wrap gap-2 mb-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> {t('freeResults.coverLetterCta.personalizedOpening')}</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> {t('freeResults.coverLetterCta.skillsHighlighted')}</span>
              <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> {t('freeResults.coverLetterCta.instantDownload')}</span>
            </div>
            <CoverLetterButton hasJobDescription={uploadedJobs.length > 0} variant="control" section="cover_letter_cta" />
          </div>
        </div>
      </div>

      {/* $5 Add-Ons Section — with live "preview from your résumé" now that the scan gives us the text + industry */}
      <AddOnsShowcase variant="compact" className="mb-5" resumeText={resumeText} industry={industry} />
      <div className="rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-primary/80 border-2 border-primary p-6 mb-5 relative overflow-hidden shadow-xl shadow-primary/20">
        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-primary-foreground/80">{t('freeResults.bestValue')}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 text-primary-foreground font-bold">{PRODUCTS.premiumPackage.savings}</span>
          </div>
          <h3 className="text-2xl font-bold text-primary-foreground mb-2">
            {getProductCtaCopy('control', t, formatPrice, isLocalCurrency).premiumPackage.headline}
          </h3>
          <p className="text-sm text-primary-foreground/80 mb-4">
            {t('freeResults.premiumIncludesDetail', { subtext: getProductCtaCopy('control', t, formatPrice, isLocalCurrency).premiumPackage.subtext })}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              t('freeResults.premiumFeatures.completeAtsAnalysis'),
              t('freeResults.premiumFeatures.aiRewrittenResume'),
              t('freeResults.premiumFeatures.customCoverLetter'),
              t('freeResults.premiumFeatures.beforeAfterComparison'),
              t('freeResults.premiumFeatures.keywordOptimization'),
              t('freeResults.premiumFeatures.priorityProcessing')
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
          <h4 className="font-medium text-muted-foreground">{t('freeResults.unlockWithFullAnalysis')}</h4>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            t('freeResults.keywordFixFeatures.fullAtsBreakdown'),
            t('freeResults.keywordFixFeatures.bulletPointRewrites'),
            t('freeResults.keywordFixFeatures.redFlagFixes'),
            t('freeResults.keywordFixFeatures.linkedinOptimization'),
            t('freeResults.keywordFixFeatures.actionVerbReplacements'),
            t('freeResults.keywordFixFeatures.quantificationSuggestions'),
            t('freeResults.keywordFixFeatures.skillsGapAnalysis'),
            t('freeResults.keywordFixFeatures.industryInsights'),
            t('freeResults.keywordFixFeatures.summaryRewrites'),
            t('freeResults.keywordFixFeatures.prioritizedActionPlan')
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
            <h4 className="font-medium text-foreground">{t('freeResults.wantToCompareFor')} <span className="text-primary">{uploadedJobs[0]?.title}</span> {t('freeResults.atCompany')} <span className="text-primary">{uploadedJobs[0]?.company}</span>?</h4>
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
                <span className="truncate max-w-[180px]">{t('freeResults.getJobSpecificAnalysis')}</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-success" />
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            {t('freeResults.personalizedInsightsForRole')}
          </p>
        </div>
      )}

      {/* Final CTA */}
      <div className="text-center p-6 rounded-2xl bg-gradient-to-br from-primary/10 via-background to-primary/5 border border-primary/20">
        {/* Social proof */}
        {scanCountData && scanCountData.inflatedCount > 0 && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mb-3">
            <div className="flex -space-x-1">
              {['bg-blue-400','bg-green-400','bg-purple-400'].map((c,i) => (
                <div key={i} className={`w-5 h-5 rounded-full ${c} border-2 border-background`} />
              ))}
            </div>
            <span>{t('freeResults.cta.socialProof', { count: scanCountData.inflatedCount })}</span>
          </div>
        )}

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-success/10 text-success text-xs font-medium mb-3">
          <CheckCircle2 className="w-3 h-3" />
          {t('freeResults.oneTimePaymentInstantAccess')}
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
        {/* Urgency */}
        <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
          <span>⏱</span>
          {t('freeResults.cta.resultsExpiry', { hours: Math.max(0, 48 - Math.floor((Date.now() - scanTimestamp) / 3600000)) })}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="text-success font-medium">{t('freeResults.oneInterviewPaidForItself', { price: priceDisplay })}</span>
        </p>
      </div>

      </div> {/* end section-upgrade */}
    </div>
    </TooltipProvider>
  );
}
