import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { AnalysisPreview } from "@/components/AnalysisPreview";
import { SocialProof } from "@/components/SocialProof";
import { Footer } from "@/components/Footer";
import { FAQ } from "@/components/FAQ";
import { ComparisonTable } from "@/components/ComparisonTable";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/use-currency";
import { supabase } from "@/integrations/supabase/client";
import { 
  cleanupExpiredResumeData, 
  setResumeData, 
  removeResumeData, 
  setCheckoutRedirect,
  setupUnloadCleanup 
} from "@/hooks/use-resume-storage";

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
}

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isFreeScanLoading, setIsFreeScanLoading] = useState(false);
  const [resumeText, setResumeText] = useState<string>("");
  const [linkedInText, setLinkedInText] = useState<string>("");
  const [jobDescriptionText, setJobDescriptionText] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [freeKeywordResult, setFreeKeywordResult] = useState<FreeKeywordResult | null>(null);
  const [honeypot, setHoneypot] = useState<string>(""); // Honeypot field for bot detection
  const { toast } = useToast();
  const { currency } = useCurrency();
  const [searchParams] = useSearchParams();

  // Cleanup expired data on mount and setup unload handler
  useEffect(() => {
    cleanupExpiredResumeData();
    const cleanup = setupUnloadCleanup();
    return cleanup;
  }, []);

  useEffect(() => {
    if (searchParams.get("canceled") === "true") {
      toast({
        title: "Payment canceled",
        description: "Your payment was canceled. You can try again when you're ready.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast]);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setFreeKeywordResult(null); // Clear previous results

    if (file.type === "text/plain") {
      const text = await file.text();
      setResumeText(text);
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
        body: { resumeText: contentToAnalyze, honeypot },
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
              toast({
                title: "Daily limit reached",
                description: "You've used all 4 free scans today. Get the full analysis for $25!",
                variant: "destructive",
              });
              return;
            }
          } catch {
            // Not JSON, continue with regular error handling
          }
        }
        throw error;
      }

      if (data?.rateLimited) {
        toast({
          title: "Daily limit reached",
          description: "You've used all 4 free scans today. Get the full analysis for $25!",
          variant: "destructive",
        });
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
        toast({
          title: "Daily limit reached",
          description: "You've used all 4 free scans today. Get the full analysis for $25!",
          variant: "destructive",
        });
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

  const handleTextSubmit = (text: string, linkedIn?: string, jobDescription?: string) => {
    setResumeText(text);
    setFreeKeywordResult(null);
    if (linkedIn) setLinkedInText(linkedIn);
    if (jobDescription) setJobDescriptionText(jobDescription);
    handleCheckout(text, linkedIn, jobDescription);
  };

  const handleCheckout = async (text?: string, linkedIn?: string, jobDescription?: string) => {
    const contentToAnalyze = text || resumeText;
    const linkedInContent = linkedIn || linkedInText;
    const jobDescriptionContent = jobDescription || jobDescriptionText;
    
    if (!contentToAnalyze && !selectedFile) {
      toast({
        title: "No resume provided",
        description: "Please upload a file or paste your resume text.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Store resume data server-side (returns UUID, not PII in browser)
      const { data: tempSessionData, error: tempError } = await supabase.rpc('store_temp_resume', {
        p_resume: contentToAnalyze,
        p_linkedin: linkedInContent || null,
        p_job_description: jobDescriptionContent || null
      });

      if (tempError) {
        console.error("Failed to store resume data:", tempError);
        throw new Error("Failed to prepare resume data");
      }

      // Store only the temp session UUID locally (no PII)
      setResumeData('tempSessionId', tempSessionData);

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { 
          resumeData: contentToAnalyze,
          hasLinkedIn: !!linkedInContent,
          tempSessionId: tempSessionData,
          currency: currency.code
        },
      });

      if (error) throw error;

      if (data?.url) {
        // Tie the temp session ID to this specific checkout session
        if (data?.sessionId) {
          setResumeData(`tempSessionId:${data.sessionId}`, tempSessionData);
        }

        // In the embedded preview, navigation to Stripe can be blocked.
        const inIframe = window.self !== window.top;
        if (inIframe) {
          const win = window.open(data.url, "_blank", "noopener,noreferrer");
          if (!win) {
            toast({
              title: "Popup blocked",
              description: "Allow popups for this site to open Stripe Checkout.",
              variant: "destructive",
            });
          }
          return;
        }

        // Mark that we're redirecting to checkout (don't cleanup on unload)
        setCheckoutRedirect(true);
        // Navigate in the same tab
        window.location.assign(data.url);
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      removeResumeData('tempSessionId');
      toast({
        title: "Checkout failed",
        description: "There was an error creating your checkout session. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main id="main-content" className="pt-16" role="main">
        <Hero />
        
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
        />

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
                onGetFullAnalysis={() => handleCheckout()}
                isLoading={isLoading}
              />
            </div>
          </section>
        )}
        
        <AnalysisPreview />
        
        <ComparisonTable />
        
        <SocialProof />
        
        <FAQ />
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
