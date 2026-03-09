import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
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
  Calendar
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
import { getResumeFromSession, hasResumeInSession } from "@/hooks/use-session-resume";
import { ATSDefenseResults, type ATSDefenseData } from "@/components/ATSDefenseResults";
import { CareerSnapshotResults } from "@/components/CareerSnapshotResults";
import { GraduateGamePlanResults } from "@/components/GraduateGamePlanResults";
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
};

// Product-specific next steps and how-it-works info
const productInfo: Record<string, {
  howItWorks: string[];
  nextSteps: { icon: React.ElementType; title: string; description: string }[];
  deliveryTime: string;
  deliveryMethod: string;
}> = {
  basicKeywordFix: {
    howItWorks: [
      "Our AI analyzed your resume against ATS requirements",
      "We identified missing keywords that could boost your score",
      "Review the suggestions below and add them to your resume",
      "Re-upload to check your improved ATS score"
    ],
    nextSteps: [
      { icon: Target, title: "Review Keywords", description: "Check the missing keywords analysis below" },
      { icon: FileText, title: "Update Resume", description: "Add the suggested keywords to your resume" },
      { icon: TrendingUp, title: "Verify Improvement", description: "Re-scan to see your new ATS score" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  coverLetter: {
    howItWorks: [
      "Our AI analyzed your resume and the job requirements",
      "We crafted a personalized cover letter matching your experience",
      "Copy the letter below or download as a document",
      "Customize the greeting and company-specific details"
    ],
    nextSteps: [
      { icon: FileText, title: "Review Letter", description: "Read through your generated cover letter below" },
      { icon: Copy, title: "Copy or Download", description: "Get your letter in the format you need" },
      { icon: Mail, title: "Submit Application", description: "Send with your resume to apply" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  premiumPackage: {
    howItWorks: [
      "Our AI completely rewrote your resume for ATS optimization",
      "We added missing keywords and stronger action verbs",
      "Your cover letter is personalized to the target role",
      "Review the before/after comparison below",
      "Copy or download your new documents"
    ],
    nextSteps: [
      { icon: FileText, title: "Review Documents", description: "Check your new resume and cover letter below" },
      { icon: Copy, title: "Copy & Download", description: "Get your documents in the format you need" },
      { icon: Mail, title: "Apply Now", description: "Submit your optimized application" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  atsDefense: {
    howItWorks: [
      "Our AI performed a comprehensive ATS compatibility audit",
      "We analyzed your resume against 50+ ATS platforms",
      "Keywords optimized for up to 3 target roles",
      "Format restructured for maximum parseability",
      "LinkedIn alignment tips included"
    ],
    nextSteps: [
      { icon: ShieldCheck, title: "Review Audit", description: "Check your before/after ATS scores" },
      { icon: Target, title: "Apply Keywords", description: "Use the keyword bank for your industry" },
      { icon: FileText, title: "Copy Sections", description: "Use the optimized resume sections" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  careerBundle: {
    howItWorks: [
      "You now have 75 full resume analyses in your account",
      "Each analysis includes complete ATS scoring and optimization",
      "Use them across multiple job applications",
      "Credits never expire - use at your own pace",
      "Share with friends or family if you'd like"
    ],
    nextSteps: [
      { icon: Upload, title: "Start Using Credits", description: "Upload a resume to use your first credit" },
      { icon: Mail, title: "Track Your Credits", description: "Check 'My Credits' in the header to see your balance" },
      { icon: Zap, title: "Apply to More Jobs", description: "Use credits for each job application you target" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "Credits Added to Account"
  },
  scanPack: {
    howItWorks: [
      "10 scan credits have been added to your account",
      "Each scan analyzes your resume against a specific job",
      "Compare unlimited job descriptions with your credits",
      "Credits never expire"
    ],
    nextSteps: [
      { icon: Upload, title: "Upload Your Resume", description: "Go to the home page to start scanning" },
      { icon: Zap, title: "Use Your Credits", description: "Each scan uses one credit from your balance" },
      { icon: Mail, title: "Check Balance", description: "View remaining credits in 'My Credits'" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "Credits Added to Account"
  },
  careerSnapshot: {
    howItWorks: [
      "Our AI analyzed your career from a senior recruiter's perspective",
      "We evaluated your performance, trajectory, and credibility signals",
      "Identified how recruiters will perceive your background",
      "Generated strategic positioning recommendations",
      "Created actionable priority fixes you can implement today"
    ],
    nextSteps: [
      { icon: Target, title: "Review Your Score", description: "See your Career Signal Score breakdown" },
      { icon: Brain, title: "Understand Perception", description: "Learn how recruiters see your career" },
      { icon: FileText, title: "Apply Fixes", description: "Implement the priority recommendations" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  graduateGamePlan: {
    howItWorks: [
      "Our AI evaluated your resume readiness for the job market",
      "We identified roles that match your background and experience",
      "Created a targeted application strategy for new grads",
      "Generated networking scripts you can use immediately",
      "Built a 30-day action plan to land your first role"
    ],
    nextSteps: [
      { icon: CheckCircle2, title: "Check Readiness", description: "See if your resume is ready to apply" },
      { icon: Target, title: "Target Roles", description: "Review roles that fit your background" },
      { icon: Calendar, title: "Follow the Plan", description: "Execute the 30-day action plan" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  interviewCoach: {
    howItWorks: [
      "Our AI analyzed your resume to identify key experiences",
      "We generated personalized interview questions based on your background",
      "Each question includes STAR method guidance for strong answers",
      "Practice these to prepare for your next interview"
    ],
    nextSteps: [
      { icon: MessageSquare, title: "Review Questions", description: "Go through each personalized question" },
      { icon: Target, title: "Practice Answers", description: "Use the STAR method frameworks provided" },
      { icon: TrendingUp, title: "Build Confidence", description: "Rehearse until you feel ready" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  },
  careerPathSimulator: {
    howItWorks: [
      "Our AI analyzed your skills, experience, and career trajectory",
      "We identified 3 realistic career paths based on your background",
      "Each path includes skills gaps and timeline projections",
      "Use the action steps to pursue your preferred direction"
    ],
    nextSteps: [
      { icon: TrendingUp, title: "Explore Paths", description: "Review your 3 career trajectory options" },
      { icon: Target, title: "Identify Gaps", description: "See what skills you need for each path" },
      { icon: Calendar, title: "Plan Ahead", description: "Follow the timeline for your chosen path" }
    ],
    deliveryTime: "Instant",
    deliveryMethod: "On This Page"
  }
};

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
  const [searchParams] = useSearchParams();
  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [generatedContent, setGeneratedContent] = useState<KeywordData | CoverLetterData | PremiumPackageData | ATSDefenseData | null>(null);
  const [atsDefenseData, setAtsDefenseData] = useState<ATSDefenseData | null>(null);
  const [careerSnapshotData, setCareerSnapshotData] = useState<any>(null);
  const [graduateGamePlanData, setGraduateGamePlanData] = useState<any>(null);
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
  const info = productKey ? productInfo[productKey] : null;

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
      }
    } catch (error) {
      console.error('File parsing error:', error);
      toast({
        title: "Parsing failed",
        description: "Could not read the file. Please try pasting your resume text instead.",
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
                targetRoles: []
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
                jobDescription: sessionData.jobDescriptionText || undefined
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
        
        // Handle Graduate Game Plan - generate content with resume
        if (productKey === 'graduateGamePlan') {
          console.log('[ProductSuccess] Generating Graduate Game Plan');
          const sessionData = getResumeFromSession();
          if (sessionData.resumeText) {
            const { data: gameplanData, error: gameplanError } = await supabase.functions.invoke('generate-graduate-gameplan', {
              body: { 
                resumeText: sessionData.resumeText,
                jobDescription: sessionData.jobDescriptionText || undefined
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
        
        // Track successful purchase completion for non-streaming products
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
    productKey === 'graduateGamePlan'
  );

  // Show streaming UI for real-time generation - keep showing even after complete
  if (isStreaming || streamingContent) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-24 pb-20">
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
            productName={product?.name || "your content"}
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
              <h1 className="text-2xl font-bold">Verifying your purchase...</h1>
              <p className="text-muted-foreground">
                Just a moment while we confirm your payment
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
              <h1 className="text-3xl font-bold">Purchase Details Not Found</h1>
              <p className="text-muted-foreground">
                We couldn't find details about your purchase. If you completed a payment, 
                please check your email for confirmation.
              </p>
              <Button asChild size="lg">
                <Link to="/">
                  <Home className="w-4 h-4 mr-2" />
                  Go to Home
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
  const keywordData = isKeywordFix ? generatedContent as KeywordData : null;
  const coverLetterData = isCoverLetter ? generatedContent as CoverLetterData : null;
  const premiumData = isPremiumPackage ? generatedContent as PremiumPackageData : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 pb-20">
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
                  Your Results Are Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Keyword Analysis Results</h2>
                <p className="text-muted-foreground">{keywordData.summary}</p>
              </div>

              {/* Score */}
              <div className="max-w-sm mx-auto mb-8 p-6 rounded-2xl bg-card border border-border text-center">
                <div className="text-5xl font-bold text-primary mb-2">{keywordData.overallScore}%</div>
                <div className="text-sm text-muted-foreground">Current Keyword Optimization Score</div>
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
                  Your Cover Letter Is Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Your Personalized Cover Letter</h2>
                {coverLetterData.suggestedSubjectLine && (
                  <p className="text-muted-foreground">
                    Suggested subject: <span className="text-foreground">{coverLetterData.suggestedSubjectLine}</span>
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
                    {copied ? 'Copied!' : 'Copy'}
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
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3">Key Skills Highlighted</h3>
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
                  <h3 className="text-sm font-semibold mb-3">Alternative Opening Lines</h3>
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
                  Premium Package Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Your Optimized Documents</h2>
                <p className="text-muted-foreground">
                  Tailored for {premiumData.jobDetails?.title || 'your target role'}
                  {premiumData.jobDetails?.company ? ` at ${premiumData.jobDetails.company}` : ''}
                </p>
              </div>

              {/* ATS Score Improvement */}
              {premiumData.resume?.atsScore && (
                <div className="max-w-md mx-auto mb-8 p-6 rounded-2xl bg-card border border-border">
                  <div className="flex items-center justify-center gap-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-muted-foreground">{premiumData.resume.atsScore.before}%</div>
                      <div className="text-xs text-muted-foreground">Before</div>
                    </div>
                    <ArrowRight className="w-6 h-6 text-primary" />
                    <div className="text-center">
                      <div className="text-5xl font-bold text-success">{premiumData.resume.atsScore.after}%</div>
                      <div className="text-xs text-muted-foreground">After</div>
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
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Keywords Added</h3>
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
                        {copied ? 'Copied!' : 'Copy Resume'}
                      </Button>
                    </div>
                    <div className="p-6 md:p-8 rounded-2xl bg-card border border-border">
                      <h3 className="font-semibold mb-4 text-primary">Your Optimized Resume</h3>
                      <div className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap font-mono text-sm">
                        {premiumData.resume.rewrittenResume}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cover Letter Tab */}
              {activeTab === 'coverLetter' && premiumData.coverLetter && (
                <div className="space-y-6">
                  {premiumData.coverLetter.suggestedSubjectLine && (
                    <p className="text-center text-muted-foreground">
                      Suggested subject: <span className="text-foreground">{premiumData.coverLetter.suggestedSubjectLine}</span>
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
                        {copied ? 'Copied!' : 'Copy Letter'}
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
                      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Key Skills Highlighted</h3>
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
                  ATS Defense Report Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Your ATS Defense Complete Report</h2>
                <p className="text-muted-foreground">
                  Comprehensive ATS optimization with before/after analysis
                </p>
              </div>

              <ATSDefenseResults data={atsDefenseData} />
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
                  Career Intelligence Report Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Your Career Snapshot</h2>
                <p className="text-muted-foreground">
                  Recruiter-style career intelligence showing how your career looks at a glance
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
                  Your Game Plan is Ready
                </Badge>
                <h2 className="text-2xl font-bold mb-2">Graduate Game Plan</h2>
                <p className="text-muted-foreground">
                  A clear, step-by-step playbook for what to do next
                </p>
              </div>

              <GraduateGamePlanResults data={graduateGamePlanData} />
            </div>
          </section>
        )}

        {/* AI Generation Progress Overlay for Recovery Mode */}
        <AIGenerationProgress 
          isVisible={isRegenerating} 
          productName={product?.name || "your content"}
        />

        {/* No Generated Content - Show Inline Upload Recovery */}
        {(isKeywordFix || isCoverLetter || isPremiumPackage || isAtsDefense || isCareerSnapshot || isGraduateGamePlan) && !generatedContent && !atsDefenseData && !careerSnapshotData && !graduateGamePlanData && !verificationError && !isVerifying && !isRegenerating && (
          <section className="py-12 border-t border-border/50">
            <div className="container max-w-2xl">
              <div className="p-8 rounded-2xl bg-muted/50 border border-border">
                    <div className="text-center mb-6">
                      <Upload className="w-12 h-12 text-primary mx-auto mb-4" />
                      <h3 className="text-xl font-semibold mb-2">
                        {isCareerSnapshot ? 'Complete Your Career Snapshot' :
                         isGraduateGamePlan ? 'Complete Your Graduate Game Plan' :
                         isAtsDefense ? 'Complete Your ATS Defense Report' :
                         isPremiumPackage ? 'Complete Your Premium Package' :
                         isCoverLetter ? 'Complete Your Cover Letter' :
                         'Complete Your Keyword Analysis'}
                      </h3>
                      <p className="text-muted-foreground">
                        {isCareerSnapshot ?
                          'Upload your resume to get your career intelligence report.' :
                         isGraduateGamePlan ?
                          'Upload your resume to get your personalized game plan for landing your first role.' :
                         isAtsDefense ? 
                          'Upload your resume and optionally add target roles and job description for personalized optimization.' :
                         isPremiumPackage ?
                          'Upload your resume and add a job description to get your optimized resume and cover letter.' :
                         isCoverLetter ?
                          'Upload your resume and add the job details to generate a tailored cover letter.' :
                          'Upload your resume to get keyword optimization suggestions.'}
                      </p>
                    </div>

                    {/* Email Recovery Option */}
                    {!showEmailRecovery ? (
                      <div className="text-center mb-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
                        <p className="text-sm text-muted-foreground mb-2">
                          Already purchased and closed the tab? 
                        </p>
                        <Button 
                          variant="link" 
                          className="text-primary p-0 h-auto"
                          onClick={() => setShowEmailRecovery(true)}
                        >
                          Recover your results by email →
                        </Button>
                      </div>
                    ) : (
                      <div className="mb-6 p-4 rounded-xl bg-card border border-border">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-medium flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            Recover Previous Purchase
                          </h4>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setShowEmailRecovery(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                        <div className="space-y-3">
                          <Input
                            type="email"
                            placeholder="Enter the email used during checkout"
                            value={recoveryEmail}
                            onChange={(e) => setRecoveryEmail(e.target.value)}
                          />
                          <Button 
                            className="w-full gap-2"
                            disabled={!recoveryEmail || isRecoveringByEmail}
                            onClick={async () => {
                              setIsRecoveringByEmail(true);
                              try {
                                const { data, error } = await supabase.functions.invoke('recover-purchase', {
                                  body: { email: recoveryEmail }
                                });
                                
                                if (error) throw error;
                                
                                if (data?.found && data?.purchases?.length > 0) {
                                  // Find most recent purchase matching this product type
                                  const productTypeMap: Record<string, string> = {
                                    basicKeywordFix: 'basic_keyword_fix',
                                    coverLetter: 'cover_letter',
                                    premiumPackage: 'premium_package',
                                    atsDefense: 'ats_defense'
                                  };
                                  const targetType = productTypeMap[productKey || ''];
                                  const matchingPurchase = data.purchases.find(
                                    (p: any) => p.productType === targetType
                                  );
                                  
                                  if (matchingPurchase?.generatedContent) {
                                    if (productKey === 'atsDefense') {
                                      setAtsDefenseData(matchingPurchase.generatedContent);
                                    } else {
                                      setGeneratedContent(matchingPurchase.generatedContent);
                                    }
                                    setShowEmailRecovery(false);
                                    toast({
                                      title: "Content Recovered!",
                                      description: "Your previously generated content has been restored.",
                                    });
                                  } else {
                                    toast({
                                      title: "No matching content found",
                                      description: "We found purchases but no content for this product type.",
                                      variant: "destructive"
                                    });
                                  }
                                } else {
                                  toast({
                                    title: "No purchases found",
                                    description: "No purchases found for this email. Please check the email address.",
                                    variant: "destructive"
                                  });
                                }
                              } catch (err) {
                                console.error('Recovery error:', err);
                                toast({
                                  title: "Recovery failed",
                                  description: "Could not recover your purchase. Please try again.",
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
                                Looking up...
                              </>
                            ) : (
                              <>
                                <Mail className="w-4 h-4" />
                                Recover My Results
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
                        What you'll need for this package:
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
                            Resume <Badge variant="destructive" className="text-[10px] ml-1">Required</Badge>
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
                              Job Description <Badge variant="secondary" className="text-[10px] ml-1">Recommended</Badge>
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
                              Target Roles (1-3) <Badge variant="secondary" className="text-[10px] ml-1">Optional</Badge>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* File Upload */}
                    <div className="space-y-4">
                      <label className="text-sm font-medium text-foreground flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Your Resume
                        <Badge variant="destructive" className="text-[10px]">Required</Badge>
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
                            <span>Parsing file...</span>
                          </div>
                        ) : recoveryFile ? (
                          <div className="flex items-center justify-center gap-2 text-success">
                            <CheckCircle2 className="w-5 h-5" />
                            <span>{recoveryFile.name}</span>
                          </div>
                        ) : (
                          <div>
                            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                            <p className="font-medium">Drop your resume or click to upload</p>
                            <p className="text-sm text-muted-foreground">PDF, DOCX, or TXT</p>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-muted/50 px-2 text-muted-foreground">or paste text</span>
                        </div>
                      </div>

                      <Textarea
                        placeholder="Paste your resume text here..."
                        value={recoveryResumeText}
                        onChange={(e) => setRecoveryResumeText(e.target.value)}
                        className="min-h-[150px] resize-none"
                      />

                      {/* Target Roles - ATS Defense specific */}
                      {isAtsDefense && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-foreground">
                              Target Job Titles
                              <span className="text-muted-foreground font-normal ml-1">(up to 3)</span>
                            </label>
                            <Badge variant="secondary" className="text-xs">
                              Multi-role optimization
                            </Badge>
                          </div>
                          <div className="space-y-2">
                            {recoveryTargetRoles.map((role, index) => (
                              <div key={index} className="flex gap-2">
                                <Input
                                  placeholder={index === 0 ? "e.g., Software Engineer" : index === 1 ? "e.g., Full Stack Developer" : "e.g., Backend Engineer"}
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
                                    <span className="sr-only">Remove role</span>
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
                                + Add Another Target Role
                              </Button>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Add up to 3 job titles to optimize your resume for multiple roles simultaneously.
                          </p>
                        </div>
                      )}

                      {/* Job Description - for ATS Defense and other products */}
                      {(isAtsDefense || isKeywordFix || isCoverLetter || isPremiumPackage) && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Target className="w-4 h-4" />
                              Target Job Description
                              <Badge variant="secondary" className="text-[10px]">
                                {isCoverLetter || isPremiumPackage ? 'Recommended' : 'Optional'}
                              </Badge>
                            </label>
                          </div>
                          <Textarea
                            placeholder="Paste the job description you're targeting to get keyword-optimized recommendations..."
                            value={recoveryJobDescription}
                            onChange={(e) => setRecoveryJobDescription(e.target.value)}
                            className="min-h-[100px] resize-none"
                          />
                          <p className="text-xs text-muted-foreground">
                            Adding a job description helps us optimize your resume for specific keywords and requirements.
                          </p>
                        </div>
                      )}

                      <Button 
                        size="lg" 
                        className="w-full gap-2"
                        disabled={!recoveryResumeText || recoveryResumeText.length < 50 || isRegenerating || isStreaming}
                        onClick={() => {
                          // Use streaming for premium package and cover letter
                          if (isPremiumPackage || isCoverLetter) {
                            startStreamingGeneration(recoveryResumeText, recoveryJobDescription || undefined);
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
                            Generating...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Generate {isKeywordFix ? 'Keyword Analysis' : 
                                      isPremiumPackage ? 'Premium Package' : 
                                      isAtsDefense ? 'ATS Defense Report' :
                                      isCareerSnapshot ? 'Career Snapshot Report' :
                                      isGraduateGamePlan ? 'Graduate Game Plan Report' :
                                      'Cover Letter'}
                          </>
                        )}
                      </Button>

                      {recoveryResumeText && recoveryResumeText.length < 50 && (
                        <p className="text-sm text-destructive text-center">
                          Resume text is too short. Please provide more content.
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
              <h2 className="text-2xl font-bold mb-2">How It Works</h2>
              <p className="text-muted-foreground">Here's what happens next with your purchase</p>
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
              <h2 className="text-2xl font-bold mb-2">Your Next Steps</h2>
              <p className="text-muted-foreground">Get started with your purchase right away</p>
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
              <h2 className="text-2xl font-bold mb-2">What's Included</h2>
              <p className="text-muted-foreground">Everything you get with {product.name}</p>
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
              <h3 className="font-semibold mb-2">Need Help?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                If you have any questions about your purchase or need assistance, 
                our support team is here to help.
              </p>
              <Button variant="outline" asChild>
                <a href="mailto:support@resumebooster.com">
                  <Mail className="w-4 h-4 mr-2" />
                  Contact Support
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
