import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { useSearchParams, Link } from "react-router-dom";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { useFunnelTracking } from "@/hooks/use-funnel-tracking";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { AnalysisPreview } from "@/components/AnalysisPreview";
import { SocialProof } from "@/components/SocialProof";
import { LiveScanStats } from "@/components/LiveScanStats";
import { Footer } from "@/components/Footer";
import { FAQ } from "@/components/FAQ";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ValueComparison } from "@/components/ValueComparison";
// The report UI (~4,300 lines plus chart/diff deps) only renders after a scan
// completes — keeping it out of the landing bundle cuts first-paint JS for the
// visitors most likely to bounce. Same for the post-scan modals below.
const FreeKeywordResults = lazy(() =>
  import("@/components/FreeKeywordResults").then((m) => ({ default: m.FreeKeywordResults }))
);
import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { FinalCTA } from "@/components/FinalCTA";
const RateLimitUpsell = lazy(() =>
  import("@/components/RateLimitUpsell").then((m) => ({ default: m.RateLimitUpsell }))
);
const TailoredResumeModal = lazy(() =>
  import("@/components/TailoredResumeModal").then((m) => ({ default: m.TailoredResumeModal }))
);
import { ResumeLanguageSuggestion } from "@/components/ResumeLanguageSuggestion";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { supabase as supabaseClient } from "@/integrations/supabase/client";
const ProductSelectionModal = lazy(() =>
  import("@/components/ProductSelectionModal").then((m) => ({ default: m.ProductSelectionModal }))
);

import { LazySection } from "@/components/LazySection";

import { type JobEntry } from "@/components/JobSelector";

import { HowItWorks } from "@/components/HowItWorks";
import { MiniPricingCards } from "@/components/MiniPricingCards";
import { TrustIndicators } from "@/components/TrustIndicators";
import { WhatYouGetSection } from "@/components/WhatYouGetSection";
import { WhyNotChatGPT } from "@/components/WhyNotChatGPT";

const ScoreBasedPackageRecommendation = lazy(() =>
  import("@/components/ScoreBasedPackageRecommendation").then((m) => ({ default: m.ScoreBasedPackageRecommendation }))
);
import { FloatingUploadButton, FloatingSeeReportButton } from "@/components/FloatingUploadButton";
import { CheckoutOverlay, type CheckoutStep } from "@/components/CheckoutOverlay";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { supabase } from "@/integrations/supabase/client";
import { resilientCallers, callEdgeFunctionWithRetry } from "@/lib/resilient-edge-function";
import { parseEdgeFunctionError } from "@/lib/edge-function-errors";
import { 
  cleanupExpiredResumeData, 
  setResumeData, 
  removeResumeData, 
  setCheckoutRedirect,
  setupUnloadCleanup 
} from "@/hooks/use-resume-storage";
import {
  saveResumeToSession,
  getResumeFromSession,
  clearResumeSession,
  hasResumeInSession,
  setMultiColumnDetectedInSession
} from "@/hooks/use-session-resume";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useErrorTracking } from "@/hooks/use-error-tracking";
import { useAffiliateTracking, getStoredReferralCode } from "@/hooks/use-affiliate-auth";
import { useStreamingScan, type StreamProgress, clearAllClientScanCaches } from "@/hooks/use-streaming-scan";
import { useScanPrefetch } from "@/hooks/use-scan-prefetch";
const ScanFeedback = lazy(() =>
  import("@/components/ScanFeedback").then((m) => ({ default: m.ScanFeedback }))
);
const LinkedInInsights = lazy(() =>
  import("@/components/LinkedInInsights").then((m) => ({ default: m.LinkedInInsights }))
);

interface FreeKeywordResult {
  detectedLanguage?: { code: string; name: string } | null;
  candidateName?: string | null;
  currentRole?: string;
  industry: string;
  atsScoreEstimate: number;
  industryScoreInsight?: {
    weightsApplied: string;
    strongestArea: string;
    weakestArea: string;
    industryMustHaves: { item: string; present: boolean }[];
  };
  formatGrade: string;
  formatIssue: string;
  resumeLength: { currentPages: number; recommendedPages: number; verdict: "too_short" | "just_right" | "too_long" };
  wordCount?: { current: number; idealMin: number; idealMax: number; verdict: "too_few" | "ideal" | "too_many" };
  experienceLevel?: { level: "entry" | "mid" | "senior" | "executive"; yearsEstimate: string };
  sectionCheck?: { hasContact: boolean; hasSummary: boolean; hasExperience: boolean; hasEducation: boolean; hasSkills: boolean; missingSections: string[]; sectionQuality?: { summary?: "strong" | "adequate" | "thin" | "missing"; experience?: "strong" | "adequate" | "thin" | "missing"; skills?: "strong" | "adequate" | "thin" | "missing"; education?: "strong" | "adequate" | "thin" | "missing" } };
  contactInfo?: { hasEmail: boolean; hasPhone: boolean; hasLinkedIn: boolean; missingItems: string[] };
  topStrength?: { title: string; description: string };
  quantificationScore?: { score: number; verdict: "weak" | "average" | "strong"; tip: string };
  actionVerbGrade?: { grade: string; issue: string };
  readabilityScore?: { score: number; verdict: "hard_to_read" | "readable" | "easy_to_scan"; issue: string };
  bulletImpactScore?: { score: number; verdict: "responsibility_heavy" | "balanced" | "achievement_focused"; tip: string };
  keywordDensity?: { level: "sparse" | "moderate" | "dense"; explanation: string };
  improvementPotential?: { level: "low" | "medium" | "high"; estimatedScoreIncrease: number; topPriority: string };
  redFlags: { issue: string; impact: string; severity?: "critical" | "moderate" | "minor" }[];
  keywords: { keyword: string; reason: string; frequencyWeight?: number; suggestedSection?: 'summary' | 'experience' | 'skills' }[];
  topSkipReasons?: string[];
  powerWords?: Array<string | { word: string; why: string }>;
  weakPhrases?: { phrase: string; suggestion: string }[];
  timelineAnalysis?: { avgTenure: string; progression: "stagnant" | "steady" | "rapid" | "unclear"; hasGaps: boolean; gapNote?: string; totalYears: string };
  industryBenchmark?: { industryAvg: number; comparison: "below" | "at" | "above"; percentile: string };
  quickWins?: { fix: string; timeEstimate: string; impact: "low" | "medium" | "high"; scoreImpact?: number; category?: string }[];
  sampleRewrite?: { before: string; after: string; improvement: string };
  careerSituation?: {
    situation: "career_changer" | "returning_to_workforce" | "military_transition" | "recent_grad" | "standard";
    confidence: "high" | "medium" | "low";
    indicators: string[];
    tailoredAdvice: { tip: string; priority: "critical" | "important" | "helpful"; example?: string }[];
    situationSummary: string;
  };
  // Job matching fields (when job description is provided)
  jobMatchScore?: number;
  jobMatchGrade?: "A" | "B" | "C" | "D";
  matchingSkills?: string[];
  missingSkills?: string[];
  missingSkillsDetailed?: {
    skill: string;
    category: "hard_skill" | "soft_skill" | "tool" | "certification" | "methodology";
    importance: "critical" | "important" | "nice_to_have";
    isImplicit: boolean;
    fixSuggestion: string;
  }[];
  experienceFit?: "underqualified" | "good_fit" | "overqualified";
  titleAlignment?: "poor" | "partial" | "strong";
  jobMatchSummary?: string;
  applicationRecommendation?: {
    recommendation: "strong_apply" | "apply_with_changes" | "apply_as_stretch" | "do_not_apply";
    reasoning: string;
    confidence: "high" | "medium" | "low";
  };
  skillGapActions?: {
    action: string;
    priority: "must_have" | "should_have" | "nice_to_have";
    timeframe: string;
  }[];
  competitiveAssessment?: {
    likelyPosition: "top_candidate" | "competitive" | "middle_of_pack" | "unlikely_to_advance";
    strengthVsField: string;
    weaknessVsField: string;
  };
  formatRecommendation?: {
    recommendedStyle: "traditional" | "modern" | "creative" | "hybrid";
    layoutAdvice: {
      columns: "one_column" | "two_column";
      useColor: boolean;
      visualElements: "minimal" | "moderate" | "rich";
      rationale: string;
    };
    industryNorms: { norm: string; importance: "must_have" | "recommended" | "optional" }[];
    avoidList: string[];
    currentFormatAssessment: {
      isAppropriate: boolean;
      mainIssue: string;
      quickFix: string;
    };
    templateSuggestion: string;
  };
  personalizedCareerInsights?: {
    suggestedHeadline: string;
    nextRoleSuggestions: { title: string; fit: "natural_progression" | "lateral_move" | "stretch_goal"; gapToClose: string }[];
    uniqueValue: string;
    interviewTalkingPoints: { achievement: string; storyAngle: string }[];
    hiddenStrengths: string[];
    personalBrand: { currentBrand: string; idealBrand: string; brandGap: string };
    salaryInsight: { estimatedRange: string; marketPosition: "below_market" | "at_market" | "above_market"; leveragePoints: string[] };
    personalizedEncouragement: string;
  };
  // Enhanced analysis fields (new)
  resumeType?: {
    type: 'chronological' | 'executive_summary' | 'ats_optimized' | 'outreach_referral' | 'hybrid';
    label: string;
    description: string;
    atsRelevance: 'high' | 'medium' | 'low';
    scoringAdjustment: string;
  };
  seniorityLevel?: string;
  dualScore?: {
    atsCompatibility: number;
    recruiterImpact: number;
    atsNote: string;
    recruiterNote: string;
  };
  calibratedLanguage?: {
    headline: string;
    overallTone: 'warning' | 'optimization' | 'praise';
    scoreContext: string;
  };
  usageRecommendations?: {
    channel: string;
    suitability: 'excellent' | 'good' | 'limited' | 'not_recommended';
    note: string;
  }[];
  credibilityIssues?: {
    type: 'date_inconsistency' | 'timeline_overlap' | 'impossible_timeline' | 'gap';
    severity: 'high' | 'medium' | 'low';
    description: string;
    location?: string;
  }[];
  eliteSignals?: {
    type: 'brand_company' | 'large_deal' | 'founding_role' | 'quota_consistency' | 'career_progression';
    signal: string;
    strength: 'high' | 'medium';
  }[];
  contentLocations?: {
    quota?: {
      exists: boolean;
      locations: string[];
      suggestion: string;
    };
    metrics?: {
      exists: boolean;
      locations: string[];
      suggestion: string;
    };
  };
  industryDetection?: {
    detected: string;
    confidence: 'high' | 'medium' | 'low';
    signals: string[];
    aiSuggested?: string;
    detectedRole?: string | null;
    seniorityLevel?: string;
    yearsEstimate?: string | null;
    alternativeIndustries?: string[];
  };
  // Pre-detected weak bullets — quoted directly from the resume
  weakBulletsDetected?: { text: string; role: string; reason: string }[];
  unquantifiedBulletsDetected?: { text: string; role: string }[];
  bulletQuantRate?: number;
  projectedScore?: number | null;
  // Market intelligence
  marketIntelligence?: {
    country: string;
    countryName: string;
    countrySource: string;
    hotSkills: string[];
    risingKeywords: string[];
    cvNorms: string[];
    salaryContext: string | null;
    marketSummary: string;
  };
  skillsRecency?: {
    agingSkills: string[];
    freshSkills: string[];
    freshnessScore: number;
    hasAgingSignals: boolean;
  };
  careerTrajectory?: {
    trajectory: string;
    promotionCount: number;
    industryTransitionDetected: boolean;
    fromIndustry: string | null;
    progressionSummary: string;
  };
  atsSystem?: { system: string; name: string; parsingStrength: string } | null;
  competitiveGap?: {
    missingHighFrequency: string[];
    presentHighFrequency: string[];
    gapScore: number;
  };
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
  nextBestAction?: { action: string; why: string; estimatedImpact: string } | null;
  recruiterFirstPassSummary?: string | null;
  formatGradeDrivers?: Array<{ driver: string; impact: string }>;
  // 10 new reporting improvements (batch 2)
  atsParsedPreview?: string;
  peerPercentile?: number;
  applicationPassRate?: number;
  titleLevelMismatch?: { detected: boolean; claimedLevel: string; bulletLevel: string; icVerbs: string[]; tip: string } | null;
  toneAudit?: { passiveCount: number; activeCount: number; firstPersonCount: number; passiveRatio: number; verdict: 'too_passive' | 'mixed' | 'active' };
  sectionWordCounts?: Record<string, { current: number; idealMin: number; idealMax: number; verdict: 'too_few' | 'ideal' | 'too_many' }>;
  // Personalization & coverage batch
  subIndustry?: { id: string; label: string; matchedSignals: string[] } | null;
  jdTargetIndustry?: string | null;
  industryBlend?: { primary: string; secondary: string; primaryPct: number; secondaryPct: number } | null;
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
  reportVerdict?: string | null;
  dualIndustryComparison?: {
    primary: { industry: string; score: number; keywordCoveragePct: number; benchmarkMedian: number };
    secondary: { industry: string; score: number; keywordCoveragePct: number; benchmarkMedian: number };
  } | null;
  premiumTeaser?: { rewritePreview: string; totalRewritesAvailable: number } | null;
  reportCompleteness?: number;
  partialResults?: boolean;
  parseQuality?: { verdict: 'good' | 'fair' | 'poor'; wordCount: number; issues: string[] };
  // Emitted by the scan backend but previously never declared here NOR mapped
  // below, so the cards that read them stayed permanently dark (caught only
  // once the real `tsc -p tsconfig.app.json` gate was run).
  countryStandards?: import("@/components/ReportInsightCards").CountryStandardsData | null;
  platformProfileDetected?: { signals: string[] } | null;
  // atsCompatibility has no backend source yet ({overallRating,bestFor,worstFor}
  // is emitted by nothing); declared so it type-checks — the card fails safe to
  // hidden until a producer exists.
  atsCompatibility?: { overallRating: string; topIssue?: string; bestFor?: string; worstFor?: string } | null;
  executiveScopeCheck?: {
    level: string;
    signals: { teamSize: string | null; budgetOrPL: string | null; revenueImpact: string | null; boardExposure: boolean; strategicLanguage: boolean };
    presentCount: number;
    missing: string[];
  } | null;
  resumeTriggeredQuestions?: Array<{ question: string; trigger: string; howToPrepare: string }>;
  recruiterPanel?: {
    screener: { verdict: string; wouldPass?: boolean };
    hiringManager: { verdict: string; biggestDoubt?: string };
    hrScreener: { verdict: string; levelRead?: string };
  } | null;
  weakestBullets?: Array<{ original: string; grade: string; issues: string[]; rewrite: string }>;
  careerChangeBridge?: {
    fromField: string; toField: string; carryOver: string[];
    needsReframing: Array<{ current: string; reframed: string }>;
    gapToClose: string;
  } | null;
  scoreAudit?: { total: number; items: Array<{ label: string; earned: number; possible: number; detail: string }> } | null;
  benchmarkIndustry?: string | null;
  industryNeedsConfirmation?: boolean;
  industryTransition?: { historical: string; recent: string } | null;
  freelanceGuidance?: {
    positioning: string;
    projectsAsExperience: Array<{ project: string; presentAs: string }>;
    employerTransition?: string;
  } | null;
  realBenchmark?: { n: number; median: number; p25: number; p75: number; industry: string } | null;
  industrySpecificChecks?: { industry: string; items: Array<{ label: string; present: boolean; note: string }> } | null;
  reportMeta?: { reportId: string; engineVersion: string; generatedAt: string; industry: string; industryConfidence: string; detectionSource?: string; benchmarkSource: string } | null;
  scoreBand?: { low: number; high: number } | null;
  keywordSource?: { source: 'job_description' | 'onet' | 'model'; occupation?: string; code?: string } | null;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // Matches parse-pdf/parse-docx's server-side limit

// `landing` renders this same page (real scanner included) under a head-term
// SEO route like /resume-checker — unique title/description/FAQ per query
// intent, one scan implementation. See src/data/tool-landings.ts.
const Index = ({ landing }: { landing?: import("@/data/tool-landings").ToolLanding } = {}) => {
  const { t, i18n } = useTranslation();

  // Spanish landing routes flip the whole app chrome to Spanish — the visitor
  // searched in Spanish; showing an English page under a Spanish URL would be
  // a bait-and-switch. Reverting on unmount would fight the manual language
  // switcher, so we only set, never unset.
  useEffect(() => {
    if (landing?.lang === "es" && i18n.language !== "es") {
      i18n.changeLanguage("es");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing?.lang]);
  const { session } = useAuth();
  // Per-scan user context: stated intent + target role, confirmed labels.
  const [scanContext, setScanContext] = useState<{
    situation: string | null;
    targetRole: string;
    confirmedIndustry: string | null;
    confirmedExperience: string | null;
  }>({ situation: null, targetRole: "", confirmedIndustry: null, confirmedExperience: null });

  // Signed-in users start already-calibrated: remembered context prefills the scan.
  useEffect(() => {
    if (!session) return;
    supabaseClient
      .from("user_profiles")
      .select("situation, target_role, confirmed_industry, confirmed_experience")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setScanContext(prev => ({
          situation: prev.situation ?? (data as { situation?: string }).situation ?? null,
          targetRole: prev.targetRole || ((data as { target_role?: string }).target_role ?? ""),
          confirmedIndustry: prev.confirmedIndustry ?? (data as { confirmed_industry?: string }).confirmed_industry ?? null,
          confirmedExperience: prev.confirmedExperience ?? (data as { confirmed_experience?: string }).confirmed_experience ?? null,
        }));
      });
  }, [session]);

  const persistScanContext = (ctx: Partial<typeof scanContext>) => {
    const next = { ...scanContext, ...ctx };
    setScanContext(next);
    if (session) {
      supabaseClient.from("user_profiles").upsert({
        user_id: session.user.id,
        situation: next.situation,
        target_role: next.targetRole || null,
        confirmed_industry: next.confirmedIndustry,
        confirmed_experience: next.confirmedExperience,
        updated_at: new Date().toISOString(),
      }).then(({ error }) => { if (error) console.warn("[ScanContext] persist failed:", error.message); });
    }
  };
  const [isLoading, setIsLoading] = useState(false);
  const [isFreeScanLoading, setIsFreeScanLoading] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('verifying');
  const [checkoutError, setCheckoutError] = useState<string | undefined>();
  const [checkoutUrl, setCheckoutUrl] = useState<string | undefined>(); // Store URL for fallback
  const [resumeText, setResumeText] = useState<string>("");
  // Only computed for PDF uploads (needs position data from text extraction);
  // undefined for pasted text / DOCX, where the ATS parse simulator skips the
  // layout check entirely rather than guessing.
  const [resumeMultiColumnDetected, setResumeMultiColumnDetectedState] = useState<boolean | undefined>(undefined);
  // Persists alongside the state update so the flag survives into the post-checkout
  // success page (same browser session) for ATS Defense's parse simulation, without
  // needing to re-parse the file or pass it through the checkout/webhook pipeline.
  const setResumeMultiColumnDetected = (value: boolean | undefined) => {
    setResumeMultiColumnDetectedState(value);
    setMultiColumnDetectedInSession(value);
  };
  const [linkedInText, setLinkedInText] = useState<string>("");
  const [jobDescriptionText, setJobDescriptionText] = useState<string>("");
  // ISO-2 country the candidate is applying TO. Empty = auto-detect from the
  // résumé (phone/city) or IP. Set when the user is targeting a specific
  // market, so they get that market's standards instead of their residence's.
  const [targetCountry, setTargetCountry] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showFloatingScan, setShowFloatingScan] = useState(false); // Only true after fresh upload / paste-ready
  const [floatingScanTrigger, setFloatingScanTrigger] = useState(0);
  const [freeKeywordResult, setFreeKeywordResult] = useState<FreeKeywordResult | null>(null);
  const [isCachedResult, setIsCachedResult] = useState(false);

  // Tell the hero's live scan counter a scan just finished so it refetches
  // immediately instead of waiting for its next poll.
  useEffect(() => {
    if (freeKeywordResult) window.dispatchEvent(new Event("scan-completed"));
  }, [freeKeywordResult]);
  const [honeypot, setHoneypot] = useState<string>(""); // Honeypot field for bot detection
  const [preStoredSessionId, setPreStoredSessionId] = useState<string | null>(null);
  const [uploadedJobs, setUploadedJobs] = useState<JobEntry[]>([]);
  const [showRateLimitUpsell, setShowRateLimitUpsell] = useState(false);
  const [showTailoredResumeModal, setShowTailoredResumeModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  
  const [tailoredResumeContent, setTailoredResumeContent] = useState<any>(null);
  const [isGeneratingTailored, setIsGeneratingTailored] = useState(false);
  const [currentJobForTailoring, setCurrentJobForTailoring] = useState<{ title: string; company?: string; description?: string } | null>(null);
  const { toast } = useToast();
  const { currency } = useCurrency();
  const [searchParams] = useSearchParams();

  // Outcome links from the scan-report email land here (?outcome=&rid=).
  // Record via the same anonymous RPC the in-report buttons use, thank the
  // visitor, and clean the URL so refreshes don't re-record.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("outcome");
    const rid = params.get("rid");
    if (!outcome || !rid || !["interview", "no_response", "rejected"].includes(outcome)) return;
    let visitor = "unknown";
    try {
      visitor = localStorage.getItem("rb_visitor_id") ?? crypto.randomUUID();
      localStorage.setItem("rb_visitor_id", visitor);
    } catch { /* ignore */ }
    (supabase.rpc as unknown as (fn: string, args: object) => PromiseLike<unknown>)(
      "record_scan_outcome",
      { p_report_id: rid, p_outcome: outcome, p_ip: visitor },
    ).then(
      () => toast({ title: "Recorded — thank you", description: "Anonymous outcome saved. Every answer sharpens the benchmarks we publish." }),
      () => { /* best-effort */ },
    );
    params.delete("outcome");
    params.delete("rid");
    window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { verifyPurchase } = useScanCredits();
  const { trackButtonClick, trackCheckoutInitiated } = useConversionTracking();
  const { trackRateLimitError, trackApiError } = useErrorTracking();
  const { 
    trackUploadStarted, 
    trackUploadCompleted, 
    trackScanStarted, 
    trackScanCompleted, 
    trackResultsViewed,
    trackProductClicked,
    trackCheckoutStarted 
  } = useFunnelTracking();
  
  // Track affiliate referrals
  useAffiliateTracking();
  
  // Track scroll depth for drop-off analysis
  useScrollDepth('home');
  
  // Track time on page for engagement analysis
  useTimeOnPage('home');
  
  
  // Streaming scan for real-time progress updates
  const { isStreaming, progress: streamingProgress, startStreamingScan, cancelScan } = useStreamingScan();
  
  // Background scan prefetch - starts analysis when user pastes/uploads
  const { 
    triggerBackgroundScan, 
    getBackgroundScanResult, 
    waitForBackgroundScan,
    isBackgroundScanning,
    clearBackgroundScanCache
  } = useScanPrefetch({ 
    resumeText, 
    jobDescriptionText, 
    honeypot 
  });
  
  // Track if we're pre-storing to avoid duplicate calls
  const isPreStoring = useRef(false);

  // Timeout wrapper for promises
  const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(errorMsg)), timeoutMs)
      )
    ]);
  };

  // Check network connectivity - uses cached connection health
  const checkConnection = async (): Promise<boolean> => {
    // First check browser's online status
    if (!navigator.onLine) {
      console.log("[Connection] Browser reports offline");
      return false;
    }
    
    // Use cached connection health check to avoid redundant calls
    const { checkConnectionHealth } = await import('@/hooks/use-shared-data');
    return checkConnectionHealth();
  };

  // Cleanup expired data on mount, setup unload handler, and restore from session
  useEffect(() => {
    cleanupExpiredResumeData();
    const cleanup = setupUnloadCleanup();
    
    // Restore resume data from session storage (survives page refresh)
    const sessionData = getResumeFromSession();
    if (sessionData.resumeText && !resumeText) {
      console.log('[Session] Restoring resume from session storage');
      setResumeText(sessionData.resumeText);
    }
    if (sessionData.linkedInText && !linkedInText) {
      setLinkedInText(sessionData.linkedInText);
    }
    if (sessionData.jobDescriptionText && !jobDescriptionText) {
      setJobDescriptionText(sessionData.jobDescriptionText);
    }
    
    // Handle hash navigation (e.g., /#upload from other pages)
    if (window.location.hash === '#upload') {
      setTimeout(() => {
        const uploadSection = document.getElementById('upload');
        if (uploadSection) {
          uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        // Clear the hash after scrolling
        window.history.replaceState(null, '', window.location.pathname);
      }, 100);
    }
    
    return cleanup;
  }, []);

  // Pre-store resume server-side when text changes (reduces checkout friction)
  const preStoreResume = useCallback(async (text: string, linkedIn?: string, jobDesc?: string) => {
    if (isPreStoring.current || !text || text.length < 50) return;
    
    isPreStoring.current = true;
    try {
      console.log('[PreStore] Storing resume server-side');
      const { data: sessionId, error } = await supabase.rpc('store_temp_resume', {
        p_resume: text,
        p_linkedin: linkedIn || null,
        p_job_description: jobDesc || null
      });
      
      if (!error && sessionId) {
        setPreStoredSessionId(sessionId);
        console.log('[PreStore] Resume pre-stored with session:', sessionId);
      }
    } catch (err) {
      console.warn('[PreStore] Failed to pre-store (will retry at checkout):', err);
    } finally {
      isPreStoring.current = false;
    }
  }, []);

  // Show floating scan button when resumeText is available (covers both file upload and text paste)
  useEffect(() => {
    const ready = !!resumeText && resumeText.length > 100;
    setShowFloatingScan(ready && !freeKeywordResult);
  }, [resumeText, freeKeywordResult]);

  useEffect(() => {
    if (searchParams.get("canceled") === "true") {
      toast({
        title: t('homepage.toast.paymentCanceled'),
        description: t('homepage.toast.paymentCanceledDescription'),
        variant: "destructive",
      });
    }
    
    // Handle scan pack purchase success
    if (searchParams.get("scan_pack_success") === "true") {
      const sessionId = searchParams.get("session_id");
      if (sessionId) {
        (async () => {
          try {
            await verifyPurchase(sessionId);
          } catch (err) {
            toast({
              title: t('homepage.toast.analysisFailed'),
              description: t('homepage.toast.tryAgain'),
              variant: "destructive",
            });
          }
        })();
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
    
    if (searchParams.get("scan_pack_canceled") === "true") {
      toast({
        title: t('homepage.toast.purchaseCanceled'),
        description: t('homepage.toast.purchaseCanceledDescription'),
        variant: "destructive",
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams, toast, verifyPurchase]);

  const handleFileSelect = async (file: File) => {
    // Fail fast on size before uploading anything — without this, an oversized
    // file uploads in full over the network only to be rejected by the server's
    // identical 10MB limit, wasting the user's time on a slow connection.
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast({
        title: t('homepage.toast.fileTooLarge'),
        description: t('homepage.toast.fileTooLargeDescription'),
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
    setShowFloatingScan(true); // Show floating button on fresh upload
    setFloatingScanTrigger((v) => v + 1);
    setFreeKeywordResult(null); // Clear previous results

    // Clear ALL caches when a new file is uploaded to ensure fresh analysis
    clearBackgroundScanCache();
    clearAllClientScanCaches();

    // Track upload started in funnel
    trackUploadStarted(file.type);

    if (file.type === "text/plain") {
      const text = await file.text();
      setResumeText(text);
      setResumeMultiColumnDetected(undefined); // No layout data for plain text
      saveResumeToSession(text); // Persist to session storage
      preStoreResume(text); // Pre-store server-side for faster checkout
      triggerBackgroundScan(text, jobDescriptionText, honeypot); // Start background scan
      trackUploadCompleted(file.size);
      return;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const result = await resilientCallers.parsePdf(formData);

        if (result.error) {
          toast({
            title: result.error.title,
            description: result.error.description,
            variant: "destructive",
          });
          setSelectedFile(null);
          return;
        }

        const data = result.data as { success?: boolean; text?: string; pages?: number; error?: string; multiColumnDetected?: boolean };
        if (data?.success && data?.text) {
          setResumeText(data.text);
          setResumeMultiColumnDetected(data.multiColumnDetected);
          saveResumeToSession(data.text); // Persist to session storage
          preStoreResume(data.text); // Pre-store server-side for faster checkout
          triggerBackgroundScan(data.text, jobDescriptionText, honeypot); // Start background scan
          trackUploadCompleted(file.size, Date.now());
          toast({
            title: t('homepage.toast.pdfParsedSuccess'),
            description: t('homepage.toast.pdfParsedSuccessDescription', { pages: data.pages }),
          });
        } else {
          throw new Error(data?.error || "Failed to parse PDF");
        }
      } catch (error) {
        console.error("PDF parsing error:", error);
        toast({
          title: t('homepage.toast.pdfParsingFailed'),
          description: error instanceof Error && error.message
            ? error.message
            : t('homepage.toast.pdfParsingFailedDescription'),
          variant: "destructive",
        });
        setSelectedFile(null);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.toLowerCase().endsWith(".docx")
    ) {
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const result = await resilientCallers.parseDocx(formData);

        if (result.error) {
          toast({
            title: result.error.title,
            description: result.error.description,
            variant: "destructive",
          });
          setSelectedFile(null);
          return;
        }

        const data = result.data as { success?: boolean; text?: string; error?: string };
        if (data?.success && data?.text) {
          setResumeText(data.text);
          setResumeMultiColumnDetected(undefined); // No layout data for DOCX
          saveResumeToSession(data.text); // Persist to session storage
          preStoreResume(data.text); // Pre-store server-side for faster checkout
          triggerBackgroundScan(data.text, jobDescriptionText, honeypot); // Start background scan
          trackUploadCompleted(file.size, Date.now());
          toast({
            title: t('homepage.toast.docParsedSuccess'),
            description: t('homepage.toast.docParsedSuccessDescription'),
          });
        } else {
          throw new Error(data?.error || "Failed to parse DOCX");
        }
      } catch (error) {
        console.error("DOCX parsing error:", error);
        toast({
          title: t('homepage.toast.docParsingFailed'),
          description: error instanceof Error && error.message
            ? error.message
            : t('homepage.toast.docParsingFailedDescription'),
          variant: "destructive",
        });
        setSelectedFile(null);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Unrecognized file type (e.g. legacy .doc, .rtf, .odt, .pages) — none of the
    // branches above match, so without this the file sits "selected" with no
    // error and no text ever extracted, leaving the user stuck with no feedback.
    toast({
      title: t('homepage.toast.unsupportedFileType'),
      description: t('homepage.toast.unsupportedFileTypeDescription'),
      variant: "destructive",
    });
    setSelectedFile(null);
  };

  const handleFreeScan = async (skipCacheArg?: unknown) => {
    // NOTE: onClick handlers pass a MouseEvent as the first arg; only treat explicit `true` as skipCache.
    const skipCache = skipCacheArg === true;
    const overrideText = typeof skipCacheArg === "string" ? skipCacheArg : undefined;

    // Warm the lazy report chunk while the scan runs so results render instantly.
    import("@/components/FreeKeywordResults").catch(() => {});
    const contentToAnalyze = (overrideText ?? resumeText).trim();

    // If the scan was triggered from the paste box, persist it so the UI preview + session stay in sync.
    if (overrideText && overrideText.trim() && overrideText.trim() !== resumeText) {
      // Funnel: the paste-box scan button skips handleTextSubmit, so upload
      // events must fire here or the whole paste cohort is invisible.
      trackUploadStarted('pasted_text');
      trackUploadCompleted(overrideText.trim().length);
      const normalized = overrideText.trim();
      setResumeText(normalized);
      saveResumeToSession(normalized, linkedInText || undefined, jobDescriptionText || undefined);
      preStoreResume(normalized, linkedInText || undefined, jobDescriptionText || undefined);
    }

    if (!contentToAnalyze) {
      toast({
        title: t('homepage.toast.noResumeProvided'),
        description: t('homepage.toast.noResumeProvidedDescription'),
        variant: "destructive",
      });
      return;
    }

    // Experience level and role are now extracted from the scan itself

    setIsFreeScanLoading(true);
    setIsCachedResult(false); // Reset cached state
    
    // Track scan started in funnel
    trackScanStarted();

    try {
      // Check if we have a background scan result ready (from paste/upload prefetch)
      let result: any = null;
      
      if (!skipCache) {
        // First check if background scan already completed
        result = getBackgroundScanResult(contentToAnalyze);
        
        // If not ready but in progress, wait for it (up to 8s)
        if (!result && isBackgroundScanning()) {
          console.log('[FreeScan] Background scan in progress, waiting...');
          result = await waitForBackgroundScan(contentToAnalyze, 8000);
        }
        
        // Prefetched results come from the streaming fork, which returns the
        // OLD report shape (no verdict/roadmap/panel fields). Only use them if
        // they carry the enriched shape — otherwise run a real scan.
        if (result && !(result as { reportVerdict?: unknown }).reportVerdict) {
          console.log('[FreeScan] Discarding prefetched result — legacy shape without enriched report fields');
          result = null;
        }
        if (result) {
          console.log('[FreeScan] Using prefetched background scan result');
          setIsCachedResult(true);
        }
      }

      // PRIMARY: the enriched non-streaming endpoint. It returns the full
      // report (verdict, fix roadmap, recruiter panel, X-ray data, exec scope)
      // and — because supabase.functions.invoke attaches the session JWT —
      // signed-in users get their higher daily scan limit. The streaming fork
      // below is a fallback only until it reaches feature parity.
      if (!result) {
        console.log('[FreeScan] Running enriched non-streaming scan');
        const scanResult = await resilientCallers.freeKeywordScan({
          resumeText: contentToAnalyze,
          jobDescriptionText: jobDescriptionText || undefined,
          honeypot,
          skipCache,
          targetCountry: targetCountry || undefined,
          userContext: {
            situation: scanContext.situation || undefined,
            targetRole: scanContext.targetRole || undefined,
            confirmedIndustry: scanContext.confirmedIndustry || undefined,
            confirmedExperience: scanContext.confirmedExperience || undefined,
          },
          // Purchased-credit redemption for anonymous users: the email they
          // bought the scan pack with (signed-in users redeem via their JWT).
          creditEmail: localStorage.getItem('scanCreditsEmail') || undefined,
        });

        if (scanResult.error) {
          // Check if rate limited from error details
          if (scanResult.error.errorCode === 'RATE_LIMITED') {
            trackRateLimitError('free-keyword-scan', 0, 7);
            toast({
              title: t('homepage.toast.dailyScanLimitReached'),
              description: scanResult.error.description,
              variant: "destructive",
            });
            setShowRateLimitUpsell(true);
            return;
          }

          // FALLBACK: the streaming fork. Older report shape (fewer cards) but
          // keeps scans working if the primary endpoint is down.
          console.warn('[FreeScan] Primary endpoint failed, falling back to streaming scan');
          const streamResult = await startStreamingScan(contentToAnalyze, {
            jobDescriptionText: jobDescriptionText || undefined,
            honeypot,
            skipCache,
            targetCountry: targetCountry || undefined,
            onProgress: (progress) => {
              console.log('[StreamingScan] Progress:', progress.stage, progress.progress + '%');
            },
            onError: (error) => {
              console.error('[StreamingScan] Error:', error);
            },
          });
          if (streamResult) {
            result = streamResult;
          } else {
            trackApiError('free-keyword-scan', 500, scanResult.error.description);
            toast({
              title: scanResult.error.title,
              description: scanResult.error.description,
              variant: "destructive",
            });
            return;
          }
        }

        const data = scanResult.data as any;
        // Convert primary response to the result shape (skip if the streaming
        // fallback above already produced a result)
        if (result) {
          // streaming fallback result already set
        } else if (data?.success) {
          result = {
            success: true,
            cached: data.cached,
            industry: data.industry,
            atsScoreEstimate: data.atsScoreEstimate,
            formatGrade: data.formatGrade,
            formatIssue: data.formatIssue,
            experienceLevel: data.experienceLevel,
            sectionCheck: data.sectionCheck,
            topStrength: data.topStrength,
            redFlags: data.redFlags,
            keywords: data.keywords,
            quickWins: data.quickWins,
            improvementPotential: data.improvementPotential,
            ...data, // Include all other fields
          };
        } else if (data?.rateLimited) {
          trackRateLimitError('free-keyword-scan', data.scansUsed, data.scansLimit);
          toast({
            title: t('homepage.toast.dailyScanLimitReached'),
            description: data.error || `You've used all ${data.scansLimit || 7} free scans.`,
            variant: "destructive",
          });
          setShowRateLimitUpsell(true);
          return;
        } else {
          throw new Error(data?.error || "Failed to analyze resume");
        }
      }

      // Handle rate limiting
      if (result?.rateLimited) {
        trackRateLimitError('free-keyword-scan', (result as any).scansUsed, (result as any).scansLimit);
        toast({
          title: t('homepage.toast.dailyScanLimitReached'),
          description: result.error || `You've used all your free scans. Resets in ~24 hours.`,
          variant: "destructive",
        });
        setShowRateLimitUpsell(true);
        return;
      }

      if (result?.success) {
        // Purchased-credit redemption receipt
        if ((result as any).creditUsed) {
          const remaining = (result as any).creditsRemaining;
          toast({
            title: "Scan credit used",
            description: remaining != null
              ? `You were past today's free limit, so 1 purchased credit covered this scan — ${remaining} remaining.`
              : "You were past today's free limit, so 1 purchased credit covered this scan.",
          });
          window.dispatchEvent(new CustomEvent('scanCreditsEmailUpdated', { detail: { email: localStorage.getItem('scanCreditsEmail') } }));
        }

        // Track if this was a cached result
        setIsCachedResult(!!result.cached);
        
        setFreeKeywordResult({
          detectedLanguage: (result as any).detectedLanguage || null,
          candidateName: (result as any).candidateName || null,
          currentRole: (result as any).currentRole || undefined,
          industry: result.industry || 'General',
          atsScoreEstimate: result.atsScoreEstimate || 0,
          formatGrade: result.formatGrade || 'C',
          formatIssue: result.formatIssue || '',
          resumeLength: (result as any).resumeLength,
          wordCount: (result as any).wordCount,
          experienceLevel: result.experienceLevel,
          sectionCheck: result.sectionCheck,
          contactInfo: (result as any).contactInfo,
          topStrength: result.topStrength,
          quantificationScore: (result as any).quantificationScore,
          actionVerbGrade: (result as any).actionVerbGrade,
          readabilityScore: (result as any).readabilityScore,
          bulletImpactScore: (result as any).bulletImpactScore,
          keywordDensity: (result as any).keywordDensity,
          improvementPotential: result.improvementPotential,
          redFlags: result.redFlags || [],
          keywords: result.keywords || [],
          // Job matching fields
          jobMatchScore: (result as any).jobMatchScore,
          jobMatchGrade: (result as any).jobMatchGrade,
          matchingSkills: (result as any).matchingSkills,
          missingSkills: (result as any).missingSkills,
          missingSkillsDetailed: (result as any).missingSkillsDetailed,
          experienceFit: (result as any).experienceFit,
          titleAlignment: (result as any).titleAlignment,
          jobMatchSummary: (result as any).jobMatchSummary,
          applicationRecommendation: (result as any).applicationRecommendation,
          skillGapActions: (result as any).skillGapActions,
          competitiveAssessment: (result as any).competitiveAssessment,
          industryDetection: (result as any).industryDetection,
          careerSituation: (result as any).careerSituation,
          // Market intelligence
          marketIntelligence: (result as any).marketIntelligence,
          skillsRecency: (result as any).skillsRecency,
          careerTrajectory: (result as any).careerTrajectory,
          atsSystem: (result as any).atsSystem,
          competitiveGap: (result as any).competitiveGap,
          gatedKeywords: (result as any).gatedKeywords,
          detectionQualityScore: (result as any).detectionQualityScore,
          resumeTimeline: (result as any).resumeTimeline,
          // Bullet analysis
          weakBulletsDetected: (result as any).weakBulletsDetected,
          unquantifiedBulletsDetected: (result as any).unquantifiedBulletsDetected,
          bulletQuantRate: (result as any).bulletQuantRate,
          projectedScore: (result as any).projectedScore,
          // 10 reporting improvements (batch 1)
          scoreBreakdown: (result as any).scoreBreakdown,
          additionalRewrites: (result as any).additionalRewrites,
          nextBestAction: (result as any).nextBestAction,
          recruiterFirstPassSummary: (result as any).recruiterFirstPassSummary,
          formatGradeDrivers: (result as any).formatGradeDrivers,
          // 10 reporting improvements (batch 2)
          atsParsedPreview: (result as any).atsParsedPreview,
          peerPercentile: (result as any).peerPercentile,
          applicationPassRate: (result as any).applicationPassRate,
          titleLevelMismatch: (result as any).titleLevelMismatch,
          toneAudit: (result as any).toneAudit,
          sectionWordCounts: (result as any).sectionWordCounts,
          // Personalization & coverage batch
          subIndustry: (result as any).subIndustry,
          jdTargetIndustry: (result as any).jdTargetIndustry,
          industryBlend: (result as any).industryBlend,
          interviewLikelihood: (result as any).interviewLikelihood,
          competitorSilhouette: (result as any).competitorSilhouette,
          fixRoadmap: (result as any).fixRoadmap,
          // Enterprise reporting batch
          reportVerdict: (result as any).reportVerdict,
          dualIndustryComparison: (result as any).dualIndustryComparison,
          premiumTeaser: (result as any).premiumTeaser,
          reportCompleteness: (result as any).reportCompleteness,
          partialResults: (result as any).partialResults,
          parseQuality: (result as any).parseQuality,
          // Country standards + platform-profile detection — emitted by both scan
          // paths; must be mapped here or their cards never render.
          countryStandards: (result as any).countryStandards,
          platformProfileDetected: (result as any).platformProfileDetected,
          executiveScopeCheck: (result as any).executiveScopeCheck,
          resumeTriggeredQuestions: (result as any).resumeTriggeredQuestions,
          recruiterPanel: (result as any).recruiterPanel,
          weakestBullets: (result as any).weakestBullets,
          careerChangeBridge: (result as any).careerChangeBridge,
          scoreAudit: (result as any).scoreAudit,
          benchmarkIndustry: (result as any).benchmarkIndustry,
          industryNeedsConfirmation: (result as any).industryNeedsConfirmation,
          industryTransition: (result as any).industryTransition,
          freelanceGuidance: (result as any).freelanceGuidance,
          realBenchmark: (result as any).realBenchmark,
          industrySpecificChecks: (result as any).industrySpecificChecks,
          reportMeta: (result as any).reportMeta,
          scoreBand: (result as any).scoreBand,
          keywordSource: (result as any).keywordSource,
        });

        // Save to cloud scan history for signed-in users (fire and forget)
        if (session?.user) {
          supabaseClient.from('user_scans').insert({
            user_id: session.user.id,
            ats_score: result.atsScoreEstimate || 0,
            projected_score: (result as any).projectedScore ?? null,
            industry: result.industry || null,
            verdict: (result as any).reportVerdict ?? null,
            red_flag_count: (result.redFlags || []).length,
            fix_plan: (result as any).fixRoadmap?.steps
              ? (result as any).fixRoadmap.steps.map((st: { step: string }) => ({ step: st.step, done: false }))
              : null,
          }).then(({ error }) => {
            if (error) console.warn('[Account] Failed to save scan to history:', error.message);
          });
        }

        // Track scan completed in funnel
        trackScanCompleted(result.atsScoreEstimate || 0, result.industry || 'General');
        
        // Scroll to results and track results viewed
        setTimeout(() => {
          document.getElementById("free-results")?.scrollIntoView({ behavior: "smooth" });
          trackResultsViewed(result.atsScoreEstimate || 0);
        }, 100);
      } else if (result) {
        throw new Error(result.error || "Failed to analyze resume");
      }
    } catch (error: any) {
      console.error("Free scan error:", error);
      
      // Check if error message contains rate limit info
      const errorMsg = error?.message?.toLowerCase() || '';
      if (errorMsg.includes('rate') || errorMsg.includes('limit') || errorMsg.includes('429')) {
        setShowRateLimitUpsell(true);
        toast({
          title: t('homepage.toast.dailyScanLimitReached'),
          description: t('homepage.toast.tryAgain'),
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: t('homepage.toast.analysisFailed'),
        description: error?.message || t('homepage.toast.tryAgain'),
        variant: "destructive",
      });
    } finally {
      setIsFreeScanLoading(false);
    }
  };

  // Handle job-specific analysis (free re-scan with job context)
  const handleJobAnalysis = async (jobTitle: string, jobCompany: string) => {
    const contentToAnalyze = resumeText;
    
    if (!contentToAnalyze) {
      toast({
        title: t('homepage.toast.noResumeFound'),
        description: t('homepage.toast.noResumeFoundDescription'),
        variant: "destructive",
      });
      return;
    }

    // Find the job description from uploadedJobs
    const targetJob = uploadedJobs.find(j => j.title === jobTitle && j.company === jobCompany);
    const jobDesc = targetJob?.description || `${jobTitle} at ${jobCompany}`;

    setIsFreeScanLoading(true);

    try {
      const scanResult = await resilientCallers.freeKeywordScan({
        resumeText: contentToAnalyze,
        jobDescriptionText: jobDesc,
        honeypot,
      });

      if (scanResult.error) {
        if (scanResult.error.errorCode === 'RATE_LIMITED') {
          trackRateLimitError('free-keyword-scan', 0, 7);
          toast({
            title: t('homepage.toast.dailyScanLimitReached'),
            description: scanResult.error.description,
            variant: "destructive",
          });
          setShowRateLimitUpsell(true);
          return;
        }
        trackApiError('free-keyword-scan', 500, scanResult.error.description);
        toast({
          title: scanResult.error.title,
          description: scanResult.error.description,
          variant: "destructive",
        });
        return;
      }

      const data = scanResult.data as any;
      if (data?.rateLimited) {
        trackRateLimitError('free-keyword-scan', data.scansUsed, data.scansLimit);
        toast({
          title: t('homepage.toast.dailyScanLimitReached'),
          description: data.error || `You've used all ${data.scansLimit || 7} free scans. Resets in ~${data.hoursUntilReset || 24} hours.`,
          variant: "destructive",
        });
        setShowRateLimitUpsell(true);
        return;
      }

      if (data?.success) {
        setFreeKeywordResult({
          detectedLanguage: data.detectedLanguage || null,
          candidateName: data.candidateName || null,
          currentRole: data.currentRole || undefined,
          industry: data.industry,
          atsScoreEstimate: data.atsScoreEstimate,
          formatGrade: data.formatGrade,
          formatIssue: data.formatIssue,
          resumeLength: data.resumeLength,
          wordCount: data.wordCount,
          experienceLevel: data.experienceLevel,
          sectionCheck: data.sectionCheck,
          contactInfo: data.contactInfo,
          topStrength: data.topStrength,
          quantificationScore: data.quantificationScore,
          actionVerbGrade: data.actionVerbGrade,
          readabilityScore: data.readabilityScore,
          bulletImpactScore: data.bulletImpactScore,
          keywordDensity: data.keywordDensity,
          improvementPotential: data.improvementPotential,
          redFlags: data.redFlags,
          keywords: data.keywords,
          jobMatchScore: data.jobMatchScore,
          jobMatchGrade: data.jobMatchGrade,
          matchingSkills: data.matchingSkills,
          missingSkills: data.missingSkills,
          experienceFit: data.experienceFit,
          titleAlignment: data.titleAlignment,
          jobMatchSummary: data.jobMatchSummary,
          industryDetection: data.industryDetection,
          countryStandards: data.countryStandards,
          platformProfileDetected: data.platformProfileDetected,
          parseQuality: data.parseQuality,
          careerSituation: data.careerSituation,
          // 10 reporting improvements (batch 1)
          scoreBreakdown: data.scoreBreakdown,
          additionalRewrites: data.additionalRewrites,
          nextBestAction: data.nextBestAction,
          recruiterFirstPassSummary: data.recruiterFirstPassSummary,
          formatGradeDrivers: data.formatGradeDrivers,
          // 10 reporting improvements (batch 2)
          atsParsedPreview: data.atsParsedPreview,
          peerPercentile: data.peerPercentile,
          applicationPassRate: data.applicationPassRate,
          titleLevelMismatch: data.titleLevelMismatch,
          toneAudit: data.toneAudit,
          sectionWordCounts: data.sectionWordCounts,
          // Personalization & coverage batch
          subIndustry: data.subIndustry,
          jdTargetIndustry: data.jdTargetIndustry,
          industryBlend: data.industryBlend,
          interviewLikelihood: data.interviewLikelihood,
          competitorSilhouette: data.competitorSilhouette,
          fixRoadmap: data.fixRoadmap,
          // Enterprise reporting batch
          reportVerdict: data.reportVerdict,
          dualIndustryComparison: data.dualIndustryComparison,
          premiumTeaser: data.premiumTeaser,
          reportCompleteness: data.reportCompleteness,
        });

        toast({
          title: t('homepage.toast.jobAnalysisComplete'),
          description: t('homepage.toast.jobAnalysisCompleteDescription', { jobTitle, jobCompany }),
        });
        
        setTimeout(() => {
          document.getElementById("free-results")?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      } else {
        throw new Error(data?.error || "Failed to analyze");
      }
    } catch (error: unknown) {
      console.error("Job analysis error:", error);
      const parsedError = await parseEdgeFunctionError(error);
      toast({
        title: parsedError.title,
        description: parsedError.description,
        variant: "destructive",
      });
    } finally {
      setIsFreeScanLoading(false);
    }
  };

  // Generate tailored resume for any target role
  const handleGenerateTailoredResume = async () => {
    if (!resumeText) {
      toast({
        title: t('homepage.toast.noResumeFound'),
        description: t('homepage.toast.noResumeFoundDescription'),
        variant: "destructive",
      });
      return;
    }

    // Find job context from various sources
    const currentJob = uploadedJobs[0];
    const hasJobContext = currentJob || jobDescriptionText;
    
    // Use industry from scan results as fallback for job title
    const targetTitle = currentJob?.title || 
      (jobDescriptionText ? "Target Role" : `${freeKeywordResult?.industry || "Professional"} Position`);

    setIsGeneratingTailored(true);
    setShowTailoredResumeModal(true);
    setTailoredResumeContent(null);

    try {
      const result = await callEdgeFunctionWithRetry('generate-tailored-resume', {
        resumeText,
        jobTitle: targetTitle,
        jobCompany: currentJob?.company,
        jobDescription: currentJob?.description || jobDescriptionText || `A ${freeKeywordResult?.industry || "professional"} role requiring strong skills and experience.`,
        matchingSkills: freeKeywordResult?.matchingSkills,
        missingSkills: freeKeywordResult?.missingSkills,
      }, {
        maxRetries: 2,
        timeout: 120000, // 2 minutes for AI generation
        initialDelay: 2000,
      });

      if (result.error) {
        setShowTailoredResumeModal(false);
        toast({
          title: result.error.title,
          description: result.error.description,
          variant: "destructive",
        });
        return;
      }

      const data = result.data as { success?: boolean; error?: string };
      if (data?.success) {
        setTailoredResumeContent(data);
        toast({
          title: t('homepage.toast.tailoredResumeGenerated'),
          description: t('homepage.toast.tailoredResumeGeneratedDescription'),
        });
      } else {
        throw new Error(data?.error || "Failed to generate tailored resume");
      }
    } catch (error: unknown) {
      console.error("Tailored resume error:", error);
      setShowTailoredResumeModal(false);
      const parsedError = await parseEdgeFunctionError(error);
      toast({
        title: parsedError.title,
        description: parsedError.description,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingTailored(false);
    }
  };

  // Clear resume and start fresh
  const handleClearResume = useCallback(() => {
    setResumeText("");
    setSelectedFile(null);
    setFreeKeywordResult(null);
    setShowFloatingScan(false);
    clearResumeSession();
    toast({
      title: t('homepage.toast.resumeCleared'),
      description: t('homepage.toast.resumeClearedDescription'),
    });
  }, [toast]);

  const handleTextSubmit = (text: string, linkedIn?: string, jobDescription?: string) => {
    // Funnel: the paste path is an upload too — without these events the
    // activation rate undercounts the entire paste cohort.
    trackUploadStarted('pasted_text');
    trackUploadCompleted(text.length);
    setResumeText(text);
    setResumeMultiColumnDetected(undefined); // No layout data for pasted text
    setFreeKeywordResult(null);
    if (linkedIn) setLinkedInText(linkedIn);
    if (jobDescription) setJobDescriptionText(jobDescription);
    
    // Save to session storage so it persists across refreshes
    saveResumeToSession(text, linkedIn, jobDescription);
    
    // Start background scan for faster results
    triggerBackgroundScan(text, jobDescription, honeypot);
    
    handleCheckout(text, linkedIn, jobDescription);
  };

  // For paste mode: keep the preview + floating CTAs in sync with the textarea (no checkout yet)
  const handleResumeDraftChange = useCallback((draft: string) => {
    const normalized = draft.trim();
    setResumeText(normalized);
    setFreeKeywordResult(null);
    
    // Clear caches when text changes significantly
    clearAllClientScanCaches();

    // Only "pop" the floating CTA when the user first becomes eligible to scan
    if (normalized.length > 100) {
      setFloatingScanTrigger((v) => v + 1);
      // Trigger background scan when user pastes/types enough text
      triggerBackgroundScan(normalized, jobDescriptionText, honeypot);
    }
  }, [triggerBackgroundScan, jobDescriptionText, honeypot]);

  const handleCheckout = async (text?: string, linkedIn?: string, jobDescription?: string) => {
    const contentToAnalyze = text || resumeText;
    const linkedInContent = linkedIn || linkedInText;
    const jobDescriptionContent = jobDescription || jobDescriptionText;

    // Optional coupon code from URL (always normalize to UPPERCASE)
    const couponFromUrl = searchParams.get("coupon");
    const promoCode = couponFromUrl ? couponFromUrl.trim().toUpperCase() : undefined;

    // Reset checkout state
    setCheckoutStep('verifying');
    setCheckoutError(undefined);
    setCheckoutUrl(undefined); // Reset URL
    
    // More detailed validation with specific error messages
    if (!contentToAnalyze || contentToAnalyze.trim().length < 50) {
      console.error("[Checkout] No resume content available", { 
        textProvided: !!text, 
        resumeTextState: !!resumeText,
        contentLength: contentToAnalyze?.length 
      });
      toast({
        title: t('homepage.toast.resumeRequired'),
        description: t('homepage.toast.resumeRequiredDescription'),
        variant: "destructive",
      });
      return;
    }

    // Track button click for conversion analytics
    trackButtonClick('fullAnalysis', 'main_checkout');

    // Show full-screen loading overlay
    setIsCheckoutLoading(true);
    setIsLoading(true);
    
    console.log("[Checkout] Starting checkout flow", { 
      hasContent: !!contentToAnalyze, 
      contentLength: contentToAnalyze?.length,
      hasLinkedIn: !!linkedInContent,
      hasPreStoredSession: !!preStoredSessionId,
      currency: currency.code
    });

    // Track locally for finally block (outside try scope)
    let hasReceivedUrl = false;

    try {
      // Step 1: Verify connection
      console.log("[Checkout] Step 1: Verifying connection");
      const isConnected = await checkConnection();
      if (!isConnected) {
        setCheckoutError(t('homepage.toast.noInternetConnection'));
        setIsCheckoutLoading(false);
        setIsLoading(false);
        return;
      }
      
      // Check for popup blockers on desktop in iframe
      const inIframe = window.self !== window.top;
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      // Step 2: Connect to payment service
      setCheckoutStep('connecting');
      console.log("[Checkout] Step 2: Connecting to payment service");
      
      // Use pre-stored session ID if available, otherwise store now
      let tempSessionData = preStoredSessionId;
      
      if (!tempSessionData) {
        console.log("[Checkout] No pre-stored session, storing now");
        const { data, error: tempError } = await supabase.rpc('store_temp_resume', {
          p_resume: contentToAnalyze,
          p_linkedin: linkedInContent || null,
          p_job_description: jobDescriptionContent || null
        });

        if (tempError) {
          console.error("[Checkout] Failed to store resume data:", tempError);
          throw new Error("Failed to prepare resume data. Please try uploading your resume again.");
        }
        tempSessionData = data;
      } else {
        console.log("[Checkout] Using pre-stored session:", tempSessionData);
      }
      
      console.log("[Checkout] Resume stored, calling create-checkout");

      // Store only the temp session UUID locally (no PII)
      setResumeData('tempSessionId', tempSessionData);

      // Use resilient checkout caller with built-in retry logic
      console.log("[Checkout] Calling create-checkout with resilient caller");
      const checkoutResult = await resilientCallers.createCheckout({
        resumeData: contentToAnalyze,
        hasLinkedIn: !!linkedInContent,
        tempSessionId: tempSessionData,
        currency: currency.code,
        promoCode,
      });

      if (checkoutResult.error) {
        throw new Error(checkoutResult.error.description);
      }

      const checkoutData = checkoutResult.data as { url?: string; sessionId?: string };
      if (!checkoutData?.url) {
        throw new Error("No checkout URL received");
      }

      // Store the checkout URL immediately for fallback use
      hasReceivedUrl = true;
      setCheckoutUrl(checkoutData.url);
      console.log("[Checkout] Checkout URL received and stored for fallback");
      
      // Track checkout initiated
      trackCheckoutInitiated('fullAnalysis', 25);

      // Tie the temp session ID to this specific checkout session
      if (checkoutData?.sessionId) {
        setResumeData(`tempSessionId:${checkoutData.sessionId}`, tempSessionData);
      }

      // Step 3: Redirect to checkout
      setCheckoutStep('redirecting');
      console.log("[Checkout] Step 3: Redirecting to checkout");
      
      // Small delay to show the redirecting step
      await new Promise(r => setTimeout(r, 300));

      // Handle navigation to Stripe checkout
      if (isMobile) {
        // Mobile: Direct redirect (more reliable than popup)
        console.log("[Checkout] Mobile detected, using direct redirect");
        setCheckoutRedirect(true);
        window.location.href = checkoutData.url;
        return;
      }
      
      // Desktop in iframe: direct redirect (avoid opening a new window)
      if (inIframe) {
        setCheckoutRedirect(true);
        window.location.assign(checkoutData.url);
        return;
      }
      // Desktop: navigate in same tab
      setCheckoutRedirect(true);
      window.location.assign(checkoutData.url);
    } catch (error: any) {
      console.error("Checkout error:", error);
      removeResumeData('tempSessionId');
      setPreStoredSessionId(null); // Clear pre-stored session on error
      
      // Parse specific error messages from the backend
      let errorTitle = t('homepage.toast.checkoutFailed');
      let errorDescription = t('homepage.toast.checkoutFailedDescription');

      const errorMessage = error?.message?.toLowerCase() || '';
      const errorContext = error?.context?.body || '';

      if (errorMessage.includes('region') || errorContext.includes('region')) {
        errorTitle = t('homepage.toast.serviceUnavailable');
        errorDescription = t('homepage.toast.serviceUnavailableDescription');
      } else if (errorMessage.includes('rate') || errorMessage.includes('too many') || errorContext.includes('Too many')) {
        errorTitle = t('homepage.toast.tooManyAttempts');
        errorDescription = t('homepage.toast.tooManyAttemptsDescription');
      } else if (errorMessage.includes('unavailable') || errorContext.includes('unavailable')) {
        errorTitle = t('homepage.toast.serviceTemporarilyUnavailable');
        errorDescription = t('homepage.toast.serviceTemporarilyUnavailableDescription');
      }
      
      // Only show toast if we don't have a URL (true failure vs popup blocked)
      if (!hasReceivedUrl) {
        toast({
          title: errorTitle,
          description: errorDescription,
          variant: "destructive",
        });
      }
      
      setCheckoutError(errorDescription);
    } finally {
      setIsLoading(false);
      // Don't hide overlay if we have a URL - user needs fallback options
      if (!hasReceivedUrl) {
        setIsCheckoutLoading(false);
      }
    }
  };

  const handleRetryCheckout = () => {
    setCheckoutError(undefined);
    setCheckoutUrl(undefined);
    setCheckoutStep('verifying');
    handleCheckout();
  };

  const handleCloseCheckout = () => {
    setIsCheckoutLoading(false);
    setCheckoutError(undefined);
    setCheckoutUrl(undefined);
  };


  return (
    <div className="min-h-screen bg-background">
      <CheckoutOverlay 
        isVisible={isCheckoutLoading} 
        currentStep={checkoutStep} 
        error={checkoutError}
        checkoutUrl={checkoutUrl}
        onRetry={checkoutError && !checkoutUrl ? handleRetryCheckout : undefined}
        onClose={handleCloseCheckout}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Resume Booster",
        url: "https://resumebooster.work",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Free diagnostic resume scan: ATS score with a full audit trail, verified quotes, per-vendor parsing checks, and a fix plan — across 59 industries and 10 languages.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free resume scan — no signup required" },
      }) }} />
      <SEO
        title={landing?.title ?? "Resume Booster: Free ATS Resume Scan"}
        description={landing?.description ?? "Free AI resume scan: ATS score, missing keywords, red flags, and recruiter-grade fixes in under 30 seconds."}
        path={landing?.path ?? "/"}
      />
      {landing?.alternates && (
        <>
          <link rel="alternate" hrefLang="en" href={`https://resumebooster.work${landing.alternates.en}`} />
          <link rel="alternate" hrefLang="es" href={`https://resumebooster.work${landing.alternates.es}`} />
          <link rel="alternate" hrefLang="x-default" href={`https://resumebooster.work${landing.alternates.en}`} />
        </>
      )}
      {landing && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: landing.faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }) }} />
      )}
      <Header />

      <main id="main-content" className="pt-16" role="main">
        <Hero onFileSelect={handleFileSelect} />

        {/* Landing-variant copy: the query-specific promise, right under the tool */}
        {landing && !freeKeywordResult && (
          <section className="container max-w-2xl -mt-2 mb-8">
            <div className="rounded-2xl border border-border bg-card/60 p-5">
              <h2 className="text-lg font-bold text-foreground mb-1.5">{landing.heading}</h2>
              <p className="text-sm text-muted-foreground mb-3">{landing.intro}</p>
              <ul className="space-y-1.5">
                {landing.bullets.map((b) => (
                  <li key={b} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-success mt-0.5">✓</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Hidden honeypot field for bot detection */}
        <input
          type="text"
          name="website"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          className="absolute -left-[9999px] opacity-0 h-0 w-0"
          aria-hidden="true"
        />
        
        <ResumeUploader
          onFileSelect={handleFileSelect}
          onTextSubmit={handleTextSubmit}
          onResumeDraftChange={handleResumeDraftChange}
          onCheckout={(linkedIn, jobDescription) => handleCheckout(undefined, linkedIn, jobDescription)}
          onFreeScan={handleFreeScan}
          onClearResume={handleClearResume}
          isLoading={isLoading}
          isFreeScanLoading={isFreeScanLoading || isStreaming}
          hasContent={!!resumeText || !!selectedFile}
          resumeText={resumeText}
          linkedInText={linkedInText}
          onLinkedInTextChange={setLinkedInText}
          jobDescriptionText={jobDescriptionText}
          onJobDescriptionTextChange={setJobDescriptionText}
          onJobsChange={setUploadedJobs}
          streamingProgress={streamingProgress}
        />
        
        {/* Pre-scan intent capture — stated context beats inference */}
        {(resumeText || selectedFile) && !freeKeywordResult && (
          <section className="container max-w-2xl -mt-2 mb-6">
            <div className="rounded-2xl border border-border bg-card/60 p-4">
              <p className="text-xs font-semibold text-foreground mb-2">Make your scan specific to you <span className="text-muted-foreground font-normal">(optional, 5 seconds)</span></p>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {([
                  { id: "actively_applying", label: "🎯 Actively applying" },
                  { id: "exploring", label: "🧭 Exploring options" },
                  { id: "career_change", label: "🔄 Changing careers" },
                  { id: "first_job", label: "🌱 First job" },
                  { id: "freelance", label: "💼 Freelancing" },
                ]).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => persistScanContext({ situation: scanContext.situation === opt.id ? null : opt.id })}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${scanContext.situation === opt.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <input
                value={scanContext.targetRole}
                onChange={(e) => setScanContext(prev => ({ ...prev, targetRole: e.target.value }))}
                onBlur={() => persistScanContext({})}
                placeholder="Target role (e.g. Senior Data Engineer) — sharpens keywords & benchmarks"
                maxLength={80}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {/* Applying-in country. Overrides résumé/IP detection so someone
                  targeting a market abroad gets that market's résumé standards
                  (photo norms, personal-data expectations, references, etc.). */}
              <select
                value={targetCountry}
                onChange={(e) => setTargetCountry(e.target.value)}
                aria-label="Country you're applying in"
                className="w-full mt-2 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">🌍 Applying in… (auto-detect country standards)</option>
                {([
                  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
                  ["IE", "Ireland"], ["NZ", "New Zealand"], ["DE", "Germany"], ["FR", "France"],
                  ["NL", "Netherlands"], ["ES", "Spain"], ["IT", "Italy"], ["CH", "Switzerland"],
                  ["SE", "Sweden"], ["PL", "Poland"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"],
                  ["IN", "India"], ["SG", "Singapore"], ["JP", "Japan"], ["HK", "Hong Kong"],
                  ["ZA", "South Africa"], ["BR", "Brazil"], ["MX", "Mexico"], ["PH", "Philippines"],
                ] as [string, string][]).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
          </section>
        )}

        {/* What the free scan delivers — expectation-setting before upload,
            hidden once a report is on screen */}
        {!freeKeywordResult && <WhatYouGetSection />}

        {/* Trust Indicators + How It Works — moved below the uploader so the
            free scan is the first thing visitors can act on */}
        <TrustIndicators />
        <HowItWorks />

        {/* Mini Pricing Cards - Featured packages */}
        <MiniPricingCards />

        {/* Free Keyword Results */}
        {freeKeywordResult && (
          <section id="free-results" className="py-12 scroll-mt-20" data-results-section="true">
            <Suspense
              fallback={
                <div className="container py-8 text-center text-sm text-muted-foreground animate-pulse">
                  Preparing your report…
                </div>
              }
            >
            <div className="container space-y-4">
              <ResumeLanguageSuggestion detectedLanguage={freeKeywordResult.detectedLanguage} />
              {!session && (
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <p className="text-xs text-muted-foreground flex-1">
                    <span className="font-semibold text-foreground">Don't lose this score.</span> Create a free account to track your progress across scans, keep your fix checklist, and get 15 free scans a day instead of 7.
                  </p>
                  <Link
                    to="/auth"
                    className="shrink-0 inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Create free account
                  </Link>
                </div>
              )}
              {freeKeywordResult.parseQuality && freeKeywordResult.parseQuality.verdict !== 'good' && (
                <div className={`rounded-xl border p-4 flex items-start gap-2 ${freeKeywordResult.parseQuality.verdict === 'poor' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'}`}>
                  <span className="text-sm shrink-0">{freeKeywordResult.parseQuality.verdict === 'poor' ? '🚫' : '⚠️'}</span>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {freeKeywordResult.parseQuality.verdict === 'poor'
                        ? 'This resume may not have extracted correctly'
                        : 'Extraction quality note'}
                    </span>
                    {' — '}{freeKeywordResult.parseQuality.issues.join('; ')}.{' '}
                    {freeKeywordResult.parseQuality.verdict === 'poor'
                      ? 'The scores below may be unreliable. Try uploading a DOCX instead, or paste the resume text directly.'
                      : 'If the report looks off, try pasting the text directly.'}
                  </p>
                </div>
              )}
              {freeKeywordResult.partialResults && (
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-2">
                  <span className="text-warning text-sm shrink-0">⚠️</span>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Partial results:</span> our AI reviewer was briefly unavailable, so this report uses automated analysis only. Rescan in a few minutes for the full AI-personalized version.
                  </p>
                </div>
              )}
              <CardErrorBoundary
                section="free-keyword-results"
                fallback={
                  <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
                    <p className="text-sm font-semibold text-foreground mb-1">Something went wrong displaying your report</p>
                    <p className="text-xs text-muted-foreground">Your scan completed — try refreshing the page to see the results.</p>
                  </div>
                }
              >
              <FreeKeywordResults
                candidateName={freeKeywordResult.candidateName}
                currentRole={freeKeywordResult.currentRole}
                industry={freeKeywordResult.industry}
                atsScoreEstimate={freeKeywordResult.atsScoreEstimate}
                industryScoreInsight={freeKeywordResult.industryScoreInsight}
                formatGrade={freeKeywordResult.formatGrade}
                formatIssue={freeKeywordResult.formatIssue}
                resumeLength={freeKeywordResult.resumeLength}
                wordCount={freeKeywordResult.wordCount}
                experienceLevel={freeKeywordResult.experienceLevel}
                sectionCheck={freeKeywordResult.sectionCheck}
                contactInfo={freeKeywordResult.contactInfo}
                topStrength={freeKeywordResult.topStrength}
                quantificationScore={freeKeywordResult.quantificationScore}
                actionVerbGrade={freeKeywordResult.actionVerbGrade}
                readabilityScore={freeKeywordResult.readabilityScore}
                bulletImpactScore={freeKeywordResult.bulletImpactScore}
                keywordDensity={freeKeywordResult.keywordDensity}
                improvementPotential={freeKeywordResult.improvementPotential}
                redFlags={freeKeywordResult.redFlags}
                keywords={freeKeywordResult.keywords}
                topSkipReasons={freeKeywordResult.topSkipReasons}
                powerWords={freeKeywordResult.powerWords}
                weakPhrases={freeKeywordResult.weakPhrases}
                timelineAnalysis={freeKeywordResult.timelineAnalysis}
                industryBenchmark={freeKeywordResult.industryBenchmark}
                quickWins={freeKeywordResult.quickWins}
                sampleRewrite={freeKeywordResult.sampleRewrite}
                uploadedJobs={uploadedJobs}
                jobMatchScore={freeKeywordResult.jobMatchScore}
                jobMatchGrade={freeKeywordResult.jobMatchGrade}
                matchingSkills={freeKeywordResult.matchingSkills}
                missingSkills={freeKeywordResult.missingSkills}
                missingSkillsDetailed={freeKeywordResult.missingSkillsDetailed}
                experienceFit={freeKeywordResult.experienceFit}
                titleAlignment={freeKeywordResult.titleAlignment}
                jobMatchSummary={freeKeywordResult.jobMatchSummary}
                applicationRecommendation={freeKeywordResult.applicationRecommendation}
                skillGapActions={freeKeywordResult.skillGapActions}
                competitiveAssessment={freeKeywordResult.competitiveAssessment}
                careerSituation={freeKeywordResult.careerSituation}
                formatRecommendation={freeKeywordResult.formatRecommendation}
                personalizedCareerInsights={freeKeywordResult.personalizedCareerInsights}
                onGetFullAnalysis={() => handleCheckout(resumeText, linkedInText, jobDescriptionText)}
                onGetJobAnalysis={handleJobAnalysis}
                onGenerateTailoredResume={handleGenerateTailoredResume}
                isGeneratingTailored={isGeneratingTailored}
                isLoading={isLoading || isFreeScanLoading}
                isCached={isCachedResult}
                onForceReanalyze={() => {
                  clearBackgroundScanCache();
                  setIsCachedResult(false);
                  handleFreeScan(true);
                }}
                resumeText={resumeText}
                multiColumnDetected={resumeMultiColumnDetected}
                jobDescriptionText={jobDescriptionText}
                jobTitle={uploadedJobs[0]?.title}
                jobCompany={uploadedJobs[0]?.company}
                resumeType={freeKeywordResult.resumeType}
                seniorityLevel={freeKeywordResult.seniorityLevel}
                dualScore={freeKeywordResult.dualScore}
                calibratedLanguage={freeKeywordResult.calibratedLanguage}
                usageRecommendations={freeKeywordResult.usageRecommendations}
                credibilityIssues={freeKeywordResult.credibilityIssues}
                eliteSignals={freeKeywordResult.eliteSignals}
                contentLocations={freeKeywordResult.contentLocations}
                industryDetection={freeKeywordResult.industryDetection}
                weakBulletsDetected={freeKeywordResult.weakBulletsDetected}
                unquantifiedBulletsDetected={freeKeywordResult.unquantifiedBulletsDetected}
                bulletQuantRate={freeKeywordResult.bulletQuantRate}
                projectedScore={freeKeywordResult.projectedScore ?? undefined}
                marketIntelligence={freeKeywordResult.marketIntelligence}
                skillsRecency={freeKeywordResult.skillsRecency}
                careerTrajectory={freeKeywordResult.careerTrajectory}
                atsSystemDetected={freeKeywordResult.atsSystem}
                competitiveGap={freeKeywordResult.competitiveGap}
                gatedKeywords={freeKeywordResult.gatedKeywords}
                detectionQualityScore={freeKeywordResult.detectionQualityScore}
                resumeTimeline={freeKeywordResult.resumeTimeline}
                scoreBreakdown={freeKeywordResult.scoreBreakdown}
                additionalRewrites={freeKeywordResult.additionalRewrites}
                nextBestAction={freeKeywordResult.nextBestAction ?? undefined}
                recruiterFirstPassSummary={freeKeywordResult.recruiterFirstPassSummary ?? undefined}
                formatGradeDrivers={freeKeywordResult.formatGradeDrivers}
                atsParsedPreview={freeKeywordResult.atsParsedPreview}
                peerPercentile={freeKeywordResult.peerPercentile}
                applicationPassRate={freeKeywordResult.applicationPassRate}
                titleLevelMismatch={freeKeywordResult.titleLevelMismatch ?? undefined}
                toneAudit={freeKeywordResult.toneAudit}
                sectionWordCounts={freeKeywordResult.sectionWordCounts}
                subIndustry={freeKeywordResult.subIndustry ?? undefined}
                jdTargetIndustry={freeKeywordResult.jdTargetIndustry ?? undefined}
                industryBlend={freeKeywordResult.industryBlend ?? undefined}
                interviewLikelihood={freeKeywordResult.interviewLikelihood}
                competitorSilhouette={freeKeywordResult.competitorSilhouette}
                fixRoadmap={freeKeywordResult.fixRoadmap}
                reportVerdict={freeKeywordResult.reportVerdict ?? undefined}
                dualIndustryComparison={freeKeywordResult.dualIndustryComparison ?? undefined}
                premiumTeaser={freeKeywordResult.premiumTeaser ?? undefined}
                executiveScopeCheck={freeKeywordResult.executiveScopeCheck ?? undefined}
                resumeTriggeredQuestions={freeKeywordResult.resumeTriggeredQuestions}
                recruiterPanel={freeKeywordResult.recruiterPanel ?? undefined}
                weakestBullets={freeKeywordResult.weakestBullets}
                careerChangeBridge={freeKeywordResult.careerChangeBridge ?? undefined}
                scoreAudit={freeKeywordResult.scoreAudit ?? undefined}
                benchmarkIndustry={freeKeywordResult.benchmarkIndustry ?? undefined}
                industryNeedsConfirmation={freeKeywordResult.industryNeedsConfirmation}
                industryTransition={freeKeywordResult.industryTransition ?? undefined}
                freelanceGuidance={freeKeywordResult.freelanceGuidance ?? undefined}
                realBenchmark={freeKeywordResult.realBenchmark ?? undefined}
                industrySpecificChecks={freeKeywordResult.industrySpecificChecks ?? undefined}
                countryStandards={freeKeywordResult.countryStandards ?? undefined}
                platformProfileDetected={freeKeywordResult.platformProfileDetected ?? undefined}
                atsSystemCompatibility={freeKeywordResult.atsCompatibility ?? undefined}
                reportMeta={freeKeywordResult.reportMeta ?? undefined}
                parseQuality={freeKeywordResult.parseQuality ?? undefined}
                scoreBand={freeKeywordResult.scoreBand ?? undefined}
                hadJobDescription={!!jobDescriptionText}
                sourceWasFile={!!selectedFile}
                keywordSource={freeKeywordResult.keywordSource ?? undefined}
                scanSituation={scanContext.situation ?? undefined}
                onContextConfirm={(ctx) => persistScanContext(ctx)}
              />
              </CardErrorBoundary>
              
              {/* Score-based package recommendation */}
              <ScoreBasedPackageRecommendation atsScore={freeKeywordResult.atsScoreEstimate} />

              {/* LinkedIn insights — shown when user provided their LinkedIn profile */}
              {linkedInText && (
                <LinkedInInsights
                  resumeText={resumeText}
                  linkedinText={linkedInText}
                  industry={freeKeywordResult.industry || "general"}
                  resumeAtsScore={freeKeywordResult.atsScoreEstimate || 0}
                />
              )}

              {/* Feedback */}
              <div className="flex justify-center">
                <ScanFeedback
                  industry={freeKeywordResult.industry || ""}
                  atsScore={freeKeywordResult.atsScoreEstimate || 0}
                  hadJobDescription={!!jobDescriptionText}
                  resumeWordCount={freeKeywordResult.wordCount?.current}
                />
              </div>
            </div>
            </Suspense>
          </section>
        )}

        <AnalysisPreview />

        <ComparisonTable />

        {/* The question skeptics actually ask — answered honestly */}
        <WhyNotChatGPT />

        <SocialProof />

        {/* Real corpus statistics — the transparency claim above, made concrete */}
        <LiveScanStats />

        <FAQ />

        {/* Landing-variant FAQs rendered visibly — the FAQPage JSON-LD above
            must match on-page content or Google ignores it */}
        {landing && (
          <section className="py-10 border-t border-border">
            <div className="container max-w-2xl">
              <h2 className="text-2xl font-bold text-center mb-6">Common questions</h2>
              <div className="space-y-4">
                {landing.faqs.map((f) => (
                  <div key={f.q} className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="font-semibold text-foreground mb-1.5">{f.q}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Value Comparison - before final CTA */}
        <section className="py-12 border-t border-border">
          <div className="container max-w-2xl">
            <h2 className="text-2xl font-bold text-center mb-6">
              {t('homepage.whyChoose')}
            </h2>
            <ValueComparison />
          </div>
        </section>
        
        <FinalCTA 
          onGetStarted={() => {
            document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
          }}
          isLoading={isLoading}
        />
      </main>
      
      {/* StickyBottomCTA only shown before results — once results are visible the
          inline ScoreBasedPackageRecommendation is the primary CTA */}
      {!freeKeywordResult && (
        <StickyBottomCTA
          onGetStarted={() => {
            document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
          }}
          isLoading={isLoading}
        />
      )}

      <FloatingUploadButton
        hasContent={showFloatingScan}
        scanComplete={!!freeKeywordResult}
        trigger={floatingScanTrigger}
      />

      
      <Footer />
      
      {/* Rate Limit Upsell Modal */}
      {showRateLimitUpsell && (
        <Suspense fallback={null}>
          <RateLimitUpsell onClose={() => setShowRateLimitUpsell(false)} />
        </Suspense>
      )}

      {/* Tailored Resume Modal — mounted only once opened so its chunk stays
          out of the landing bundle */}
      {(showTailoredResumeModal || tailoredResumeContent) && (
        <Suspense fallback={null}>
          <TailoredResumeModal
            isOpen={showTailoredResumeModal}
            onClose={() => {
              setShowTailoredResumeModal(false);
              setTailoredResumeContent(null);
            }}
            content={tailoredResumeContent}
            isLoading={isGeneratingTailored}
          />
        </Suspense>
      )}

      {/* Product Selection Modal */}
      {showProductModal && (
        <Suspense fallback={null}>
          <ProductSelectionModal
            open={showProductModal}
            onOpenChange={setShowProductModal}
            sessionId={preStoredSessionId || undefined}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Index;
