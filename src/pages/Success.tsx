import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Success = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    const analyzeResume = async () => {
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      // Get resume text from sessionStorage (stored before checkout)
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

        setAnalysisData(data);
        sessionStorage.removeItem('resumeText'); // Clean up
        
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

    analyzeResume();
  }, [sessionId, toast]);

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
                  <h1 className="text-3xl font-bold">Analyzing your resume...</h1>
                  <p className="text-muted-foreground">
                    Our AI is reviewing your resume with recruiter-grade precision.
                  </p>
                </div>
              ) : error ? (
                <div className="space-y-6">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-destructive/10">
                    <AlertCircle className="w-10 h-10 text-destructive" />
                  </div>
                  <h1 className="text-3xl font-bold">Analysis Error</h1>
                  <p className="text-muted-foreground">{error}</p>
                </div>
              ) : sessionId ? (
                <div className="space-y-6 mb-12">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10">
                    <CheckCircle2 className="w-10 h-10 text-success" />
                  </div>
                  <h1 className="text-3xl font-bold">Analysis Complete</h1>
                  <p className="text-muted-foreground">
                    Here's your AI-powered recruiter-grade resume feedback.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <h1 className="text-3xl font-bold">No session found</h1>
                  <p className="text-muted-foreground">
                    Please complete the checkout process first.
                  </p>
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
