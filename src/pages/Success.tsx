import { useEffect, useState, useRef } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Share2, 
  Check, 
  Mail,
  Sparkles,
  FileText,
  ArrowRight,
  Download,
  Home,
  Printer,
  Trash2
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { ResumeRecovery } from "@/components/ResumeRecovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { 
  getResumeData, 
  removeResumeData, 
  cleanupExpiredResumeData 
} from "@/hooks/use-resume-storage";

// Analysis progress steps
const analysisSteps: Array<{id: number; label: string; icon: typeof CheckCircle2}> = [
  { id: 1, label: "Payment verified", icon: CheckCircle2 },
  { id: 2, label: "Parsing resume", icon: FileText },
  { id: 3, label: "AI analysis", icon: Sparkles },
  { id: 4, label: "Generating feedback", icon: ArrowRight },
];

const Success = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [needsResume, setNeedsResume] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const sessionId = searchParams.get("session_id");
  const shareIdParam = searchParams.get("share");

  // Simulate progress steps during loading
  useEffect(() => {
    if (isLoading && !shareIdParam && sessionId) {
      const stepDurations = [500, 1500, 3000];
      stepDurations.forEach((duration, index) => {
        setTimeout(() => {
          setCurrentStep(index + 2);
        }, duration);
      });
    }
  }, [isLoading, shareIdParam, sessionId]);

  // Cleanup expired data on mount
  useEffect(() => {
    cleanupExpiredResumeData();
  }, []);

  useEffect(() => {
    const runAnalysis = async (resumeText: string, linkedInText?: string, jobDescriptionText?: string, stripeSessionId?: string) => {
      try {
        console.log("Starting AI analysis...", linkedInText ? "(with LinkedIn)" : "", jobDescriptionText ? "(with Job Description)" : "");
        setCurrentStep(3);

        const { data, error: fnError } = await supabase.functions.invoke("analyze-resume", {
          body: { resumeText, linkedInText, jobDescriptionText, sessionId: stripeSessionId },
        });

        if (fnError) {
          console.error("Function error:", fnError);
          throw new Error(fnError.message || "Analysis failed");
        }

        if (data.error) {
          throw new Error(data.error);
        }

        setCurrentStep(4);
        const { shareId: newShareId, ...analysisResult } = data;
        setAnalysisData(analysisResult);
        setShareId(newShareId);

        // Clean up stored temp session IDs after successful analysis
        if (sessionId) {
          removeResumeData(`tempSessionId:${sessionId}`);
        }
        removeResumeData("tempSessionId");

        toast({
          title: "Payment successful!",
          description: data.hasLinkedIn 
            ? "Your resume + LinkedIn analysis is ready." 
            : "Your AI-powered resume analysis is ready.",
        });
      } catch (err) {
        console.error("Analysis error:", err);
        setError(err instanceof Error ? err.message : "Failed to analyze resume");
        toast({
          title: "Analysis failed",
          description: "There was an issue analyzing your resume. Please contact support.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    const loadAnalysis = async () => {
      // If share ID is provided, load from database via secure RPC function
      if (shareIdParam) {
        try {
          const { data, error: dbError } = await supabase
            .rpc("get_analysis_by_share_id", { share_id_param: shareIdParam });

          if (dbError) throw dbError;

          if (!data || data.length === 0) {
            setError("Analysis not found. The link may be invalid or expired.");
            setIsLoading(false);
            return;
          }

          const analysis = data[0];
          setAnalysisData(analysis.analysis_result as unknown as AnalysisData);
          setShareId(analysis.share_id);
          setIsLoading(false);
          return;
        } catch (err) {
          console.error("Error loading shared analysis:", err);
          setError("Failed to load analysis.");
          setIsLoading(false);
          return;
        }
      }

      // Otherwise, run new analysis after checkout
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      // Prefer session-scoped temp session ID, fallback to legacy key
      const tempSessionId =
        getResumeData(`tempSessionId:${sessionId}`) ||
        getResumeData("tempSessionId");

      if (!tempSessionId) {
        // No server-side temp session - show recovery UI
        setNeedsResume(true);
        setIsLoading(false);
        return;
      }

      // Retrieve resume data from server-side storage (auto-deletes after retrieval)
      try {
        const { data: tempData, error: tempError } = await supabase.rpc('get_temp_resume', {
          p_session_id: tempSessionId
        });

        if (tempError) {
          console.error("Error retrieving temp resume:", tempError);
          setNeedsResume(true);
          setIsLoading(false);
          return;
        }

        if (!tempData || tempData.length === 0 || !(tempData[0] as any).resume_text) {
          // Data expired or not found
          setNeedsResume(true);
          setIsLoading(false);
          return;
        }

        const storedResume = (tempData[0] as any).resume_text;
        const storedLinkedIn = (tempData[0] as any).linkedin_text;
        const storedJobDescription = (tempData[0] as any).job_description_text;

        setNeedsResume(false);
        await runAnalysis(storedResume, storedLinkedIn || undefined, storedJobDescription || undefined, sessionId);
      } catch (err) {
        console.error("Error loading temp resume:", err);
        setNeedsResume(true);
        setIsLoading(false);
      }
    };

    loadAnalysis();
  }, [sessionId, shareIdParam, toast]);

  const copyShareLink = async () => {
    if (!shareId) return;
    const shareUrl = `${window.location.origin}/success?share=${shareId}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast({
      title: "Link copied!",
      description: "Share this link to let others view your analysis.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const sendEmailAnalysis = async () => {
    if (!email || !analysisData || !shareId) return;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSendingEmail(true);
    try {
      const { error: fnError } = await supabase.functions.invoke('send-analysis-email', {
        body: { 
          email, 
          shareId,
          origin: window.location.origin,
          analysis: {
            industry: analysisData.industry,
            experienceLevel: analysisData.experienceLevel,
            hasLinkedIn: analysisData.hasLinkedIn,
            atsScore: analysisData.atsScore,
            readabilityMetrics: analysisData.readabilityMetrics,
            formatRecommendations: analysisData.formatRecommendations,
            resumeLength: analysisData.resumeLength,
            summaryRewrite: analysisData.summaryRewrite,
            optimizedBullets: analysisData.optimizedBullets || [],
            quantificationOpportunities: analysisData.quantificationOpportunities,
            skillsGap: analysisData.skillsGap,
            industryInsights: analysisData.industryInsights,
            actionVerbs: analysisData.actionVerbs || [],
            keywords: analysisData.keywords || [],
            redFlags: analysisData.redFlags || [],
            linkedInAnalysis: analysisData.linkedInAnalysis
          }
        }
      });

      if (fnError) throw fnError;

      setEmailSent(true);
      toast({
        title: "Email sent!",
        description: "Your complete analysis has been sent to your inbox.",
      });
    } catch (err) {
      console.error("Email error:", err);
      toast({
        title: "Failed to send email",
        description: "Please try again or copy the share link instead.",
        variant: "destructive",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSaveAsPdf = async () => {
    if (!analysisRef.current) return;

    setIsGeneratingPdf(true);
    try {
      // Dynamic imports to avoid build issues
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      console.log("[PDF] Generating resume analysis PDF...");

      const canvas = await html2canvas(analysisRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#0a0a0f",
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = canvas.height;
      const imgWidth = canvas.width;

      // Calculate total pages needed
      const scaledHeight = imgHeight * (pdfWidth / imgWidth);
      const pageHeight = pdfHeight;
      let heightLeft = scaledHeight;
      let position = 0;

      // First page
      pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, scaledHeight);
      heightLeft -= pageHeight;

      // Add more pages if needed
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, scaledHeight);
        heightLeft -= pageHeight;
      }

      // Use jsPDF's native save method for reliable direct downloads
      pdf.save("resume-analysis.pdf");

      toast({
        title: "PDF downloaded!",
        description: "Check your Downloads folder.",
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      toast({
        title: "Failed to generate PDF",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDeleteData = async () => {
    if (!shareId) return;

    setIsDeleting(true);
    try {
      const { data, error: deleteError } = await supabase.rpc('delete_analysis_by_share_id', {
        p_share_id: shareId
      });

      if (deleteError) throw deleteError;

      toast({
        title: "Data deleted",
        description: "Your resume analysis has been permanently deleted.",
      });

      // Redirect to home after deletion
      navigate('/');
    } catch (err) {
      console.error("Delete error:", err);
      toast({
        title: "Failed to delete data",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const isSharedView = !!shareIdParam;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-16">
        <section className="py-16 md:py-24 relative overflow-hidden">
          {/* Background effects */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
            {analysisData && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/0 via-success to-primary/0" />
            )}
          </div>

          <div className="container relative">
            <div className="max-w-2xl mx-auto text-center">
              {isLoading ? (
                <div className="space-y-8 animate-fade-in">
                  {/* Loading spinner */}
                  <div className="relative inline-flex items-center justify-center">
                    <div className="absolute w-24 h-24 rounded-full border-2 border-primary/20" />
                    <div className="absolute w-24 h-24 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>

                  <div>
                    <h1 className="text-3xl md:text-4xl font-bold mb-3">
                      {isSharedView ? "Loading analysis..." : "Analyzing your resume..."}
                    </h1>
                    <p className="text-muted-foreground text-lg">
                      {isSharedView 
                        ? "Fetching the saved analysis." 
                        : "Our AI is reviewing your resume with recruiter-grade precision."}
                    </p>
                  </div>

                  {/* Progress steps */}
                  {!isSharedView && (
                    <div className="max-w-md mx-auto pt-4">
                      <div className="space-y-3">
                        {analysisSteps.map((step) => {
                          const StepIcon = step.icon;
                          const isComplete = currentStep > step.id;
                          const isCurrent = currentStep === step.id;
                          
                          return (
                            <div 
                              key={step.id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300",
                                isComplete && "bg-success/10 border border-success/20",
                                isCurrent && "bg-primary/10 border border-primary/20",
                                !isComplete && !isCurrent && "bg-card/50 border border-border/50 opacity-50"
                              )}
                            >
                              <div className={cn(
                                "w-8 h-8 rounded-lg flex items-center justify-center",
                                isComplete && "bg-success/20 text-success",
                                isCurrent && "bg-primary/20 text-primary",
                                !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                              )}>
                                {isComplete ? (
                                  <Check className="w-4 h-4" />
                                ) : isCurrent ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <StepIcon className="w-4 h-4" />
                                )}
                              </div>
                              <span className={cn(
                                "text-sm font-medium",
                                isComplete && "text-success",
                                isCurrent && "text-primary",
                                !isComplete && !isCurrent && "text-muted-foreground"
                              )}>
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : needsResume ? (
                <div className="animate-fade-in">
                  <ResumeRecovery
                    disabled={isLoading}
                    onResumeTextReady={(text) => {
                      // User already paid - send directly to analysis without storing locally
                      setNeedsResume(false);
                      setIsLoading(true);
                      setCurrentStep(2);
                      setError(null);

                      void supabase.functions
                        .invoke("analyze-resume", { body: { resumeText: text, sessionId } })
                        .then(({ data, error: fnError }) => {
                          if (fnError) throw fnError;
                          if (data?.error) throw new Error(data.error);

                          const { shareId: newShareId, ...analysisResult } = data;
                          setAnalysisData(analysisResult);
                          setShareId(newShareId);

                          toast({
                            title: "Analysis ready",
                            description: "Your resume analysis is ready below.",
                          });
                        })
                        .catch((err) => {
                          console.error("Analysis error:", err);
                          setError(err instanceof Error ? err.message : "Failed to analyze resume");
                          toast({
                            title: "Analysis failed",
                            description: "There was an issue analyzing your resume. Please try again.",
                            variant: "destructive",
                          });
                        })
                        .finally(() => setIsLoading(false));
                    }}
                  />
                </div>
              ) : error ? (
                <div className="space-y-6 animate-fade-in">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-10 h-10 text-destructive" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold">
                    {isSharedView ? "Analysis Not Found" : "Analysis Error"}
                  </h1>
                  <p className="text-muted-foreground text-lg max-w-md mx-auto">{error}</p>
                  <Link to="/">
                    <Button variant="outline" size="lg" className="gap-2">
                      <Home className="w-4 h-4" />
                      Go Back Home
                    </Button>
                  </Link>
                </div>
              ) : (sessionId || shareIdParam) && analysisData ? (
                <div className="space-y-8 mb-12 animate-fade-in">
                  {/* Success header */}
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-success/20 to-success/5 border border-success/20">
                    <CheckCircle2 className="w-10 h-10 text-success" />
                  </div>
                  
                  <div>
                    <h1 className="text-3xl md:text-4xl font-bold mb-3">
                      {isSharedView ? "Shared Analysis" : "Your Analysis is Ready!"}
                    </h1>
                    <p className="text-muted-foreground text-lg">
                      {isSharedView 
                        ? "Viewing a shared resume analysis." 
                        : "Scroll down to see your detailed recruiter-grade feedback."}
                    </p>
                  </div>
                  
                  {/* Action cards */}
                  {shareId && !isSharedView && (
                    <div className="grid md:grid-cols-4 gap-4 max-w-3xl mx-auto pt-4">
                      {/* Email card */}
                      <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Mail className="w-4 h-4 text-primary" />
                          Save to Email
                        </div>
                        <Input
                          type="email"
                          placeholder="your@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={emailSent || isSendingEmail}
                          className="bg-background/50"
                        />
                        <Button
                          onClick={sendEmailAnalysis}
                          disabled={!email || isSendingEmail || emailSent}
                          className="w-full gap-2"
                          size="sm"
                        >
                          {isSendingEmail ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : emailSent ? (
                            <>
                              <Check className="w-4 h-4" />
                              Sent!
                            </>
                          ) : (
                            <>
                              <Mail className="w-4 h-4" />
                              Send Results
                            </>
                          )}
                        </Button>
                      </div>
                      
                      {/* Download PDF card */}
                      <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Printer className="w-4 h-4 text-primary" />
                          Download PDF
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Save your analysis as a PDF document
                        </p>
                        <Button
                          variant="outline"
                          onClick={handleSaveAsPdf}
                          disabled={isGeneratingPdf}
                          className="w-full gap-2"
                          size="sm"
                        >
                          {isGeneratingPdf ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          {isGeneratingPdf ? "Generating..." : "Save as PDF"}
                        </Button>
                      </div>
                      
                      {/* Share card */}
                      <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Share2 className="w-4 h-4 text-primary" />
                          Share Results
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Get a link to share your analysis
                        </p>
                        <Button
                          variant="outline"
                          onClick={copyShareLink}
                          className="w-full gap-2"
                          size="sm"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Share2 className="w-4 h-4" />
                              Copy Link
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Delete Data card - GDPR compliance */}
                      <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-destructive/20 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Trash2 className="w-4 h-4 text-destructive" />
                          Delete My Data
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Permanently delete this analysis
                        </p>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full gap-2 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                              size="sm"
                              disabled={isDeleting}
                            >
                              {isDeleting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                              {isDeleting ? "Deleting..." : "Delete Data"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete your analysis data?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. Your resume analysis will be permanently deleted from our servers. This helps ensure your privacy under GDPR and CCPA regulations.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleDeleteData}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Yes, delete my data
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  )}
                  
                  {shareId && isSharedView && (
                    <div className="flex flex-wrap justify-center gap-3">
                      <Button
                        variant="outline"
                        onClick={handleSaveAsPdf}
                        disabled={isGeneratingPdf}
                        className="gap-2"
                        size="lg"
                      >
                        {isGeneratingPdf ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        {isGeneratingPdf ? "Generating..." : "Save as PDF"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={copyShareLink}
                        className="gap-2"
                        size="lg"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Share2 className="w-4 h-4" />
                            Copy Share Link
                          </>
                        )}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            className="gap-2 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            size="lg"
                            disabled={isDeleting}
                          >
                            {isDeleting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            {isDeleting ? "Deleting..." : "Delete My Data"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete your analysis data?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. Your resume analysis will be permanently deleted from our servers. This helps ensure your privacy under GDPR and CCPA regulations.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDeleteData}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Yes, delete my data
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}

                  {/* Scroll indicator */}
                  <div className="pt-6 animate-bounce">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <span className="text-sm">Scroll to view results</span>
                      <ArrowRight className="w-4 h-4 rotate-90" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6 animate-fade-in">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-muted border border-border">
                    <FileText className="w-10 h-10 text-muted-foreground" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold">No session found</h1>
                  <p className="text-muted-foreground text-lg">
                    Please complete the checkout process first.
                  </p>
                  <Link to="/">
                    <Button variant="default" size="lg" className="gap-2">
                      <Sparkles className="w-4 h-4" />
                      Analyze Your Resume
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>

        {analysisData && (
          <div ref={analysisRef}>
            <AnalysisResults data={analysisData} />
          </div>
        )}
      </main>
      
      <Footer />
    </div>
  );
};

export default Success;
