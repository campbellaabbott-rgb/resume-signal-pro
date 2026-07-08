import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { 
  CheckCircle2, 
  Loader2, 
  FileText,
  MessageSquare,
  Crown,
  Package,
  Sparkles,
  ArrowRight,
  Mail,
  Clock,
  Upload,
  Download,
  Zap,
  Home,
  HelpCircle,
  Copy,
  Check,
  AlertCircle,
  Target,
  TrendingUp,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  Brain,
  Calendar,
  Coins,
  Send
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PRODUCTS, ProductId } from "@/config/products";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConversionTracking } from "@/hooks/use-conversion-tracking";
import { useFunnelTracking } from "@/hooks/use-funnel-tracking";
import { clearReferralCode } from "@/hooks/use-affiliate-auth";
import { getResumeFromSession, hasResumeInSession, getMultiColumnDetectedFromSession } from "@/hooks/use-session-resume";
import { InterviewCoach } from "@/components/InterviewCoach";
import { CareerPathSimulator } from "@/components/CareerPathSimulator";
import { ATSDefenseResults, type ATSDefenseData } from "@/components/ATSDefenseResults";
import { CareerSnapshotResults } from "@/components/CareerSnapshotResults";
import { GraduateGamePlanResults } from "@/components/GraduateGamePlanResults";
import { ApplyAssistantResults, ApplyPackageData } from "@/components/ApplyAssistantResults";
import { normalizeBuilderResume } from "@/types/resume-builder";
import { parseEdgeFunctionError } from "@/lib/edge-function-errors";
import { AIGenerationProgress } from "@/components/AIGenerationProgress";
import { useStreamingGeneration } from "@/hooks/use-streaming-generation";
import { StreamingContentDisplay } from "@/components/StreamingContentDisplay";
import { autoFixContent } from "@/lib/content-autofix";

// Map product keys to icons
const productIcons: Record<string, React.ElementType> = {
  basicKeywordFix: FileText,
  coverLetter: FileText,
  premiumPackage: Crown,
  careerBundle: Package,
  fullAnalysis: Sparkles,
  scanPack: Zap,
  atsDefense: ShieldCheck,
  careerSnapshot: Brain,
  graduateGamePlan: Target,
  interviewCoach: MessageSquare,
  careerPathSimulator: TrendingUp,
  applyAssistant: Send,
};

// Product-specific next steps and how-it-works info. Title/description text lives in
// src/i18n/locales/*.json under productSuccess.info.<key>.* — only the icons and the
// step count live here. See getProductInfo() below.
const productInfoIcons: Record<string, { nextSteps: React.ElementType[] }> = {
  basicKeywordFix: { nextSteps: [Target, FileText, TrendingUp] },
  coverLetter: { nextSteps: [FileText, Copy, Mail] },
  premiumPackage: { nextSteps: [FileText, Copy, Mail] },
  atsDefense: { nextSteps: [ShieldCheck, Target, FileText] },
  careerBundle: { nextSteps: [Upload, Mail, Zap] },
  scanPack: { nextSteps: [Upload, Zap, Mail] },
  careerSnapshot: { nextSteps: [Target, Brain, FileText] },
  graduateGamePlan: { nextSteps: [CheckCircle2, Target, Calendar] },
  interviewCoach: { nextSteps: [MessageSquare, Target, TrendingUp] },
  careerPathSimulator: { nextSteps: [TrendingUp, Target, Calendar] },
  applyAssistant: { nextSteps: [FileText, Send, Download] }
};

function getProductInfo(t: (key: string, options?: Record<string, unknown>) => unknown, key: string) {
  const icons = productInfoIcons[key];
  if (!icons) return null;
  return {
    howItWorks: t(`productSuccess.info.${key}.howItWorks`, { returnObjects: true }) as string[],
    nextSteps: icons.nextSteps.map((icon, i) => ({
      icon,
      title: t(`productSuccess.info.${key}.nextSteps.${i}.title`) as string,
      description: t(`productSuccess.info.${key}.nextSteps.${i}.description`) as string,
    })),
    deliveryTime: t(`productSuccess.info.${key}.deliveryTime`) as string,
    deliveryMethod: t(`productSuccess.info.${key}.deliveryMethod`) as string,
  };
}

interface KeywordData {
  missingKeywords: Array<{ keyword: string; importance: string; category: string; suggestion: string }>;
  industryKeywords: Array<{ keyword: string; relevance: string }>;
  actionVerbs: Array<{ current: string | null; suggested: string; context: string }>;
  skillGaps: Array<{ skill: string; reason: string; howToAdd: string }>;
  overallScore: number;
  summary: string;
}

interface CoverLetterData {
  coverLetter: string;
  openingLine: string;
  keySkillsHighlighted: string[];
  personalizedElements: string[];
  suggestedSubjectLine: string;
  alternateOpenings: string[];
}

interface PremiumPackageData {
  resume: {
    rewrittenResume: string;
    professionalSummary: string;
    keyChanges: Array<{ section: string; before: string; after: string; reason: string }>;
    addedKeywords: string[];
    atsScore: { before: number; after: number; improvement: string };
    highlights: string[];
  };
  coverLetter: {
    coverLetter: string;
    openingLine: string;
    keySkillsHighlighted: string[];
    suggestedSubjectLine: string;
  };
  originalResume: string;
  jobDetails: { title: string; company: string };
}

export default function ProductSuccess() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [generatedContent, setGeneratedContent] = useState<KeywordData | CoverLetterData | PremiumPackageData | ATSDefenseData | null>(null);
  const [atsDefenseData, setAtsDefenseData] = useState<ATSDefenseData | null>(null);
  // Captured alongside atsDefenseData so ATSDefenseResults can run the same
  // deterministic parse simulation shown on the free scan results page.
  const [atsDefenseResumeText, setAtsDefenseResumeText] = useState<string | null>(null);
  const [atsDefenseMultiColumnDetected, setAtsDefenseMultiColumnDetected] = useState<boolean | undefined>(undefined);
  const [careerSnapshotData, setCareerSnapshotData] = useState<any>(null);
  const [graduateGamePlanData, setGraduateGamePlanData] = useState<any>(null);
  const [scanCreditsResult, setScanCreditsResult] = useState<{ credits: number; email: string } | null>(null);
  // interviewCoach / careerPathSimulator are self-contained widgets that fetch their
  // own content on demand (same components used for free on the scan results page) —
  // they just need the resume text, not a pre-generated payload.
  const [coachResumeText, setCoachResumeText] = useState<string | null>(null);
  const [applyPackageData, setApplyPackageData] = useState<ApplyPackageData | null>(null);
  const [applyCoverLetter, setApplyCoverLetter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'resume' | 'coverLetter'>('resume');
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const { trackPurchaseCompleted } = useConversionTracking();
  const { trackPurchaseCompleted: trackFunnelPurchase } = useFunnelTracking();
  
  // Resume recovery state
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryResumeText, setRecoveryResumeText] = useState("");
  const [recoveryJobDescription, setRecoveryJobDescription] = useState("");
  const [recoveryTargetRoles, setRecoveryTargetRoles] = useState<string[]>(['']);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Email recovery state
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [isRecoveringByEmail, setIsRecoveringByEmail] = useState(false);
  const [showEmailRecovery, setShowEmailRecovery] = useState(false);
  
  // Streaming state for real-time content generation
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [streamingComplete, setStreamingComplete] = useState(false);
  
  const sessionId = searchParams.get("session_id");
  const productKey = searchParams.get("product") as ProductId | null;
  
  // Get product details
  const product = productKey && PRODUCTS[productKey] ? PRODUCTS[productKey] : null;
  const Icon = productKey ? productIcons[productKey] || Sparkles : Sparkles;
  const info = productKey ? getProductInfo(t, productKey) : null;

  // Try to recover resume from session storage
  const attemptSessionRecovery = useCallback(async () => {
    if (hasResumeInSession()) {
      const sessionData = getResumeFromSession();
      if (sessionData.resumeText) {
        console.log('[ProductSuccess] Found resume in session storage, attempting regeneration');
        setRecoveryResumeText(sessionData.resumeText);
        return sessionData.resumeText;
      }
    }
    return null;
  }, []);

  // Regenerate content with provided resume text
  const regenerateContent = useCallback(async (resumeText: string, jobDescription?: string, targetRoles?: string[]) => {
    if (!resumeText || resumeText.length < 50) {
      toast({
        title: "Resume too short",
        description: "Please provide a complete resume with at least 50 characters.",
        variant: "destructive"
      });
      return false;
    }

    // Apply Assistant needs two parallel calls and a required (not optional) job
    // description, so it doesn't fit the single-endpoint pattern below — handled
    // as its own branch that returns early.
    if (productKey === 'applyAssistant') {
      if (!jobDescription || jobDescription.trim().length < 30) {
        toast({
          title: "Job posting required",
          description: "Paste the job description you're applying to (at least 30 characters) before generating.",
          variant: "destructive"
        });
        return false;
      }

      setIsRegenerating(true);
      try {
        const [packageResult, coverLetterResult] = await Promise.all([
          supabase.functions.invoke('generate-apply-package', {
            body: { resumeText, jobPostingText: jobDescription, language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })() }
          }),
          supabase.functions.invoke('generate-cover-letter', {
            body: { resumeText, jobDescription, jobTitle: 'Target Position', tone: 'professional', language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })() }
          })
        ]);

        if (packageResult.error || !packageResult.data?.success) {
          const parsedError = await parseEdgeFunctionError(packageResult.error || new Error(packageResult.data?.error || 'Generation failed'));
          toast({ title: parsedError.title, description: parsedError.description, variant: "destructive" });
          return false;
        }

        // Normalize tailoredResume: the AI never includes an `id` per experience/
        // education entry (that's a client-only concern for React keys), so using
        // the raw response directly would give every entry the same undefined key.
        setApplyPackageData({
          ...(packageResult.data as ApplyPackageData),
          tailoredResume: normalizeBuilderResume(packageResult.data.tailoredResume),
        });
        if (!coverLetterResult.error && coverLetterResult.data?.data?.coverLetter) {
          setApplyCoverLetter(coverLetterResult.data.data.coverLetter);
        }
        setIsRecoveryMode(false);
        toast({ title: "Application Package Ready!", description: "Your tailored resume and cover letter are ready below." });
        return true;
      } catch (err) {
        console.error('Apply Assistant regeneration failed:', err);
        toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
        return false;
      } finally {
        setIsRegenerating(false);
      }
    }

    setIsRegenerating(true);

    try {
      let endpoint = '';
      let body: Record<string, unknown> = { resumeText };

      if (productKey === 'basicKeywordFix') {
        endpoint = 'generate-keyword-fix';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'coverLetter') {
        endpoint = 'generate-cover-letter';
        body.jobTitle = 'Target Position';
        body.tone = 'professional';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'premiumPackage') {
        endpoint = 'generate-premium-package';
        body.jobTitle = 'Target Position';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'atsDefense') {
        endpoint = 'generate-ats-defense';
        body.sessionId = sessionId;
        // Filter out empty role strings
        const validRoles = (targetRoles || []).filter(r => r.trim().length > 0);
        body.targetRoles = validRoles;
        body.allowRegeneration = true; // Flag to bypass session-used check for recovery
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'careerSnapshot') {
        endpoint = 'generate-career-snapshot';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'graduateGamePlan') {
        endpoint = 'generate-graduate-gameplan';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'interviewCoach') {
        endpoint = 'generate-interview-coach';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'careerPathSimulator') {
        endpoint = 'generate-career-path';
        if (jobDescription) body.jobDescription = jobDescription;
      }

      if (!endpoint) {
        toast({
          title: "Unsupported product",
          description: "Content generation is not available for this product.",
          variant: "destructive"
        });
        return false;
      }

      console.log(`[ProductSuccess] Regenerating content via ${endpoint}`);
      
      const { data, error } = await supabase.functions.invoke(endpoint, { body });

      if (error) {
        console.error('Regeneration error:', error);
        const parsedError = await parseEdgeFunctionError(error);
        toast({
          title: parsedError.title,
          description: parsedError.description,
          variant: "destructive"
        });
        return false;
      }

      // Handle ATS Defense response (has .report)
      if (productKey === 'atsDefense' && data?.report) {
        setAtsDefenseData(data.report);
        // No layout/position data when resumeText came from manual paste/upload
        // recovery rather than the original PDF parse.
        setAtsDefenseResumeText(resumeText);
        setAtsDefenseMultiColumnDetected(undefined);
        setIsRecoveryMode(false);
        toast({
          title: "ATS Defense Report Generated!",
          description: "Your comprehensive analysis is ready below.",
        });
        return true;
      }

      // Handle Career Snapshot response
      if (productKey === 'careerSnapshot' && data?.data) {
        setCareerSnapshotData(data.data);
        setIsRecoveryMode(false);
        toast({
          title: "Career Snapshot Generated!",
          description: "Your career intelligence report is ready below.",
        });
        return true;
      }

      // Handle Graduate Game Plan response
      if (productKey === 'graduateGamePlan' && data?.data) {
        setGraduateGamePlanData(data.data);
        setIsRecoveryMode(false);
        toast({
          title: "Graduate Game Plan Generated!",
          description: "Your action plan is ready below.",
        });
        return true;
      }

      if (data?.data || data?.success) {
        setGeneratedContent(data.data || data);
        setIsRecoveryMode(false);
        toast({
          title: "Content Generated!",
          description: "Your analysis is ready below.",
        });
        return true;
      }

      return false;
    } catch (err) {
      console.error('Regeneration failed:', err);
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive"
      });
      return false;
    } finally {
      setIsRegenerating(false);
    }
  }, [productKey, sessionId, toast]);

  // Streaming generation for premium package and cover letter
  // Ref to track if streaming has started to prevent double-execution
  const streamingStartedRef = useRef(false);

  const startStreamingGeneration = useCallback(async (resumeText: string, jobDescription?: string) => {
    // Prevent double-execution
    if (streamingStartedRef.current) {
      console.log('[ProductSuccess] Streaming already started, skipping');
      return;
    }
    streamingStartedRef.current = true;

    if (!resumeText || resumeText.length < 50) {
      toast({
        title: "Resume too short",
        description: "Please provide a complete resume with at least 50 characters.",
        variant: "destructive"
      });
      streamingStartedRef.current = false;
      return;
    }

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingError(null);
    setStreamingComplete(false);

    try {
      let endpoint = '';
      const body: Record<string, unknown> = { resumeText };
      
      if (productKey === 'coverLetter') {
        endpoint = 'generate-cover-letter-stream';
        body.jobTitle = 'Target Position';
        body.tone = 'professional';
        if (jobDescription) body.jobDescription = jobDescription;
      } else if (productKey === 'premiumPackage') {
        endpoint = 'generate-premium-package-stream';
        body.jobTitle = 'Target Position';
        if (jobDescription) body.jobDescription = jobDescription;
      }

      if (!endpoint) {
        // Fall back to non-streaming for unsupported products
        streamingStartedRef.current = false;
        await regenerateContent(resumeText, jobDescription);
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      console.log(`[ProductSuccess] Starting streaming generation via ${endpoint}`);
      
      const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr);
              
              if (event.type === 'content' && event.content) {
                fullContent += event.content;
                setStreamingContent(fullContent);
              } else if (event.type === 'complete' || event.type === 'done') {
                setStreamingComplete(true);
              } else if (event.type === 'error') {
                throw new Error(event.message || 'Stream error');
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }

      // Apply auto-fix to the complete content before marking as complete
      if (fullContent) {
        const originalResume = resumeText || undefined;
        const { fixed, corrections } = autoFixContent(fullContent, originalResume);
        if (corrections.length > 0) {
          console.log(`[ProductSuccess] Applied ${corrections.length} auto-fixes to streamed content`);
          setStreamingContent(fixed);
        }
      }

      setStreamingComplete(true);
      setIsStreaming(false);
      streamingStartedRef.current = false; // Allow re-generation after successful stream

      // Track success
      if (productKey && product) {
        trackPurchaseCompleted(productKey, product.priceUsd, sessionId);
        trackFunnelPurchase(productKey, product.priceUsd, sessionId || undefined);
        clearReferralCode();
      }

    } catch (error) {
      console.error('[ProductSuccess] Streaming error:', error);
      setStreamingError(error instanceof Error ? error.message : 'Unknown error');
      setIsStreaming(false);
      streamingStartedRef.current = false; // Allow retry on error
      toast({
        title: "Generation Error",
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: "destructive"
      });
    }
  }, [productKey, product, sessionId, toast, regenerateContent, trackPurchaseCompleted, trackFunnelPurchase]);

  // Handle file upload for recovery
  const handleRecoveryFileUpload = useCallback(async (file: File) => {
    setRecoveryFile(file);
    setIsParsingFile(true);

    try {
      if (file.type === "text/plain") {
        const text = await file.text();
        setRecoveryResumeText(text);
        setIsParsingFile(false);
        return;
      }

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const formData = new FormData();
        formData.append("file", file);
        
        const { data, error } = await supabase.functions.invoke("parse-pdf", { body: formData });
        
        if (error) throw error;
        if (data?.success && data?.text) {
          setRecoveryResumeText(data.text);
        } else {
          throw new Error("Failed to parse PDF");
        }
      } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
                 file.name.toLowerCase().endsWith(".docx")) {
        const formData = new FormData();
        formData.append("file", file);
        
        const { data, error } = await supabase.functions.invoke("parse-docx", { body: formData });
        
        if (error) throw error;
        if (data?.success && data?.text) {
          setRecoveryResumeText(data.text);
        } else {
          throw new Error("Failed to parse document");
        }
      } else {
        // Unrecognized type (legacy .doc, .rtf, .odt, etc.) — without this,
        // none of the branches above run and the file sits "selected" with no
        // text ever extracted and no indication anything went wrong.
        throw new Error("Unsupported file type. Please upload a PDF or Word (.docx) file, or paste your resume text instead. Older .doc files aren't supported — save as .docx first.");
      }
    } catch (error) {
      console.error('File parsing error:', error);
      toast({
        title: "Parsing failed",
        description: error instanceof Error ? error.message : "Could not read the file. Please try pasting your resume text instead.",
        variant: "destructive"
      });
      setRecoveryFile(null);
    } finally {
      setIsParsingFile(false);
    }
  }, [toast]);

  // Ref to track if verification has run to prevent double-execution
  const verificationStartedRef = useRef(false);

  useEffect(() => {
    async function verifyAndGenerate() {
      // Prevent double-execution
      if (verificationStartedRef.current) {
        console.log('[ProductSuccess] Verification already started, skipping');
        return;
      }
      
      if (!sessionId) {
        setIsVerifying(false);
        return;
      }

      verificationStartedRef.current = true;

      try {
        // For premium package and cover letter, use streaming generation for real-time UX
        const useStreaming = productKey === 'premiumPackage' || productKey === 'coverLetter';
        
        // Verify purchase first (don't generate content if we'll stream)
        const { data, error } = await supabase.functions.invoke('verify-product-purchase', {
          body: { 
            sessionId, 
            generateContent: !useStreaming && (productKey === 'basicKeywordFix')
          }
        });

        if (error) {
          console.error('Verification error:', error);
          setVerificationError(error.message);
          setIsVerifying(false);
          return;
        }
        
        // If we already have generated content from the verification, use it
        if (data?.generatedContent) {
          setGeneratedContent(data.generatedContent);

          // Scan pack / career bundle purchases grant credits rather than generated
          // content. Persist the purchase email so the header's "My Credits" widget
          // picks it up automatically, and surface an explicit on-page confirmation —
          // otherwise the customer has no way to know the credits actually landed
          // without manually finding and re-entering their email in that widget.
          if (
            productKey === 'scanPack' &&
            typeof data.generatedContent === 'object' &&
            data.generatedContent !== null &&
            'credits' in data.generatedContent &&
            data?.customerEmail
          ) {
            const normalizedEmail = String(data.customerEmail).toLowerCase().trim();
            localStorage.setItem('scanCreditsEmail', normalizedEmail);
            // The header's credits widget already mounted (and read localStorage)
            // before this async verification resolved, so it won't pick up the new
            // email on its own — notify it directly so the badge updates without
            // requiring a page refresh.
            window.dispatchEvent(new CustomEvent('scanCreditsEmailUpdated', { detail: { email: normalizedEmail } }));
            setScanCreditsResult({
              credits: Number((data.generatedContent as { credits: number }).credits) || 0,
              email: normalizedEmail
            });
          }

          // Track purchase completion
          if (productKey && product) {
            trackPurchaseCompleted(productKey, product.priceUsd, sessionId);
            trackFunnelPurchase(productKey, product.priceUsd, sessionId || undefined);
            clearReferralCode();
          }
          setIsVerifying(false);
          return;
        }
        
        // For streaming products, get resume from session and start streaming
        if (useStreaming) {
          console.log('[ProductSuccess] Starting streaming generation for', productKey);
          const sessionData = getResumeFromSession();
          
          if (sessionData.resumeText) {
            setIsVerifying(false); // Stop showing verifying, will show streaming UI
            startStreamingGeneration(sessionData.resumeText, sessionData.jobDescriptionText);
          } else {
            // No resume in session, try recovery
            console.log('[ProductSuccess] No resume in session, entering recovery mode');
            setIsRecoveryMode(true);
            setIsVerifying(false);
          }
          return;
        }
        
        // For basicKeywordFix without generated content, try recovery
        if (productKey === 'basicKeywordFix' && !data?.generatedContent) {
          console.log('[ProductSuccess] No content generated for keyword fix, attempting recovery');
          const recoveredText = await attemptSessionRecovery();
          if (recoveredText) {
            const success = await regenerateContent(recoveredText);
            if (!success) {
              setIsRecoveryMode(true);
            }
          } else {
            setIsRecoveryMode(true);
          }
        }
        
        // Handle ATS Defense - generate content with session ID
        if (productKey === 'atsDefense') {
          console.log('[ProductSuccess] Generating ATS Defense report');
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText) {
            const { data: atsData, error: atsError } = await supabase.functions.invoke('generate-ats-defense', {
              body: {
                sessionId,
                resumeText: sessionData.resumeText,
                targetRoles: [],
                language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })()
              }
            });

            if (atsError) {
              console.error('ATS Defense generation error:', atsError);
              const parsedError = await parseEdgeFunctionError(atsError);
              toast({
                title: parsedError.title,
                description: parsedError.description,
                variant: "destructive"
              });
              setIsRecoveryMode(true);
            } else if (atsData?.report) {
              setAtsDefenseData(atsData.report);
              setAtsDefenseResumeText(sessionData.resumeText);
              setAtsDefenseMultiColumnDetected(getMultiColumnDetectedFromSession());
            } else {
              setIsRecoveryMode(true);
            }
          } else {
            setIsRecoveryMode(true);
          }
        }
        
        // Handle Career Snapshot - generate content with resume
        if (productKey === 'careerSnapshot') {
          console.log('[ProductSuccess] Generating Career Snapshot');
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText) {
            const { data: snapshotData, error: snapshotError } = await supabase.functions.invoke('generate-career-snapshot', {
              body: {
                resumeText: sessionData.resumeText,
                jobDescription: sessionData.jobDescriptionText || undefined,
                language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })()
              }
            });
            
            if (snapshotError) {
              console.error('Career Snapshot generation error:', snapshotError);
              const parsedError = await parseEdgeFunctionError(snapshotError);
              toast({
                title: parsedError.title,
                description: parsedError.description,
                variant: "destructive"
              });
              setIsRecoveryMode(true);
            } else if (snapshotData?.data) {
              setCareerSnapshotData(snapshotData.data);
            } else {
              setIsRecoveryMode(true);
            }
          } else {
            setIsRecoveryMode(true);
          }
        }

        // Handle Apply Assistant - needs BOTH resumeText and a job posting (reuses
        // the same jobDescriptionText session field the free scan's job-match
        // feature already populates). Unlike other products, a missing job
        // description isn't optional here — fall into recovery mode so the user
        // gets prompted for it explicitly.
        if (productKey === 'applyAssistant') {
          console.log('[ProductSuccess] Generating Apply Assistant package');
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText && sessionData.jobDescriptionText) {
            const [packageResult, coverLetterResult] = await Promise.all([
              supabase.functions.invoke('generate-apply-package', {
                body: {
                  resumeText: sessionData.resumeText,
                  jobPostingText: sessionData.jobDescriptionText,
                  language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })()
                }
              }),
              supabase.functions.invoke('generate-cover-letter', {
                body: {
                  resumeText: sessionData.resumeText,
                  jobDescription: sessionData.jobDescriptionText,
                  jobTitle: 'Target Position',
                  tone: 'professional',
                  language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })()
                }
              })
            ]);

            if (packageResult.error || !packageResult.data?.success) {
              console.error('Apply Assistant generation error:', packageResult.error || packageResult.data?.error);
              const parsedError = await parseEdgeFunctionError(packageResult.error || new Error(packageResult.data?.error || 'Generation failed'));
              toast({
                title: parsedError.title,
                description: parsedError.description,
                variant: "destructive"
              });
              setIsRecoveryMode(true);
            } else {
              setApplyPackageData({
                ...(packageResult.data as ApplyPackageData),
                tailoredResume: normalizeBuilderResume(packageResult.data.tailoredResume),
              });
              if (!coverLetterResult.error && coverLetterResult.data?.data?.coverLetter) {
                setApplyCoverLetter(coverLetterResult.data.data.coverLetter);
              }
            }
          } else {
            setIsRecoveryMode(true);
          }
        }

        // Handle Graduate Game Plan - generate content with resume
        if (productKey === 'graduateGamePlan') {
          console.log('[ProductSuccess] Generating Graduate Game Plan');
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText) {
            const { data: gameplanData, error: gameplanError } = await supabase.functions.invoke('generate-graduate-gameplan', {
              body: {
                resumeText: sessionData.resumeText,
                jobDescription: sessionData.jobDescriptionText || undefined,
                language: (() => { try { return localStorage.getItem('i18nextLng') || 'en'; } catch { return 'en'; } })()
              }
            });
            
            if (gameplanError) {
              console.error('Graduate Game Plan generation error:', gameplanError);
              const parsedError = await parseEdgeFunctionError(gameplanError);
              toast({
                title: parsedError.title,
                description: parsedError.description,
                variant: "destructive"
              });
              setIsRecoveryMode(true);
            } else if (gameplanData?.data) {
              setGraduateGamePlanData(gameplanData.data);
            } else {
              setIsRecoveryMode(true);
            }
          } else {
            setIsRecoveryMode(true);
          }
        }
        
        // Handle Interview Coach / Career Path Simulator — these are self-contained
        // widgets (the same ones shown for free on the scan results page) that fetch
        // their own content lazily on user interaction. We only need to hand them the
        // resume text; calling the edge function here ourselves would generate content
        // nobody can see, since there was no render path consuming it.
        if (productKey === 'interviewCoach' || productKey === 'careerPathSimulator') {
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText) {
            setCoachResumeText(sessionData.resumeText);
          } else {
            setIsRecoveryMode(true);
          }
        }
        
        if (productKey && product && !useStreaming) {
          trackPurchaseCompleted(productKey, product.priceUsd, sessionId);
          trackFunnelPurchase(productKey, product.priceUsd, sessionId || undefined);
          clearReferralCode();
        }
      } catch (err) {
        console.error('Verification failed:', err);
        setVerificationError('Failed to verify purchase');
      } finally {
        setIsVerifying(false);
      }
    }

    verifyAndGenerate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, productKey]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied!", description: "Content copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  // Determine if we should show generation progress
  const showGenerationProgress = isVerifying && (
    productKey === 'basicKeywordFix' || 
    productKey === 'coverLetter' || 
    productKey === 'premiumPackage' ||
    productKey === 'atsDefense' ||
    productKey === 'careerSnapshot' ||
    productKey === 'graduateGamePlan' ||
    productKey === 'interviewCoach' ||
    productKey === 'careerPathSimulator'
  );

  // Show streaming UI for real-time generation - keep showing even after complete
  if (isStreaming || streamingContent) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-16 pb-20">
          <div className="container max-w-4xl">
            {/* Streaming Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 mb-6">
                <Brain className={cn("w-10 h-10 text-primary", isStreaming && "animate-pulse")} />
              </div>
              <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                <Sparkles className="w-3 h-3 mr-1" />
                {streamingComplete ? 'GPT-5 Generation Complete' : 'GPT-5 Generating Live'}
              </Badge>
              <h1 className="text-3xl font-bold mb-2">
                {streamingComplete ? 'Your Content Is Ready!' : 'Watch Your Content Generate'}
              </h1>
              <p className="text-muted-foreground">
                {streamingComplete 
                  ? `Your ${product?.name || 'content'} has been generated successfully`
                  : `Your ${product?.name || 'content'} is being created in real-time`
                }
              </p>
            </div>

            {/* Streaming Content Display */}
            <StreamingContentDisplay
              content={streamingContent}
              isStreaming={isStreaming}
              isComplete={streamingComplete}
              error={streamingError}
              title={streamingComplete ? `Your ${product?.name || 'content'}` : `Generating ${product?.name || 'content'}...`}
              subtitle={streamingComplete ? "Copy or download your content below" : "Watch your personalized content appear word by word"}
            />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (isVerifying) {
    // Show AI generation progress for content products
    if (showGenerationProgress) {
      return (
        <div className="min-h-screen bg-background">
          <Header />
          <AIGenerationProgress 
            isVisible={true} 
            productName={product?.name || t('productSuccess.yourContent')}
          />
          <Footer />
        </div>
      );
    }

    // Standard verification for other products
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-32 pb-20">
          <div className="container max-w-2xl text-center">
            <div className="space-y-6 animate-fade-in">
              <div className="relative inline-flex items-center justify-center">
                <div className="absolute w-20 h-20 rounded-full border-2 border-primary/20" />
                <div className="absolute w-20 h-20 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                <CheckCircle2 className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-2xl font-bold">{t('productSuccess.verifyingPurchase')}</h1>
              <p className="text-muted-foreground">
                {t('productSuccess.confirmingPayment')}
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!product || !info) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-32 pb-20">
          <div className="container max-w-2xl text-center">
            <div className="space-y-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted border border-border">
                <HelpCircle className="w-10 h-10 text-muted-foreground" />
              </div>
              <h1 className="text-3xl font-bold">{t('productSuccess.purchaseNotFound')}</h1>
              <p className="text-muted-foreground">
                {t('productSuccess.purchaseNotFoundDescription')}
              </p>
              <Button asChild size="lg">
                <Link to="/">
                  <Home className="w-4 h-4 mr-2" />
                  {t('productSuccess.goToHome')}
                </Link>
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const isKeywordFix = productKey === 'basicKeywordFix';
  const isCoverLetter = productKey === 'coverLetter';
  const isPremiumPackage = productKey === 'premiumPackage';
  const isAtsDefense = productKey === 'atsDefense';
  const isCareerSnapshot = productKey === 'careerSnapshot';
  const isGraduateGamePlan = productKey === 'graduateGamePlan';
  const isInterviewCoach = productKey === 'interviewCoach';
  const isCareerPathSimulator = productKey === 'careerPathSimulator';
  const isApplyAssistant = productKey === 'applyAssistant';
  const keywordData = isKeywordFix ? generatedContent as KeywordData : null;
  const coverLetterData = isCoverLetter ? generatedContent as CoverLetterData : null;
  const premiumData = isPremiumPackage ? generatedContent as PremiumPackageData : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-16 pb-20">
        {/* Success Header */}
        <section className="py-12 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-success/10 rounded-full blur-[100px]" />
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-success/0 via-success to-success/0" />
          </div>

          <div className="container max-w-3xl relative">
            <div className="text-center space-y-6 animate-fade-in">
              {/* Success icon */}
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-success/20 to-success/5 border border-success/30">
                <CheckCircle2 className="w-12 h-12 text-success" />
              </div>

              <div>
                <Badge variant="secondary" className="mb-4 bg-success/10 text-success border-success/30">
                  Payment Successful
                </Badge>
                <h1 className="text-3xl md:text-4xl font-bold mb-3">
                  Thank You for Your Purchase!
                </h1>
                <p className="text-lg text-muted-foreground">
                  You've purchased the <span className="text-foreground font-semibold">{product.name}</span>
                </p>
              </div>

              {/* Product summary card */}
              <div className="max-w-md mx-auto p-6 rounded-2xl bg-card border border-border">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-7 h-7 text-primary" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-lg">{product.name}</h3>
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>{info.deliveryTime}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span>{info.deliveryMethod}</span>
                  </div>
                </div>
              </div>

              {/* Scan pack / career bundle credits confirmation */}
              {scanCreditsResult && (
                <div className="max-w-md mx-auto p-6 rounded-2xl bg-success/5 border border-success/30 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <Coins className="w-5 h-5 text-success" />
                    <h3 className="font-bold text-lg text-success">
                      {t('productSuccess.creditsAdded', { count: scanCreditsResult.credits })}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('productSuccess.creditsLiveOn')}{" "}
                    <span className="font-medium text-foreground">{scanCreditsResult.email}</span>.{" "}
                    {t('productSuccess.creditsBalancePrefix')} <strong>{t('productSuccess.myCredits')}</strong> {t('productSuccess.creditsBalanceSuffix')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Generated Content Section - Keyword Fix */}
        {isKeywordFix && keywordData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Sparkles className="w-3 h-3 mr-1" />
                  {t('productSuccess.resultsReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.keywordAnalysisResults')}</h2>
                <p className="text-muted-foreground">{keywordData.summary}</p>
              </div>

              {/* Score */}
              <div className="max-w-sm mx-auto mb-8 p-6 rounded-2xl bg-card border border-border text-center">
                <div className="text-5xl font-bold text-primary mb-2">{keywordData.overallScore}%</div>
                <div className="text-sm text-muted-foreground">{t('productSuccess.currentKeywordScore')}</div>
              </div>

              {/* Missing Keywords */}
              {keywordData.missingKeywords?.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Target className="w-5 h-5 text-destructive" />
                    Missing Keywords to Add
                  </h3>
                  <div className="grid gap-3">
                    {keywordData.missingKeywords.slice(0, 10).map((kw, i) => (
                      <div key={i} className="p-4 rounded-xl bg-card border border-border">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold">{kw.keyword}</span>
                              <Badge variant={kw.importance === 'critical' ? 'destructive' : kw.importance === 'high' ? 'default' : 'secondary'} className="text-xs">
                                {kw.importance}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{kw.category}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{kw.suggestion}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Verbs */}
              {keywordData.actionVerbs?.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Stronger Action Verbs
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {keywordData.actionVerbs.slice(0, 6).map((verb, i) => (
                      <div key={i} className="p-4 rounded-xl bg-card border border-border">
                        <div className="flex items-center gap-2 mb-2">
                          {verb.current && (
                            <>
                              <span className="text-muted-foreground line-through">{verb.current}</span>
                              <ArrowRight className="w-4 h-4 text-muted-foreground" />
                            </>
                          )}
                          <span className="font-semibold text-success">{verb.suggested}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{verb.context}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skill Gaps */}
              {keywordData.skillGaps?.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Lightbulb className="w-5 h-5 text-warning" />
                    Skill Gaps to Address
                  </h3>
                  <div className="grid gap-3">
                    {keywordData.skillGaps.slice(0, 5).map((gap, i) => (
                      <div key={i} className="p-4 rounded-xl bg-card border border-border">
                        <div className="font-semibold mb-1">{gap.skill}</div>
                        <p className="text-sm text-muted-foreground mb-2">{gap.reason}</p>
                        <p className="text-sm text-success">{gap.howToAdd}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Generated Content Section - Cover Letter */}
        {isCoverLetter && coverLetterData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-3xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Sparkles className="w-3 h-3 mr-1" />
                  {t('productSuccess.coverLetterReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.personalizedCoverLetter')}</h2>
                {coverLetterData.suggestedSubjectLine && (
                  <p className="text-muted-foreground">
                    {t('productSuccess.suggestedSubject')} <span className="text-foreground">{coverLetterData.suggestedSubjectLine}</span>
                  </p>
                )}
              </div>

              {/* Cover Letter Content */}
              <div className="relative">
                <div className="absolute top-4 right-4 z-10">
                  <Button 
                    variant="secondary" 
                    size="sm"
                    onClick={() => copyToClipboard(coverLetterData.coverLetter)}
                    className="gap-2"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? t('analysisResults.copied') : t('analysisResults.copy')}
                  </Button>
                </div>
                <div className="p-6 md:p-8 rounded-2xl bg-card border border-border">
                  <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                    {coverLetterData.coverLetter}
                  </div>
                </div>
              </div>

              {/* Key Skills Highlighted */}
              {coverLetterData.keySkillsHighlighted?.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t('productSuccess.keySkillsHighlighted')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {coverLetterData.keySkillsHighlighted.map((skill, i) => (
                      <Badge key={i} variant="secondary">{skill}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Alternate Openings */}
              {coverLetterData.alternateOpenings?.length > 0 && (
                <div className="mt-6 p-4 rounded-xl bg-muted/50 border border-border">
                  <h3 className="text-sm font-semibold mb-3">{t('productSuccess.alternativeOpeningLines')}</h3>
                  <ul className="space-y-2">
                    {coverLetterData.alternateOpenings.map((opening, i) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary font-bold">{i + 1}.</span>
                        <span>"{opening}"</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Generated Content Section - Premium Package */}
        {isPremiumPackage && premiumData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Crown className="w-3 h-3 mr-1" />
                  {t('productSuccess.premiumPackageReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.optimizedDocuments')}</h2>
                <p className="text-muted-foreground">
                  {t('productSuccess.tailoredFor', { role: premiumData.jobDetails?.title || t('productSuccess.yourTargetRole') })}
                  {premiumData.jobDetails?.company ? ` ${t('productSuccess.atCompany', { company: premiumData.jobDetails.company })}` : ''}
                </p>
              </div>

              {/* ATS Score Improvement */}
              {premiumData.resume?.atsScore && (
                <div className="max-w-md mx-auto mb-8 p-6 rounded-2xl bg-card border border-border">
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-muted-foreground">{premiumData.resume.atsScore.before}%</div>
                      <div className="text-xs text-muted-foreground">{t('productSuccess.before')}</div>
                    </div>
                    <ArrowRight className="w-6 h-6 text-primary" />
                    <div className="text-center">
                      <div className="text-5xl font-bold text-success">{premiumData.resume.atsScore.after}%</div>
                      <div className="text-xs text-muted-foreground">{t('productSuccess.after')}</div>
                    </div>
                  </div>
                  <p className="text-sm text-center text-muted-foreground mt-4">{premiumData.resume.atsScore.improvement}</p>
                </div>
              )}

              {/* Tab Navigation */}
              <div className="flex justify-center gap-2 mb-6">
                <Button
                  variant={activeTab === 'resume' ? 'default' : 'outline'}
                  onClick={() => setActiveTab('resume')}
                  className="gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Optimized Resume
                </Button>
                <Button
                  variant={activeTab === 'coverLetter' ? 'default' : 'outline'}
                  onClick={() => setActiveTab('coverLetter')}
                  className="gap-2"
                >
                  <Mail className="w-4 h-4" />
                  Cover Letter
                </Button>
              </div>

              {/* Resume Tab */}
              {activeTab === 'resume' && premiumData.resume && (
                <div className="space-y-6">
                  {/* Key Changes */}
                  {premiumData.resume.keyChanges?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-success" />
                        Key Improvements Made
                      </h3>
                      <div className="grid gap-3">
                        {premiumData.resume.keyChanges.slice(0, 5).map((change, i) => (
                          <div key={i} className="p-4 rounded-xl bg-card border border-border">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline">{change.section}</Badge>
                            </div>
                            <div className="grid md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Before: </span>
                                <span className="line-through text-muted-foreground/70">{change.before}</span>
                              </div>
                              <div>
                                <span className="text-success">After: </span>
                                <span>{change.after}</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">{change.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Added Keywords */}
                  {premiumData.resume.addedKeywords?.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t('productSuccess.keywordsAdded')}</h3>
                      <div className="flex flex-wrap gap-2">
                        {premiumData.resume.addedKeywords.map((kw, i) => (
                          <Badge key={i} variant="secondary" className="bg-success/10 text-success border-success/30">{kw}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rewritten Resume */}
                  <div className="relative">
                    <div className="absolute top-4 right-4 z-10">
                      <Button 
                        variant="secondary" 
                        size="sm"
                        onClick={() => copyToClipboard(premiumData.resume.rewrittenResume)}
                        className="gap-2"
                      >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copied ? t('analysisResults.copied') : t('productSuccess.copyResume')}
                      </Button>
                    </div>
                    <div className="p-6 md:p-8 rounded-2xl bg-card border border-border">
                      <h3 className="font-semibold mb-4 text-primary">{t('productSuccess.yourOptimizedResume')}</h3>
                      <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap font-mono text-sm">
                        {premiumData.resume.rewrittenResume}
                      </div>
                    </div>
                  </div>

                  {/* Typeset delivery: the same content as a real document.
                      Seeds the builder (which parses + applies professional
                      PDF/DOCX typography) instead of leaving the $25
                      deliverable as text on a webpage. */}
                  <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Turn this into a typeset document</p>
                      <p className="text-xs text-muted-foreground">Open your rewritten resume in the free builder — professionally formatted PDF and Word export, ready to send.</p>
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        try { sessionStorage.setItem('rb_resume_text', premiumData.resume.rewrittenResume); } catch { /* ignore */ }
                        window.location.href = '/builder';
                      }}
                    >
                      Open in builder →
                    </Button>
                  </div>
                </div>
              )}

              {/* Cover Letter Tab */}
              {activeTab === 'coverLetter' && premiumData.coverLetter && (
                <div className="space-y-6">
                  {premiumData.coverLetter.suggestedSubjectLine && (
                    <p className="text-center text-muted-foreground">
                      {t('productSuccess.suggestedSubject')} <span className="text-foreground">{premiumData.coverLetter.suggestedSubjectLine}</span>
                    </p>
                  )}

                  <div className="relative">
                    <div className="absolute top-4 right-4 z-10">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyToClipboard(premiumData.coverLetter.coverLetter)}
                        className="gap-2"
                      >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copied ? t('analysisResults.copied') : t('productSuccess.copyLetter')}
                      </Button>
                    </div>
                    <div className="p-6 md:p-8 rounded-2xl bg-card border border-border">
                      <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap">
                        {premiumData.coverLetter.coverLetter}
                      </div>
                    </div>
                  </div>

                  {premiumData.coverLetter.keySkillsHighlighted?.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">{t('productSuccess.keySkillsHighlighted')}</h3>
                      <div className="flex flex-wrap gap-2">
                        {premiumData.coverLetter.keySkillsHighlighted.map((skill, i) => (
                          <Badge key={i} variant="secondary">{skill}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Generated Content Section - ATS Defense */}
        {isAtsDefense && atsDefenseData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  {t('productSuccess.atsDefenseReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.atsDefenseCompleteReport')}</h2>
                <p className="text-muted-foreground">
                  {t('productSuccess.atsDefenseSubtitle')}
                </p>
              </div>

              <ATSDefenseResults
                data={atsDefenseData}
                resumeText={atsDefenseResumeText || undefined}
                multiColumnDetected={atsDefenseMultiColumnDetected}
              />
            </div>
          </section>
        )}

        {/* Generated Content Section - Career Snapshot */}
        {isCareerSnapshot && careerSnapshotData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Brain className="w-3 h-3 mr-1" />
                  {t('productSuccess.careerIntelligenceReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.yourCareerSnapshot')}</h2>
                <p className="text-muted-foreground">
                  {t('productSuccess.careerSnapshotSubtitle')}
                </p>
              </div>

              <CareerSnapshotResults data={careerSnapshotData} />
            </div>
          </section>
        )}

        {/* Generated Content Section - Graduate Game Plan */}
        {isGraduateGamePlan && graduateGamePlanData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Target className="w-3 h-3 mr-1" />
                  {t('productSuccess.gamePlanReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.graduateGamePlan')}</h2>
                <p className="text-muted-foreground">
                  {t('productSuccess.gamePlanSubtitle')}
                </p>
              </div>

              <GraduateGamePlanResults data={graduateGamePlanData} />
            </div>
          </section>
        )}

        {/* Generated Content Section - Apply Assistant */}
        {isApplyAssistant && applyPackageData && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Send className="w-3 h-3 mr-1" />
                  {t('productSuccess.applicationPackageReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">{t('productSuccess.applyAssistant')}</h2>
                <p className="text-muted-foreground">
                  {t('productSuccess.applyAssistantSubtitle')}
                </p>
              </div>

              <ApplyAssistantResults data={applyPackageData} coverLetter={applyCoverLetter || undefined} />
            </div>
          </section>
        )}

        {/* Generated Content Section - Interview Coach / Career Path Simulator */}
        {(isInterviewCoach || isCareerPathSimulator) && coachResumeText && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-4xl">
              <div className="text-center mb-8">
                <Badge className="mb-4 bg-primary/10 text-primary border-primary/30">
                  <Sparkles className="w-3 h-3 mr-1" />
                  {t('productSuccess.sessionReady')}
                </Badge>
                <h2 className="text-2xl font-bold mb-2">
                  {isInterviewCoach ? t('productSuccess.interviewCoach') : t('productSuccess.careerPathSimulator')}
                </h2>
                <p className="text-muted-foreground">
                  {isInterviewCoach
                    ? t('productSuccess.interviewCoachSubtitle')
                    : t('productSuccess.careerPathSimulatorSubtitle')}
                </p>
              </div>

              {isInterviewCoach ? (
                <InterviewCoach resumeText={coachResumeText} isPremium />
              ) : (
                <CareerPathSimulator resumeText={coachResumeText} isPremium />
              )}
            </div>
          </section>
        )}

        {/* AI Generation Progress Overlay for Recovery Mode */}
        <AIGenerationProgress 
          isVisible={isRegenerating} 
          productName={product?.name || t('productSuccess.yourContent')}
        />

        {/* Verification Failed - don't leave the user on a blank page */}
        {verificationError && !isVerifying && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-2xl">
              <div className="p-8 rounded-2xl bg-muted/50 border border-border text-center">
                <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">{t('productSuccess.couldNotVerify')}</h3>
                <p className="text-muted-foreground mb-6">
                  {t('productSuccess.couldNotVerifyDescription')}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button onClick={() => window.location.reload()}>{t('productSuccess.tryAgain')}</Button>
                  <Button variant="outline" asChild>
                    <a href="mailto:resumeboostersupp@gmail.com">{t('productSuccess.contactSupport')}</a>
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* No Generated Content - Show Inline Upload Recovery */}
        {(isKeywordFix || isCoverLetter || isPremiumPackage || isAtsDefense || isCareerSnapshot || isGraduateGamePlan || isInterviewCoach || isCareerPathSimulator || isApplyAssistant) && !generatedContent && !atsDefenseData && !careerSnapshotData && !graduateGamePlanData && !coachResumeText && !applyPackageData && !verificationError && !isVerifying && !isRegenerating && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-2xl">
              <div className="p-8 rounded-2xl bg-muted/50 border border-border">
                    <div className="text-center mb-6">
                      <Upload className="w-12 h-12 text-primary mx-auto mb-4" />
                      <h3 className="text-xl font-semibold mb-2">
                        {isCareerSnapshot ? t('productSuccess.recovery.titleCareerSnapshot') :
                         isGraduateGamePlan ? t('productSuccess.recovery.titleGraduateGamePlan') :
                         isAtsDefense ? t('productSuccess.recovery.titleAtsDefense') :
                         isPremiumPackage ? t('productSuccess.recovery.titlePremiumPackage') :
                         isCoverLetter ? t('productSuccess.recovery.titleCoverLetter') :
                         isInterviewCoach ? t('productSuccess.recovery.titleInterviewCoach') :
                         isCareerPathSimulator ? t('productSuccess.recovery.titleCareerPathSimulator') :
                         isApplyAssistant ? t('productSuccess.recovery.titleApplyAssistant') :
                         t('productSuccess.recovery.titleKeywordFix')}
                      </h3>
                      <p className="text-muted-foreground">
                        {isCareerSnapshot ?
                          t('productSuccess.recovery.descCareerSnapshot') :
                         isGraduateGamePlan ?
                          t('productSuccess.recovery.descGraduateGamePlan') :
                         isAtsDefense ?
                          t('productSuccess.recovery.descAtsDefense') :
                         isPremiumPackage ?
                          t('productSuccess.recovery.descPremiumPackage') :
                         isCoverLetter ?
                          t('productSuccess.recovery.descCoverLetter') :
                         isInterviewCoach ?
                          t('productSuccess.recovery.descInterviewCoach') :
                         isCareerPathSimulator ?
                          t('productSuccess.recovery.descCareerPathSimulator') :
                         isApplyAssistant ?
                          t('productSuccess.recovery.descApplyAssistant') :
                          t('productSuccess.recovery.descKeywordFix')}
                      </p>
                    </div>

                    {/* Email Recovery Option */}
                    {!showEmailRecovery ? (
                      <div className="text-center mb-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground mb-2">
                          {t('productSuccess.recovery.alreadyPurchased')}
                        </p>
                        <Button
                          variant="link"
                          className="text-primary p-0 h-auto"
                          onClick={() => setShowEmailRecovery(true)}
                        >
                          {t('productSuccess.recovery.recoverResultsLink')}
                        </Button>
                      </div>
                    ) : (
                      <div className="mb-6 p-4 rounded-xl bg-card border border-border">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-medium flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            {t('productSuccess.recovery.recoverPreviousPurchase')}
                          </h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowEmailRecovery(false)}
                          >
                            {t('productSuccess.recovery.cancel')}
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {t('productSuccess.recovery.pasteLinkHelper')}
                        </p>
                        <div className="space-y-3">
                          <Input
                            type="text"
                            placeholder={t('productSuccess.recovery.sessionIdPlaceholder')}
                            value={recoveryEmail}
                            onChange={(e) => setRecoveryEmail(e.target.value)}
                          />
                          <Button
                            className="w-full gap-2"
                            disabled={!recoveryEmail || isRecoveringByEmail}
                            onClick={async () => {
                              setIsRecoveringByEmail(true);
                              try {
                                // Accept either a raw session ID or a pasted confirmation-email
                                // URL containing ?session_id=... — extract it either way.
                                const sessionIdMatch = recoveryEmail.match(/session_id=([^&\s]+)/);
                                const recoverySessionId = sessionIdMatch ? sessionIdMatch[1] : recoveryEmail.trim();

                                const { data, error } = await supabase.functions.invoke('recover-purchase', {
                                  body: { sessionId: recoverySessionId }
                                });
                                
                                if (error) throw error;
                                
                                if (data?.found && data?.purchases?.length > 0) {
                                  // Find most recent purchase matching this product type.
                                  // Note: scanPack/careerBundle aren't here — those are recovered
                                  // via the email lookup in the "My Credits" widget instead, since
                                  // there's no generatedContent blob to restore for credits. interviewCoach/
                                  // careerPathSimulator aren't here either — they're self-contained widgets
                                  // that only need resumeText (recovered via the upload form above), not a
                                  // pre-generated content blob.
                                  const productTypeMap: Record<string, string> = {
                                    basicKeywordFix: 'basic_keyword_fix',
                                    coverLetter: 'cover_letter',
                                    premiumPackage: 'premium_package',
                                    atsDefense: 'ats_defense',
                                    careerSnapshot: 'career_snapshot',
                                    graduateGamePlan: 'graduate_gameplan',
                                    applyAssistant: 'apply_assistant'
                                  };
                                  const targetType = productTypeMap[productKey || ''];
                                  const matchingPurchase = data.purchases.find(
                                    (p: any) => p.productType === targetType
                                  );

                                  if (matchingPurchase?.generatedContent) {
                                    if (productKey === 'atsDefense') {
                                      setAtsDefenseData(matchingPurchase.generatedContent);
                                    } else if (productKey === 'careerSnapshot') {
                                      setCareerSnapshotData(matchingPurchase.generatedContent);
                                    } else if (productKey === 'graduateGamePlan') {
                                      setGraduateGamePlanData(matchingPurchase.generatedContent);
                                    } else if (productKey === 'applyAssistant') {
                                      setApplyPackageData({
                                        ...matchingPurchase.generatedContent,
                                        tailoredResume: normalizeBuilderResume(matchingPurchase.generatedContent.tailoredResume),
                                      });
                                      setApplyCoverLetter(matchingPurchase.generatedContent.coverLetter || null);
                                    } else {
                                      setGeneratedContent(matchingPurchase.generatedContent);
                                    }
                                    setShowEmailRecovery(false);
                                    toast({
                                      title: t('productSuccess.recovery.contentRecoveredTitle'),
                                      description: t('productSuccess.recovery.contentRecoveredDescription'),
                                    });
                                  } else {
                                    toast({
                                      title: t('productSuccess.recovery.noMatchingContentTitle'),
                                      description: t('productSuccess.recovery.noMatchingContentDescription'),
                                      variant: "destructive"
                                    });
                                  }
                                } else {
                                  toast({
                                    title: t('productSuccess.recovery.noPurchasesFoundTitle'),
                                    description: t('productSuccess.recovery.noPurchasesFoundDescription'),
                                    variant: "destructive"
                                  });
                                }
                              } catch (err) {
                                console.error('Recovery error:', err);
                                toast({
                                  title: t('productSuccess.recovery.recoveryFailedTitle'),
                                  description: t('productSuccess.recovery.recoveryFailedDescription'),
                                  variant: "destructive"
                                });
                              } finally {
                                setIsRecoveringByEmail(false);
                              }
                            }}
                          >
                            {isRecoveringByEmail ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t('productSuccess.recovery.lookingUp')}
                              </>
                            ) : (
                              <>
                                <Mail className="w-4 h-4" />
                                {t('productSuccess.recovery.recoverMyResults')}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Requirements checklist */}
                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 mb-4">
                      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        {t('productSuccess.recovery.whatYouNeed')}
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <div className={cn(
                            "w-5 h-5 rounded-full flex items-center justify-center text-xs",
                            recoveryResumeText.length >= 50 ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
                          )}>
                            {recoveryResumeText.length >= 50 ? <Check className="w-3 h-3" /> : '1'}
                          </div>
                          <span className={recoveryResumeText.length >= 50 ? "text-success" : ""}>
                            {t('productSuccess.recovery.resumeLabel')} <Badge variant="destructive" className="text-[10px] ml-1">{t('productSuccess.recovery.required')}</Badge>
                          </span>
                        </div>
                        {(isCoverLetter || isPremiumPackage || isAtsDefense) && (
                          <div className="flex items-center gap-2 text-sm">
                            <div className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center text-xs",
                              recoveryJobDescription.length > 50 ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
                            )}>
                              {recoveryJobDescription.length > 50 ? <Check className="w-3 h-3" /> : '2'}
                            </div>
                            <span className={recoveryJobDescription.length > 50 ? "text-success" : ""}>
                              {t('productSuccess.recovery.jobDescriptionLabel')} <Badge variant="secondary" className="text-[10px] ml-1">{t('productSuccess.recovery.recommended')}</Badge>
                            </span>
                          </div>
                        )}
                        {isAtsDefense && (
                          <div className="flex items-center gap-2 text-sm">
                            <div className={cn(
                              "w-5 h-5 rounded-full flex items-center justify-center text-xs",
                              recoveryTargetRoles.some(r => r.trim().length > 0) ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
                            )}>
                              {recoveryTargetRoles.some(r => r.trim().length > 0) ? <Check className="w-3 h-3" /> : '3'}
                            </div>
                            <span className={recoveryTargetRoles.some(r => r.trim().length > 0) ? "text-success" : ""}>
                              {t('productSuccess.recovery.targetRolesLabel')} <Badge variant="secondary" className="text-[10px] ml-1">{t('productSuccess.recovery.optional')}</Badge>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* File Upload */}
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {t('productSuccess.recovery.yourResume')}
                        <Badge variant="destructive" className="text-[10px]">{t('productSuccess.recovery.required')}</Badge>
                      </label>
                      <div 
                        className={cn(
                          "relative rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer",
                          recoveryFile ? "border-success bg-success/5" : "border-border hover:border-primary/50 hover:bg-primary/5"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.docx,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleRecoveryFileUpload(file);
                          }}
                        />
                        {isParsingFile ? (
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="w-5 h-5 animate-spin text-primary" />
                            <span>{t('productSuccess.recovery.parsingFile')}</span>
                          </div>
                        ) : recoveryFile ? (
                          <div className="flex items-center justify-center gap-2 text-success">
                            <CheckCircle2 className="w-5 h-5" />
                            <span>{recoveryFile.name}</span>
                          </div>
                        ) : (
                          <div>
                            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="font-medium">{t('productSuccess.recovery.dropOrUpload')}</p>
                            <p className="text-sm text-muted-foreground">{t('productSuccess.recovery.fileTypes')}</p>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-muted/50 px-2 text-muted-foreground">{t('productSuccess.recovery.orPasteText')}</span>
                        </div>
                      </div>

                      <Textarea
                        placeholder={t('productSuccess.recovery.pasteResumePlaceholder')}
                        value={recoveryResumeText}
                        onChange={(e) => setRecoveryResumeText(e.target.value)}
                        className="min-h-[150px] resize-none"
                      />

                      {/* Target Roles - ATS Defense specific */}
                      {isAtsDefense && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-foreground">
                              {t('productSuccess.recovery.targetJobTitles')}
                              <span className="text-muted-foreground font-normal ml-1">{t('productSuccess.recovery.upToThree')}</span>
                            </label>
                            <Badge variant="secondary" className="text-xs">
                              {t('productSuccess.recovery.multiRoleOptimization')}
                            </Badge>
                          </div>
                          <div className="space-y-2">
                            {recoveryTargetRoles.map((role, index) => (
                              <div key={index} className="flex gap-2">
                                <Input
                                  placeholder={index === 0 ? t('productSuccess.recovery.roleExample1') : index === 1 ? t('productSuccess.recovery.roleExample2') : t('productSuccess.recovery.roleExample3')}
                                  value={role}
                                  onChange={(e) => {
                                    const newRoles = [...recoveryTargetRoles];
                                    newRoles[index] = e.target.value;
                                    setRecoveryTargetRoles(newRoles);
                                  }}
                                />
                                {index > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setRecoveryTargetRoles(recoveryTargetRoles.filter((_, i) => i !== index));
                                    }}
                                    className="shrink-0"
                                  >
                                    <span className="sr-only">{t('productSuccess.recovery.removeRole')}</span>
                                    ×
                                  </Button>
                                )}
                              </div>
                            ))}
                            {recoveryTargetRoles.length < 3 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRecoveryTargetRoles([...recoveryTargetRoles, ''])}
                                className="w-full"
                              >
                                {t('productSuccess.recovery.addAnotherTargetRole')}
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('productSuccess.recovery.targetRolesHelper')}
                          </p>
                        </div>
                      )}

                      {/* Job Description - for ATS Defense and other products */}
                      {(isAtsDefense || isKeywordFix || isCoverLetter || isPremiumPackage || isApplyAssistant) && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Target className="w-4 h-4" />
                              {isApplyAssistant ? t('productSuccess.recovery.jobPosting') : t('productSuccess.recovery.targetJobDescription')}
                              <Badge variant={isApplyAssistant ? 'destructive' : 'secondary'} className="text-[10px]">
                                {isApplyAssistant ? t('productSuccess.recovery.required') : isCoverLetter || isPremiumPackage ? t('productSuccess.recovery.recommended') : t('productSuccess.recovery.optional')}
                              </Badge>
                            </label>
                          </div>
                          <Textarea
                            placeholder={isApplyAssistant
                              ? t('productSuccess.recovery.jobPostingPlaceholder')
                              : t('productSuccess.recovery.jobDescriptionPlaceholder')}
                            value={recoveryJobDescription}
                            onChange={(e) => setRecoveryJobDescription(e.target.value)}
                            className="min-h-[100px] resize-none"
                          />
                          <p className="text-xs text-muted-foreground">
                            {isApplyAssistant
                              ? t('productSuccess.recovery.jobPostingHelper')
                              : t('productSuccess.recovery.jobDescriptionHelper')}
                          </p>
                        </div>
                      )}

                      <Button
                        size="lg"
                        className="w-full gap-2"
                        disabled={
                          !recoveryResumeText || recoveryResumeText.length < 50 || isRegenerating || isStreaming ||
                          (isApplyAssistant && recoveryJobDescription.trim().length < 30)
                        }
                        onClick={() => {
                          // Use streaming for premium package and cover letter
                          if (isPremiumPackage || isCoverLetter) {
                            startStreamingGeneration(recoveryResumeText, recoveryJobDescription || undefined);
                          } else if (isInterviewCoach || isCareerPathSimulator) {
                            // These are self-contained widgets that generate their own
                            // content on demand — just hand them the resume text.
                            setCoachResumeText(recoveryResumeText);
                          } else {
                            regenerateContent(
                              recoveryResumeText,
                              recoveryJobDescription || undefined,
                              isAtsDefense ? recoveryTargetRoles : undefined
                            );
                          }
                        }}
                      >
                        {isRegenerating || isStreaming ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {t('productSuccess.recovery.generating')}
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            {t('productSuccess.recovery.generate', { item: isKeywordFix ? t('productSuccess.recovery.itemKeywordAnalysis') :
                                      isPremiumPackage ? t('productSuccess.recovery.itemPremiumPackage') :
                                      isAtsDefense ? t('productSuccess.recovery.itemAtsDefenseReport') :
                                      isCareerSnapshot ? t('productSuccess.recovery.itemCareerSnapshotReport') :
                                      isGraduateGamePlan ? t('productSuccess.recovery.itemGraduateGamePlanReport') :
                                      isInterviewCoach ? t('productSuccess.recovery.itemInterviewQuestions') :
                                      isCareerPathSimulator ? t('productSuccess.recovery.itemCareerPaths') :
                                      isApplyAssistant ? t('productSuccess.recovery.itemApplicationPackage') :
                                      t('productSuccess.recovery.itemCoverLetter') })}
                          </>
                        )}
                      </Button>

                      {recoveryResumeText && recoveryResumeText.length < 50 && (
                        <p className="text-sm text-destructive text-center">
                          {t('productSuccess.recovery.resumeTooShort')}
                        </p>
                      )}
                    </div>
              </div>
            </div>
          </section>
        )}

        {/* How It Works */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">{t('productSuccess.howItWorksTitle')}</h2>
              <p className="text-muted-foreground">{t('productSuccess.howItWorksSubtitle')}</p>
            </div>

            <div className="space-y-4">
              {info.howItWorks.map((step, index) => (
                <div 
                  key={index}
                  className="flex items-start gap-4 p-4 rounded-xl bg-card/50 border border-border/50"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                    {index + 1}
                  </div>
                  <p className="text-foreground pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">{t('productSuccess.nextStepsTitle')}</h2>
              <p className="text-muted-foreground">{t('productSuccess.nextStepsSubtitle')}</p>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {info.nextSteps.map((step, index) => {
                const StepIcon = step.icon;
                return (
                  <div 
                    key={index}
                    className={cn(
                      "relative p-5 rounded-2xl border transition-all hover:shadow-lg",
                      index === 0 
                        ? "bg-primary/5 border-primary/30" 
                        : "bg-card border-border"
                    )}
                  >
                    {index === 0 && (
                      <Badge className="absolute -top-2 left-4 bg-primary text-primary-foreground text-xs">
                        Start Here
                      </Badge>
                    )}
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center mb-3",
                      index === 0 ? "bg-primary/20" : "bg-accent"
                    )}>
                      <StepIcon className={cn(
                        "w-5 h-5",
                        index === 0 ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <h3 className="font-semibold mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                );
              })}
            </div>

            {/* Main CTA */}
            <div className="text-center space-y-4">
              <Button asChild size="lg" className="gap-2 shadow-lg shadow-primary/20">
                <Link to="/">
                  <Sparkles className="w-4 h-4" />
                  {(isKeywordFix || isCoverLetter || isPremiumPackage) && generatedContent ? 'Scan Another Resume' : 'Get Started Now'}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">
                A confirmation email has been sent to your inbox
              </p>
            </div>
          </div>
        </section>

        {/* What's Included */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-3xl">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">{t('productSuccess.whatsIncluded')}</h2>
              <p className="text-muted-foreground">{t('productSuccess.everythingYouGet', { name: product.name })}</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              {product.features.map((feature, index) => (
                <div 
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border/50"
                >
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Help Section */}
        <section className="py-12 border-t border-border/50">
          <div className="container max-w-2xl text-center">
            <div className="p-6 rounded-2xl bg-card border border-border">
              <HelpCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold mb-2">{t('productSuccess.needHelp')}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t('productSuccess.needHelpDescription')}
              </p>
              <Button variant="outline" asChild>
                <a href="mailto:support@resumebooster.com">
                  <Mail className="w-4 h-4 mr-2" />
                  {t('productSuccess.contactSupport')}
                </a>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
