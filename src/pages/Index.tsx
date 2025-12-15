import { useState } from "react";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";

// Demo data for preview
const demoAnalysis: AnalysisData = {
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
};

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const { toast } = useToast();

  const handleFileSelect = (file: File) => {
    console.log("File selected:", file.name);
  };

  const handleTextSubmit = (text: string) => {
    console.log("Text submitted:", text.slice(0, 100) + "...");
  };

  const handleAnalyze = () => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setAnalysisData(demoAnalysis);
      toast({
        title: "Analysis complete",
        description: "Your resume has been analyzed. Scroll down to see results.",
      });
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-16">
        <Hero />
        
        <ResumeUploader
          onFileSelect={handleFileSelect}
          onTextSubmit={handleTextSubmit}
          isLoading={isLoading}
        />
        
        {analysisData && <AnalysisResults data={analysisData} />}
      </main>
      
      <Footer />
    </div>
  );
};

export default Index;
