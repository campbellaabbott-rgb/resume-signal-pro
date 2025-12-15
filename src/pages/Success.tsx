import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle, Share2, Copy, Check } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Success = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const sessionId = searchParams.get("session_id");
  const shareIdParam = searchParams.get("share");

  useEffect(() => {
    const loadAnalysis = async () => {
      // If share ID is provided, load from database
      if (shareIdParam) {
        try {
          const { data, error: dbError } = await supabase
            .from("resume_analyses")
            .select("analysis_result, share_id")
            .eq("share_id", shareIdParam)
            .maybeSingle();

          if (dbError) throw dbError;

          if (!data) {
            setError("Analysis not found. The link may be invalid or expired.");
            setIsLoading(false);
            return;
          }

          setAnalysisData(data.analysis_result as unknown as AnalysisData);
          setShareId(data.share_id);
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

      const resumeText = sessionStorage.getItem('resumeText');
      
      if (!resumeText) {
        setError("Resume data not found. Please try uploading again.");
        setIsLoading(false);
        return;
      }

      try {
        console.log("Starting AI analysis...");
        
        const { data, error: fnError } = await supabase.functions.invoke('analyze-resume', {
          body: { resumeText }
        });

        if (fnError) {
          console.error("Function error:", fnError);
          throw new Error(fnError.message || "Analysis failed");
        }

        if (data.error) {
          throw new Error(data.error);
        }

        const { shareId: newShareId, ...analysisResult } = data;
        setAnalysisData(analysisResult);
        setShareId(newShareId);
        sessionStorage.removeItem('resumeText');
        
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

  const isSharedView = !!shareIdParam;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-16">
        <section className="py-20">
          <div className="container">
            <div className="max-w-2xl mx-auto text-center">
              {isLoading ? (
                <div className="space-y-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  </div>
                  <h1 className="text-3xl font-bold">
                    {isSharedView ? "Loading analysis..." : "Analyzing your resume..."}
                  </h1>
                  <p className="text-muted-foreground">
                    {isSharedView 
                      ? "Fetching the saved analysis." 
                      : "Our AI is reviewing your resume with recruiter-grade precision."}
                  </p>
                </div>
              ) : error ? (
                <div className="space-y-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-destructive/10">
                    <AlertCircle className="w-10 h-10 text-destructive" />
                  </div>
                  <h1 className="text-3xl font-bold">
                    {isSharedView ? "Analysis Not Found" : "Analysis Error"}
                  </h1>
                  <p className="text-muted-foreground">{error}</p>
                  <Link to="/">
                    <Button variant="outline">Go Back Home</Button>
                  </Link>
                </div>
              ) : (sessionId || shareIdParam) && analysisData ? (
                <div className="space-y-6 mb-12">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10">
                    <CheckCircle2 className="w-10 h-10 text-success" />
                  </div>
                  <h1 className="text-3xl font-bold">
                    {isSharedView ? "Shared Analysis" : "Analysis Complete"}
                  </h1>
                  <p className="text-muted-foreground">
                    {isSharedView 
                      ? "Viewing a shared resume analysis." 
                      : "Here's your AI-powered recruiter-grade resume feedback."}
                  </p>
                  
                  {shareId && (
                    <Button
                      variant="outline"
                      onClick={copyShareLink}
                      className="gap-2"
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
                </div>
              ) : (
                <div className="space-y-6">
                  <h1 className="text-3xl font-bold">No session found</h1>
                  <p className="text-muted-foreground">
                    Please complete the checkout process first.
                  </p>
                  <Link to="/">
                    <Button variant="outline">Go Back Home</Button>
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
