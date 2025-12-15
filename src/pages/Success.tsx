import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
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
  Home
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { ResumeRecovery } from "@/components/ResumeRecovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const analysisSteps = [
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
  const { toast } = useToast();

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

  useEffect(() => {
    const runAnalysis = async (resumeText: string) => {
      try {
        console.log("Starting AI analysis...");
        setCurrentStep(3);

        const { data, error: fnError } = await supabase.functions.invoke("analyze-resume", {
          body: { resumeText },
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

        // Clean up stored resume text after successful analysis
        if (sessionId) {
          localStorage.removeItem(`resumeText:${sessionId}`);
        }
        localStorage.removeItem("resumeText");

        toast({
          title: "Payment successful!",
          description: "Your AI-powered resume analysis is ready.",
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

      // Prefer session-scoped key, fallback to legacy key
      const stored =
        localStorage.getItem(`resumeText:${sessionId}`) ||
        localStorage.getItem("resumeText");

      if (!stored || !stored.trim()) {
        setNeedsResume(true);
        setIsLoading(false);
        return;
      }

      setNeedsResume(false);
      await runAnalysis(stored);
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
          analysis: {
            overallScore: 75,
            summary: "Your resume shows strong potential with room for improvement in metrics and keywords.",
            atsOptimizedBullets: analysisData.optimizedBullets?.map(b => ({
              original: b.original,
              improved: b.improved,
              explanation: b.reason
            })) || [],
            actionVerbs: analysisData.actionVerbs?.map(v => ({
              weak: v.weak,
              strong: v.strong,
              context: ""
            })) || [],
            keywordSuggestions: analysisData.keywords?.map(k => ({
              keyword: k,
              reason: "Industry-relevant keyword",
              priority: "medium"
            })) || [],
            redFlags: analysisData.redFlags?.map(r => ({
              issue: r,
              impact: "May reduce interview chances",
              fix: "Address this issue in your resume"
            })) || [],
            topStrengths: [],
            criticalFixes: analysisData.redFlags?.slice(0, 2) || []
          }
        }
      });

      if (fnError) throw fnError;

      setEmailSent(true);
      toast({
        title: "Email sent!",
        description: "Your analysis has been sent to your inbox.",
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
                      if (sessionId) {
                        localStorage.setItem(`resumeText:${sessionId}`, text);
                      }
                      localStorage.setItem("resumeText", text);

                      setNeedsResume(false);
                      setIsLoading(true);
                      setCurrentStep(2);
                      setError(null);

                      void supabase.functions
                        .invoke("analyze-resume", { body: { resumeText: text } })
                        .then(({ data, error: fnError }) => {
                          if (fnError) throw fnError;
                          if (data?.error) throw new Error(data.error);

                          const { shareId: newShareId, ...analysisResult } = data;
                          setAnalysisData(analysisResult);
                          setShareId(newShareId);

                          if (sessionId) {
                            localStorage.removeItem(`resumeText:${sessionId}`);
                          }
                          localStorage.removeItem("resumeText");

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
                    <div className="grid md:grid-cols-2 gap-4 max-w-lg mx-auto pt-4">
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
                      
                      {/* Share card */}
                      <div className="p-5 rounded-2xl bg-card/50 backdrop-blur-sm border border-border/50 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Share2 className="w-4 h-4 text-primary" />
                          Share Results
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Get a link to share your analysis with others
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
                              <Download className="w-4 h-4" />
                              Copy Link
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {shareId && isSharedView && (
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

        {analysisData && <AnalysisResults data={analysisData} />}
      </main>
      
      <Footer />
    </div>
  );
};

export default Success;
