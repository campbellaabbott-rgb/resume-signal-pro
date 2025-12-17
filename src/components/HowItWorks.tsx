import { 
  Target, FileCheck, Hash, Pencil, FileText, Type, LayoutList, Phone,
  Trophy, AlertTriangle, Zap, Eye, BarChart3, TrendingUp, Sparkles,
  Clock, CheckCircle2, Brain, Shield
} from "lucide-react";
import { cn } from "@/lib/utils";

const analysisPoints = [
  { icon: Target, label: "ATS Score", color: "text-primary" },
  { icon: FileCheck, label: "Format Grade", color: "text-success" },
  { icon: FileText, label: "Resume Length", color: "text-warning" },
  { icon: Type, label: "Word Count", color: "text-primary" },
  { icon: BarChart3, label: "Experience Level", color: "text-success" },
  { icon: LayoutList, label: "Section Check", color: "text-warning" },
  { icon: Phone, label: "Contact Info", color: "text-primary" },
  { icon: Trophy, label: "Top Strength", color: "text-success" },
  { icon: Hash, label: "Quantification", color: "text-warning" },
  { icon: Pencil, label: "Action Verbs", color: "text-primary" },
  { icon: AlertTriangle, label: "Red Flags", color: "text-destructive" },
  { icon: Zap, label: "Keywords", color: "text-success" },
  { icon: Eye, label: "Readability", color: "text-warning" },
  { icon: TrendingUp, label: "Bullet Impact", color: "text-primary" },
  { icon: BarChart3, label: "Keyword Density", color: "text-success" },
  { icon: Sparkles, label: "Improvement Potential", color: "text-warning" },
  { icon: AlertTriangle, label: "Skip Reasons", color: "text-destructive" },
  { icon: CheckCircle2, label: "Power Words", color: "text-success" },
  { icon: AlertTriangle, label: "Weak Phrases", color: "text-warning" },
  { icon: Clock, label: "Timeline Analysis", color: "text-primary" },
  { icon: BarChart3, label: "Industry Benchmark", color: "text-success" },
  { icon: Zap, label: "Quick Wins", color: "text-warning" },
  { icon: Sparkles, label: "Sample Rewrite", color: "text-primary" },
  { icon: Target, label: "Career Trajectory", color: "text-success" },
];

export function HowItWorks() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Brain className="w-4 h-4" />
            AI-Powered Analysis
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-3">
            24-Point Deep Resume Scan
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Our AI analyzes every word, phrase, and section of your resume against real recruiter standards and ATS requirements.
          </p>
        </div>

        {/* Process Steps */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">1. Upload Resume</h3>
            <p className="text-sm text-muted-foreground">
              Paste text or upload PDF/DOCX. We extract every word.
            </p>
          </div>
          
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-success/20 text-success flex items-center justify-center mx-auto mb-4">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">2. AI Analysis</h3>
            <p className="text-sm text-muted-foreground">
              Google Gemini AI performs 24 distinct checks in ~10 seconds.
            </p>
          </div>
          
          <div className="rounded-2xl bg-card border border-border p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-warning/20 text-warning flex items-center justify-center mx-auto mb-4">
              <Target className="w-6 h-6" />
            </div>
            <h3 className="font-semibold mb-2">3. Get Results</h3>
            <p className="text-sm text-muted-foreground">
              Instant scores, red flags, and actionable improvements.
            </p>
          </div>
        </div>

        {/* 24-Point Grid */}
        <div className="rounded-2xl bg-gradient-to-br from-card to-muted/30 border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold">What We Analyze</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Shield className="w-3 h-3" />
              Your data is never stored
            </div>
          </div>
          
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {analysisPoints.map((point, index) => (
              <div 
                key={index}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-background/50 border border-border/50 hover:border-primary/30 transition-colors group"
              >
                <point.icon className={cn("w-4 h-4", point.color, "group-hover:scale-110 transition-transform")} />
                <span className="text-[10px] text-center text-muted-foreground leading-tight">
                  {point.label}
                </span>
              </div>
            ))}
          </div>
          
          <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-success" />
              Real AI analysis
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-primary" />
              Results in ~10 sec
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-warning" />
              100% private
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
