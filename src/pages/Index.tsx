import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
import { ProductSelectionModal } from "@/components/ProductSelectionModal";

import { type JobEntry } from "@/components/JobSelector";

import { HowItWorks } from "@/components/HowItWorks";
import { MiniPricingCards } from "@/components/MiniPricingCards";

import { ScoreBasedPackageRecommendation } from "@/components/ScoreBasedPackageRecommendation";
import { FloatingUploadButton } from "@/components/FloatingUploadButton";
import { CheckoutOverlay, type CheckoutStep } from "@/components/CheckoutOverlay";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { useScanCredits } from "@/hooks/use-scan-credits";
import { supabase } from "@/integrations/supabase/client";
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
  hasResumeInSession
} from "@/hooks/use-session-resume";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { parseEdgeFunctionError } from "@/lib/edge-function-errors";
import { useAffiliateTracking, getStoredReferralCode } from "@/hooks/use-affiliate-auth";

interface FreeKeywordResult {
  industry: string;
  atsScoreEstimate: number;
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
}

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isFreeScanLoading, setIsFreeScanLoading] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('verifying');
  const [checkoutError, setCheckoutError] = useState<string | undefined>();
  const [checkoutUrl, setCheckoutUrl] = useState<string | undefined>(); // Store URL for fallback
  const [resumeText, setResumeText] = useState<string>("");
  const [linkedInText, setLinkedInText] = useState<string>("");
  const [jobDescriptionText, setJobDescriptionText] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [freeKeywordResult, setFreeKeywordResult] = useState<FreeKeywordResult | null>(null);
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
  
  // Track affiliate referrals
  useAffiliateTracking();
  
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

  // Check network connectivity - more forgiving check
  const checkConnection = async (): Promise<boolean> => {
    // First check browser's online status
    if (!navigator.onLine) {
      console.log("[Connection] Browser reports offline");
      return false;
    }
    
    // Quick connectivity test - try multiple methods for reliability
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // Increased timeout
      
      // Use Supabase client's built-in health check which handles auth properly
      const { error } = await supabase.rpc('get_today_scan_count');
      
      clearTimeout(timeoutId);
      
      // Even if the RPC returns an error, if we got a response the connection works
      // Only return false if it was an actual network failure
      if (error && (error.message?.includes('fetch') || error.message?.includes('network'))) {
        console.log("[Connection] Network error:", error.message);
        return false;
      }
      
      return true;
    } catch (err: any) {
      // Only fail on actual network errors, not server errors
      const isNetworkError = err?.message?.includes('fetch') || 
                            err?.message?.includes('network') ||
                            err?.message?.includes('Failed to fetch') ||
                            err?.name === 'AbortError';
      
      console.log("[Connection] Check error:", err?.message, "isNetworkError:", isNetworkError);
      
      // If it's not clearly a network error, assume connection is OK
      // and let the actual checkout call handle any errors
      return !isNetworkError;
    }
  };

  // Check if popups are likely blocked (for desktop in iframe)
  const checkPopupBlocked = (): boolean => {
    const inIframe = window.self !== window.top;
    if (!inIframe) return false;
    
    // Test popup capability
    const testWin = window.open('', '_blank', 'width=1,height=1');
    if (testWin) {
      testWin.close();
      return false;
    }
    return true;
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

  useEffect(() => {
    if (searchParams.get("canceled") === "true") {
      toast({
        title: "Payment canceled",
        description: "Your payment was canceled. You can try again when you're ready.",
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
        title: "Purchase canceled",
        description: "Your scan pack purchase was canceled.",
        variant: "destructive",
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [searchParams, toast, verifyPurchase]);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setFreeKeywordResult(null); // Clear previous results

    if (file.type === "text/plain") {
      const text = await file.text();
      setResumeText(text);
      saveResumeToSession(text); // Persist to session storage
      preStoreResume(text); // Pre-store server-side for faster checkout
      return;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const { data, error } = await supabase.functions.invoke("parse-pdf", {
          body: formData,
        });

        if (error) throw error;

        if (data?.success && data?.text) {
          setResumeText(data.text);
          saveResumeToSession(data.text); // Persist to session storage
          preStoreResume(data.text); // Pre-store server-side for faster checkout
          toast({
            title: "PDF parsed successfully",
            description: `Extracted text from ${data.pages} page(s).`,
          });
        } else {
          throw new Error(data?.error || "Failed to parse PDF");
        }
      } catch (error) {
        console.error("PDF parsing error:", error);
        toast({
          title: "PDF parsing failed",
          description: "Could not extract text from the PDF. Please try pasting the text manually.",
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

        const { data, error } = await supabase.functions.invoke("parse-docx", {
          body: formData,
        });

        if (error) throw error;

        if (data?.success && data?.text) {
          setResumeText(data.text);
          saveResumeToSession(data.text); // Persist to session storage
          preStoreResume(data.text); // Pre-store server-side for faster checkout
          toast({
            title: "Document parsed successfully",
            description: "Text extracted from your Word document.",
          });
        } else {
          throw new Error(data?.error || "Failed to parse DOCX");
        }
      } catch (error) {
        console.error("DOCX parsing error:", error);
        toast({
          title: "Document parsing failed",
          description: "Could not extract text from the DOCX. Please try pasting the text manually.",
          variant: "destructive",
        });
        setSelectedFile(null);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleFreeScan = async () => {
    const contentToAnalyze = resumeText;
    
    if (!contentToAnalyze && !selectedFile) {
      toast({
        title: "No resume provided",
        description: "Please upload a file or paste your resume text.",
        variant: "destructive",
      });
      return;
    }

    setIsFreeScanLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("free-keyword-scan", {
        body: { resumeText: contentToAnalyze, jobDescriptionText: jobDescriptionText || undefined, honeypot },
      });

      // Check for rate limit in error response or data
      if (error) {
        // Parse error context for rate limit info
        const errorContext = error?.context;
        if (errorContext?.body) {
          try {
            const errorBody = typeof errorContext.body === 'string' 
              ? JSON.parse(errorContext.body) 
              : errorContext.body;
            if (errorBody?.rateLimited) {
              setShowRateLimitUpsell(true);
              return;
            }
          } catch {
            // Not JSON, continue with regular error handling
          }
        }
        throw error;
      }

      if (data?.rateLimited) {
        setShowRateLimitUpsell(true);
        return;
      }

      if (data?.success) {
        setFreeKeywordResult({
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
          // Job matching fields
          jobMatchScore: data.jobMatchScore,
          jobMatchGrade: data.jobMatchGrade,
          matchingSkills: data.matchingSkills,
          missingSkills: data.missingSkills,
          experienceFit: data.experienceFit,
          titleAlignment: data.titleAlignment,
          jobMatchSummary: data.jobMatchSummary,
        });
        
        // Scroll to results
        setTimeout(() => {
          document.getElementById("free-results")?.scrollIntoView({ behavior: "smooth" });
        }, 100);
      } else {
        throw new Error(data?.error || "Failed to analyze resume");
      }
    } catch (error: any) {
      console.error("Free scan error:", error);
      
      // Check if error message contains rate limit info
      const errorMsg = error?.message?.toLowerCase() || '';
      if (errorMsg.includes('rate') || errorMsg.includes('limit') || errorMsg.includes('429')) {
        setShowRateLimitUpsell(true);
        return;
      }
      
      toast({
        title: "Analysis failed",
        description: error?.message || "Please try again.",
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
        title: "No resume found",
        description: "Please upload your resume first.",
        variant: "destructive",
      });
      return;
    }

    // Find the job description from uploadedJobs
    const targetJob = uploadedJobs.find(j => j.title === jobTitle && j.company === jobCompany);
    const jobDesc = targetJob?.description || `${jobTitle} at ${jobCompany}`;

    setIsFreeScanLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("free-keyword-scan", {
        body: { resumeText: contentToAnalyze, jobDescriptionText: jobDesc, honeypot },
      });

      if (error) {
        const errorContext = error?.context;
        if (errorContext?.body) {
          try {
            const errorBody = typeof errorContext.body === 'string' 
              ? JSON.parse(errorContext.body) 
              : errorContext.body;
            if (errorBody?.rateLimited) {
              setShowRateLimitUpsell(true);
              return;
            }
          } catch {
            // Not JSON, continue
          }
        }
        throw error;
      }

      if (data?.rateLimited) {
        setShowRateLimitUpsell(true);
        return;
      }

      if (data?.success) {
        setFreeKeywordResult({
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
        });
        
        toast({
          title: `Job Analysis Complete`,
          description: `Now showing how you match for ${jobTitle} at ${jobCompany}`,
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
        title: "No resume found",
        description: "Please upload your resume first.",
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
      const { data, error } = await supabase.functions.invoke("generate-tailored-resume", {
        body: {
          resumeText,
          jobTitle: targetTitle,
          jobCompany: currentJob?.company,
          jobDescription: currentJob?.description || jobDescriptionText || `A ${freeKeywordResult?.industry || "professional"} role requiring strong skills and experience.`,
          matchingSkills: freeKeywordResult?.matchingSkills,
          missingSkills: freeKeywordResult?.missingSkills,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setTailoredResumeContent(data);
        toast({
          title: "Tailored Resume Generated!",
          description: "Your resume has been customized for this role. Download the PDF to apply!",
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

  const handleTextSubmit = (text: string, linkedIn?: string, jobDescription?: string) => {
    setResumeText(text);
    setFreeKeywordResult(null);
    if (linkedIn) setLinkedInText(linkedIn);
    if (jobDescription) setJobDescriptionText(jobDescription);
    
    // Save to session storage so it persists across refreshes
    saveResumeToSession(text, linkedIn, jobDescription);
    
    handleCheckout(text, linkedIn, jobDescription);
  };

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
        title: "Resume required",
        description: "Please upload or paste your resume first, then try again.",
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
        setCheckoutError("No internet connection. Please check your network and try again.");
        setIsCheckoutLoading(false);
        setIsLoading(false);
        return;
      }
      
      // Check for popup blockers on desktop in iframe
      const inIframe = window.self !== window.top;
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (inIframe && !isMobile) {
        const popupsBlocked = checkPopupBlocked();
        if (popupsBlocked) {
          console.log("[Checkout] Popup blocker detected, will use clipboard fallback");
        }
      }
      
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

      // Retry logic for create-checkout (up to 3 attempts)
      let lastError: Error | null = null;
      let checkoutData: { url?: string; sessionId?: string } | null = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Checkout] Attempt ${attempt}/3`);
          
          // Wrap the API call in a timeout (30 seconds per attempt)
          const apiCall = supabase.functions.invoke("create-checkout", {
            body: { 
              resumeData: contentToAnalyze,
              hasLinkedIn: !!linkedInContent,
              tempSessionId: tempSessionData,
              currency: currency.code,
              promoCode,
            },
          });
          
          const { data, error } = await withTimeout(
            apiCall,
            30000,
            "Request timed out. Please check your connection and try again."
          );

          if (error) throw error;
          checkoutData = data;
          break; // Success, exit retry loop
        } catch (err: any) {
          lastError = err;
          console.warn(`[Checkout] Attempt ${attempt} failed:`, err?.message);
          if (attempt < 3) {
            // Wait before retry (exponential backoff: 1s, 2s)
            await new Promise(r => setTimeout(r, attempt * 1000));
          }
        }
      }

      if (!checkoutData?.url) {
        throw lastError || new Error("No checkout URL received after retries");
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
      let errorTitle = "Checkout failed";
      let errorDescription = "There was an error creating your checkout session. Please try again.";
      
      const errorMessage = error?.message?.toLowerCase() || '';
      const errorContext = error?.context?.body || '';
      
      if (errorMessage.includes('region') || errorContext.includes('region')) {
        errorTitle = "Service unavailable";
        errorDescription = "Our checkout service is not available in your region.";
      } else if (errorMessage.includes('rate') || errorMessage.includes('too many') || errorContext.includes('Too many')) {
        errorTitle = "Too many attempts";
        errorDescription = "Please wait a few minutes before trying again.";
      } else if (errorMessage.includes('unavailable') || errorContext.includes('unavailable')) {
        errorTitle = "Service temporarily unavailable";
        errorDescription = "Our payment service is temporarily down. Please try again in a few minutes.";
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
      <Header />

      <main id="main-content" className="pt-[88px]" role="main">
        <Hero />
        
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
          onCheckout={(linkedIn, jobDescription) => handleCheckout(undefined, linkedIn, jobDescription)}
          onFreeScan={handleFreeScan}
          isLoading={isLoading}
          isFreeScanLoading={isFreeScanLoading}
          hasContent={!!resumeText || !!selectedFile}
          linkedInText={linkedInText}
          onLinkedInTextChange={setLinkedInText}
          jobDescriptionText={jobDescriptionText}
          onJobDescriptionTextChange={setJobDescriptionText}
          onJobsChange={setUploadedJobs}
        />
        
        {/* How It Works - Show after uploader on mobile */}
        <div className="sm:hidden">
          <HowItWorks />
        </div>
        
        {/* Mini Pricing Cards - Featured packages */}
        <MiniPricingCards />

        {/* Free Keyword Results */}
        {freeKeywordResult && (
          <section id="free-results" className="py-12 scroll-mt-20">
            <div className="container">
              <FreeKeywordResults
                industry={freeKeywordResult.industry}
                atsScoreEstimate={freeKeywordResult.atsScoreEstimate}
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
                experienceFit={freeKeywordResult.experienceFit}
                titleAlignment={freeKeywordResult.titleAlignment}
                jobMatchSummary={freeKeywordResult.jobMatchSummary}
                applicationRecommendation={freeKeywordResult.applicationRecommendation}
                skillGapActions={freeKeywordResult.skillGapActions}
                competitiveAssessment={freeKeywordResult.competitiveAssessment}
                careerSituation={freeKeywordResult.careerSituation}
                formatRecommendation={freeKeywordResult.formatRecommendation}
                onGetFullAnalysis={() => handleCheckout(resumeText, linkedInText, jobDescriptionText)}
                onGetJobAnalysis={handleJobAnalysis}
                onGenerateTailoredResume={handleGenerateTailoredResume}
                isGeneratingTailored={isGeneratingTailored}
                isLoading={isLoading || isFreeScanLoading}
                resumeText={resumeText}
                jobDescriptionText={jobDescriptionText}
                jobTitle={uploadedJobs[0]?.title}
                jobCompany={uploadedJobs[0]?.company}
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
              Why Choose Resume Booster?
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
      
      
      
      <FloatingUploadButton />

      
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
