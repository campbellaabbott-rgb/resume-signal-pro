import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { useSearchParams } from "react-router-dom";
import { useScrollDepth } from "@/hooks/use-scroll-depth";
import { useTimeOnPage } from "@/hooks/use-time-on-page";
import { useFunnelTracking } from "@/hooks/use-funnel-tracking";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { AnalysisPreview } from "@/components/AnalysisPreview";
import { SocialProof } from "@/components/SocialProof";
import { Footer } from "@/components/Footer";
import { FAQ } from "@/components/FAQ";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ValueComparison } from "@/components/ValueComparison";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { StickyBottomCTA } from "@/components/StickyBottomCTA";
import { FinalCTA } from "@/components/FinalCTA";
import { RateLimitUpsell } from "@/components/RateLimitUpsell";
import { TailoredResumeModal } from "@/components/TailoredResumeModal";
import { ResumeLanguageSuggestion } from "@/components/ResumeLanguageSuggestion";
import { ProductSelectionModal } from "@/components/ProductSelectionModal";

import { LiveActivityIndicator } from "@/components/LiveActivityIndicator";
import { LazySection } from "@/components/LazySection";

import { type JobEntry } from "@/components/JobSelector";

import { HowItWorks } from "@/components/HowItWorks";
import { MiniPricingCards } from "@/components/MiniPricingCards";
import { TrustIndicators } from "@/components/TrustIndicators";

import { ScoreBasedPackageRecommendation } from "@/components/ScoreBasedPackageRecommendation";
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
  sectionCheck?: { hasContact: boolean; hasSummary: boolean; hasExperience: boolean; hasEducation: boolean; hasSkills: boolean; missingSections: string[] };
  contactInfo?: { hasEmail: boolean; hasPhone: boolean; hasLinkedIn: boolean; missingItems: string[] };
  topStrength?: { title: string; description: string };
  quantificationScore?: { score: number; verdict: "weak" | "average" | "strong"; tip: string };
  actionVerbGrade?: { grade: string; issue: string };
  readabilityScore?: { score: number; verdict: "hard_to_read" | "readable" | "easy_to_scan"; issue: string };
  bulletImpactScore?: { score: number; verdict: "responsibility_heavy" | "balanced" | "achievement_focused"; tip: string };
  keywordDensity?: { level: "sparse" | "moderate" | "dense"; explanation: string };
  improvementPotential?: { level: "low" | "medium" | "high"; estimatedScoreIncrease: number; topPriority: string };
  redFlags: { issue: string; impact: string }[];
  keywords: { keyword: string; reason: string }[];
  topSkipReasons?: string[];
  powerWords?: string[];
  weakPhrases?: { phrase: string; suggestion: string }[];
  timelineAnalysis?: { avgTenure: string; progression: "stagnant" | "steady" | "rapid" | "unclear"; hasGaps: boolean; gapNote?: string; totalYears: string };
  industryBenchmark?: { industryAvg: number; comparison: "below" | "at" | "above"; percentile: string };
  quickWins?: { fix: string; timeEstimate: string; impact: "low" | "medium" | "high" }[];
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
  };
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // Matches parse-pdf/parse-docx's server-side limit

const Index = () => {
  const { t } = useTranslation();
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showFloatingScan, setShowFloatingScan] = useState(false); // Only true after fresh upload / paste-ready
  const [floatingScanTrigger, setFloatingScanTrigger] = useState(0);
  const [freeKeywordResult, setFreeKeywordResult] = useState<FreeKeywordResult | null>(null);
  const [isCachedResult, setIsCachedResult] = useState(false);
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
        verifyPurchase(sessionId);
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
    const contentToAnalyze = (overrideText ?? resumeText).trim();

    // If the scan was triggered from the paste box, persist it so the UI preview + session stay in sync.
    if (overrideText && overrideText.trim() && overrideText.trim() !== resumeText) {
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
        
        if (result) {
          console.log('[FreeScan] Using prefetched background scan result');
          setIsCachedResult(true);
        }
      }
      
      // If no prefetch result, run the streaming scan
      if (!result) {
        result = await startStreamingScan(contentToAnalyze, {
          jobDescriptionText: jobDescriptionText || undefined,
          honeypot,
          skipCache,
          onProgress: (progress) => {
            console.log('[StreamingScan] Progress:', progress.stage, progress.progress + '%');
          },
          onComplete: (data) => {
            console.log('[StreamingScan] Complete:', data.atsScoreEstimate);
          },
          onError: (error) => {
            console.error('[StreamingScan] Error:', error);
          },
        });
      }

      // Fallback to non-streaming endpoint if streaming failed
      if (!result) {
        console.log('[FreeScan] Streaming failed, falling back to resilient non-streaming endpoint');
        const scanResult = await resilientCallers.freeKeywordScan({
          resumeText: contentToAnalyze,
          jobDescriptionText: jobDescriptionText || undefined,
          honeypot,
          skipCache,
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
          trackApiError('free-keyword-scan', 500, scanResult.error.description);
          toast({
            title: scanResult.error.title,
            description: scanResult.error.description,
            variant: "destructive",
          });
          return;
        }

        const data = scanResult.data as any;
        // Convert fallback response to streaming result format
        if (data?.success) {
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
        });
        
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
      <SEO title="Resume Booster: Free ATS Resume Scan" description="Free AI resume scan: ATS score, missing keywords, red flags, and recruiter-grade fixes in under 30 seconds." path="/" />
      <Header />

      <main id="main-content" className="pt-[88px]" role="main">
        <Hero />
        
        {/* Trust Indicators - Right after hero for credibility */}
        <TrustIndicators />
        
        {/* How It Works - Show after uploader on mobile for cleaner flow */}
        <div className="hidden sm:block">
          <HowItWorks />
        </div>
        
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
        
        {/* How It Works - Show after uploader on mobile */}
        <div className="sm:hidden">
          <HowItWorks />
        </div>
        
        {/* Mini Pricing Cards - Featured packages */}
        <MiniPricingCards />

        {/* Free Keyword Results */}
        {freeKeywordResult && (
          <section id="free-results" className="py-12 scroll-mt-20" data-results-section="true">
            <div className="container space-y-4">
              <ResumeLanguageSuggestion detectedLanguage={freeKeywordResult.detectedLanguage} />
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
              />
              
              {/* Score-based package recommendation */}
              <ScoreBasedPackageRecommendation atsScore={freeKeywordResult.atsScoreEstimate} />
            </div>
          </section>
        )}
        
        <AnalysisPreview />
        
        <ComparisonTable />
        
        <SocialProof />
        
        <FAQ />
        
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
      
      <StickyBottomCTA 
        onGetStarted={() => {
          document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
        }}
        isLoading={isLoading}
      />
      
      
      
      <FloatingUploadButton
        hasContent={showFloatingScan}
        scanComplete={!!freeKeywordResult}
        trigger={floatingScanTrigger}
      />
      <FloatingSeeReportButton isVisible={!!freeKeywordResult} />

      
      <Footer />
      
      {/* Rate Limit Upsell Modal */}
      {showRateLimitUpsell && (
        <RateLimitUpsell onClose={() => setShowRateLimitUpsell(false)} />
      )}
      
      {/* Tailored Resume Modal */}
      <TailoredResumeModal
        isOpen={showTailoredResumeModal}
        onClose={() => {
          setShowTailoredResumeModal(false);
          setTailoredResumeContent(null);
        }}
        content={tailoredResumeContent}
        isLoading={isGeneratingTailored}
      />
      
      {/* Product Selection Modal */}
      <ProductSelectionModal
        open={showProductModal}
        onOpenChange={setShowProductModal}
        sessionId={preStoredSessionId || undefined}
      />
    </div>
  );
};

export default Index;
