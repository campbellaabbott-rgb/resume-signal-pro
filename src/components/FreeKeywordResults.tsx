import { useState } from "react";
import { Sparkles, ArrowRight, CheckCircle2, Target, Zap, Lock, Mail, Loader2, FileCheck, FileText, AlertTriangle, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface KeywordSuggestion {
  keyword: string;
  reason: string;
}

interface ResumeLength {
  currentPages: number;
  recommendedPages: number;
  verdict: "too_short" | "just_right" | "too_long";
}

interface WordCount {
  current: number;
  idealMin: number;
  idealMax: number;
  verdict: "too_few" | "ideal" | "too_many";
}

interface RedFlag {
  issue: string;
  impact: string;
}

interface FreeKeywordResultsProps {
  industry: string;
  atsScoreEstimate: number;
  formatGrade: string;
  formatIssue: string;
  resumeLength: ResumeLength;
  wordCount?: WordCount;
  redFlags: RedFlag[];
  keywords: KeywordSuggestion[];
  onGetFullAnalysis: () => void;
  isLoading?: boolean;
}

export function FreeKeywordResults({
  industry,
  atsScoreEstimate,
  formatGrade,
  formatIssue,
  resumeLength: resumeLengthProp,
  wordCount: wordCountProp,
  redFlags: redFlagsProp,
  keywords,
  onGetFullAnalysis,
  isLoading
}: FreeKeywordResultsProps) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { toast } = useToast();

  // Safe defaults for new properties
  const resumeLength = resumeLengthProp || { currentPages: 1, recommendedPages: 1, verdict: "just_right" as const };
  const wordCount = wordCountProp || { current: 500, idealMin: 400, idealMax: 600, verdict: "ideal" as const };
  const redFlags = redFlagsProp || [];

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-destructive";
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return "bg-success/10 border-success/20";
    if (score >= 60) return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeColor = (grade: string) => {
    if (grade === "A") return "text-success";
    if (grade === "B") return "text-success/80";
    if (grade === "C") return "text-warning";
    return "text-destructive";
  };

  const getGradeBgColor = (grade: string) => {
    if (grade === "A") return "bg-success/10 border-success/20";
    if (grade === "B") return "bg-success/10 border-success/20";
    if (grade === "C") return "bg-warning/10 border-warning/20";
    return "bg-destructive/10 border-destructive/20";
  };

  const getGradeLabel = (grade: string) => {
    if (grade === "A") return "Excellent";
    if (grade === "B") return "Good";
    if (grade === "C") return "Fair";
    return "Needs Work";
  };

  const getLengthColor = (verdict: string) => {
    if (verdict === "just_right") return "text-success";
    return "text-warning";
  };

  const getLengthBgColor = (verdict: string) => {
    if (verdict === "just_right") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getLengthLabel = (verdict: string) => {
    if (verdict === "just_right") return "Perfect";
    if (verdict === "too_short") return "Too Short";
    return "Too Long";
  };

  const getWordCountColor = (verdict: string) => {
    if (verdict === "ideal") return "text-success";
    return "text-warning";
  };

  const getWordCountBgColor = (verdict: string) => {
    if (verdict === "ideal") return "bg-success/10 border-success/20";
    return "bg-warning/10 border-warning/20";
  };

  const getWordCountLabel = (verdict: string) => {
    if (verdict === "ideal") return "Ideal";
    if (verdict === "too_few") return "Too Few";
    return "Too Many";
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) return;

    // Basic email validation
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.rpc('save_free_scan_lead', {
        p_email: email,
        p_industry: industry,
        p_ats_score: atsScoreEstimate
      });

      if (error) throw error;

      setIsSubscribed(true);
      toast({
        title: "You're on the list!",
        description: "We'll send you resume tips to help you land more interviews.",
      });
    } catch (error: any) {
      console.error("Email capture error:", error);
      toast({
        title: "Something went wrong",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 text-success text-sm font-medium mb-3">
          <Sparkles className="w-4 h-4" />
          Free Scan Complete
        </div>
        <h3 className="text-xl font-bold mb-1">Here's your preview</h3>
        <p className="text-sm text-muted-foreground">
          Detected industry: <span className="text-foreground font-medium">{industry}</span>
        </p>
      </div>

      {/* Score Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        {/* ATS Score */}
        <div className={cn(
          "rounded-2xl border p-3",
          getScoreBgColor(atsScoreEstimate)
        )}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">ATS Score</p>
          </div>
          <p className={cn("text-2xl font-bold", getScoreColor(atsScoreEstimate))}>
            {atsScoreEstimate}<span className="text-sm text-muted-foreground">/100</span>
          </p>
          <div className="flex items-center gap-1 mt-1 text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span className="text-xs">Breakdown locked</span>
          </div>
        </div>

        {/* Format Grade */}
        <div className={cn(
          "rounded-2xl border p-3",
          getGradeBgColor(formatGrade)
        )}>
          <div className="flex items-center gap-2 mb-1">
            <FileCheck className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">Format Grade</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getGradeColor(formatGrade))}>
              {formatGrade}
            </p>
            <span className={cn("text-xs font-medium", getGradeColor(formatGrade))}>
              {getGradeLabel(formatGrade)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
            {formatIssue}
          </p>
        </div>

        {/* Resume Length */}
        <div className={cn(
          "rounded-2xl border p-3",
          getLengthBgColor(resumeLength.verdict)
        )}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">Page Count</p>
          </div>
          <div className="flex items-baseline gap-1">
            <p className={cn("text-2xl font-bold", getLengthColor(resumeLength.verdict))}>
              {resumeLength.currentPages}
            </p>
            <span className="text-sm text-muted-foreground">
              / {resumeLength.recommendedPages}
            </span>
          </div>
          <p className={cn("text-xs font-medium mt-1", getLengthColor(resumeLength.verdict))}>
            {getLengthLabel(resumeLength.verdict)}
          </p>
        </div>

        {/* Word Count */}
        <div className={cn(
          "rounded-2xl border p-3",
          getWordCountBgColor(wordCount.verdict)
        )}>
          <div className="flex items-center gap-2 mb-1">
            <Type className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground">Word Count</p>
          </div>
          <p className={cn("text-2xl font-bold", getWordCountColor(wordCount.verdict))}>
            {wordCount.current}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Ideal: {wordCount.idealMin}-{wordCount.idealMax}
          </p>
        </div>

        {/* Red Flags Preview */}
        <div className="rounded-2xl border p-3 bg-destructive/5 border-destructive/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <p className="text-xs text-muted-foreground">Red Flags</p>
          </div>
          <p className="text-2xl font-bold text-destructive mb-1">
            {redFlags.length}+
          </p>
          {redFlags.length > 0 && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              {redFlags[0].issue}
            </p>
          )}
        </div>
      </div>

      {/* Red Flags Details */}
      {redFlags.length > 0 && (
        <div className="rounded-2xl bg-destructive/5 border border-destructive/20 p-5 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h4 className="font-semibold">Recruiter Red Flags</h4>
          </div>
          <div className="space-y-2">
            {redFlags.map((flag, index) => (
              <div 
                key={index}
                className="flex items-start gap-3 p-3 rounded-xl bg-background/50 border border-destructive/10"
              >
                <span className="text-destructive font-bold text-sm">{index + 1}.</span>
                <div>
                  <span className="font-medium text-foreground">{flag.issue}</span>
                  <p className="text-sm text-muted-foreground">{flag.impact}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-3 text-muted-foreground">
            <Lock className="w-3 h-3" />
            <span className="text-xs">More red flags + fixes in full analysis</span>
          </div>
        </div>
      )}

      {/* Keyword Suggestions */}
      <div className="rounded-2xl bg-card border border-border p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">Missing Keywords to Add</h4>
        </div>
        
        <div className="space-y-3">
          {keywords.map((item, index) => (
            <div 
              key={index}
              className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/50"
            >
              <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{item.keyword}</span>
                <p className="text-sm text-muted-foreground">{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Email Capture */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Mail className="w-4 h-4 text-primary" />
          <h4 className="font-semibold">Get More Resume Tips</h4>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Join 10,000+ job seekers getting weekly tips to beat the ATS and land interviews.
        </p>
        
        {isSubscribed ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="text-sm text-success font-medium">You're subscribed! Check your inbox.</span>
          </div>
        ) : (
          <form onSubmit={handleEmailSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="flex-1 h-10 px-4 rounded-xl bg-background border border-border text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 text-sm transition-all"
              disabled={isSubmitting}
            />
            <Button 
              type="submit" 
              variant="outline"
              disabled={isSubmitting || !email.trim()}
              className="h-10 px-4 border-primary/30 hover:bg-primary/10"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Subscribe"
              )}
            </Button>
          </form>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          No spam. Unsubscribe anytime.
        </p>
      </div>

      {/* What's Locked */}
      <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h4 className="font-medium text-muted-foreground">Unlock with Full Analysis</h4>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            "Full ATS score breakdown",
            "Bullet point rewrites",
            "Red flags recruiters see",
            "LinkedIn optimization",
            "Action verb improvements",
            "Quantification tips",
            "Skills gap analysis",
            "Industry insights",
            "Resume length guide",
            "Prioritized action plan"
          ].map((feature, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Button 
          size="lg" 
          onClick={onGetFullAnalysis}
          disabled={isLoading}
          className="gap-2 px-8 h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
        >
          Get Full Analysis — $25
          <ArrowRight className="w-4 h-4" />
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          One interview pays for itself
        </p>
      </div>
    </div>
  );
}
