import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Demo analysis data - in production this would come from AI analysis
const generateAnalysis = (): AnalysisData => ({
  optimizedBullets: [
    {
      original: "Responsible for managing a team of developers",
      improved: "Led 8-person engineering team, reducing deployment time by 40% through CI/CD pipeline optimization",
      reason: "Quantified impact and specified team size for measurable achievement",
    },
    {
      original: "Helped increase sales",
      improved: "Drove $2.3M revenue increase (23% YoY) by implementing data-driven sales forecasting model",
      reason: "Added specific metrics and methodology",
    },
    {
      original: "Worked on improving customer experience",
      improved: "Reduced customer churn 18% by redesigning onboarding flow, validated through A/B testing with 10K+ users",
      reason: "Quantified result and showed validation methodology",
    },
  ],
  actionVerbs: [
    { weak: "Helped", strong: "Spearheaded" },
    { weak: "Worked on", strong: "Engineered" },
    { weak: "Was responsible for", strong: "Directed" },
    { weak: "Participated in", strong: "Contributed" },
    { weak: "Assisted with", strong: "Facilitated" },
    { weak: "Made", strong: "Developed" },
  ],
  keywords: [
    "cross-functional collaboration",
    "stakeholder management",
    "agile methodology",
    "data-driven decision making",
    "strategic planning",
    "process optimization",
    "KPI tracking",
    "budget management",
  ],
  redFlags: [
    "Employment gap between 2021-2022 not addressed. Consider adding context or relevant activities during this period.",
    "Skills section lists technologies without demonstrated application. Tie each skill to a specific project or achievement.",
    "Job descriptions focus on duties rather than outcomes. Recruiters want to see impact, not task lists.",
    "No metrics in first two positions. Even estimates are better than nothing.",
  ],
});

const Success = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const { toast } = useToast();

  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    if (sessionId) {
      // Simulate analysis generation after payment
      const timer = setTimeout(() => {
        setAnalysisData(generateAnalysis());
        setIsLoading(false);
        toast({
          title: "Payment successful!",
          description: "Your resume analysis is ready.",
        });
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      setIsLoading(false);
    }
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
              ) : sessionId ? (
                <div className="space-y-6 mb-12">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/10">
                    <CheckCircle2 className="w-10 h-10 text-success" />
                  </div>
                  <h1 className="text-3xl font-bold">Analysis Complete</h1>
                  <p className="text-muted-foreground">
                    Here's your recruiter-grade resume feedback.
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
