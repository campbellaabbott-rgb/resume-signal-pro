import { useState, useEffect } from "react";
import {
  Linkedin, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Loader2, Star, ArrowRight,
  Lightbulb, Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface LinkedInAnalysis {
  linkedinScore: number;
  linkedinGrade: string;
  headline: {
    current: string;
    score: number;
    issues: string[];
    suggestion: string;
  };
  about: {
    wordCount: number;
    score: number;
    issues: string[];
    suggestion: string;
  };
  consistencyIssues: Array<{
    type: string;
    description: string;
    severity: "high" | "medium" | "low";
  }>;
  missingFromLinkedIn: string[];
  linkedinTips: string[];
  profileCompleteness: {
    score: number;
    missing: string[];
  };
}

interface Props {
  resumeText: string;
  linkedinText: string;
  industry: string;
  resumeAtsScore: number;
}

function ScoreBadge({ score, grade }: { score: number; grade: string }) {
  const color =
    score >= 80 ? "text-green-600" :
    score >= 60 ? "text-yellow-600" :
    "text-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-4xl font-bold ${color}`}>{score}</span>
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">/ 100</span>
        <Badge variant="outline" className={`text-xs font-bold ${color} border-current`}>{grade}</Badge>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "high") return <XCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />;
  if (severity === "medium") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />;
  return <AlertTriangle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />;
}

export function LinkedInInsights({ resumeText, linkedinText, industry, resumeAtsScore }: Props) {
  const [analysis, setAnalysis] = useState<LinkedInAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showHeadlineSuggestion, setShowHeadlineSuggestion] = useState(false);
  const [showAboutSuggestion, setShowAboutSuggestion] = useState(false);
  const [copied, setCopied] = useState<"headline" | "about" | null>(null);

  useEffect(() => {
    if (!resumeText || !linkedinText) return;
    run();
  }, []);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("analyze-linkedin-profile", {
        body: { resumeText, linkedinText, industry, resumeAtsScore },
      });
      if (fnError) throw new Error(fnError.message);
      if (!data?.success) throw new Error(data?.error || "Analysis failed");
      setAnalysis(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string, which: "headline" | "about") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mt-6 border rounded-xl overflow-hidden bg-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 bg-[#0077B5]/10 hover:bg-[#0077B5]/15 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Linkedin className="h-5 w-5 text-[#0077B5]" />
          <span className="font-semibold text-foreground">LinkedIn Profile Analysis</span>
          {analysis && (
            <Badge variant="outline" className="ml-2 text-xs">
              Score: {analysis.linkedinScore}/100 · {analysis.linkedinGrade}
            </Badge>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="p-5 space-y-6">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-[#0077B5]" />
              <p className="text-sm">Comparing your resume and LinkedIn profile…</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 rounded-lg p-3">
              <XCircle className="h-4 w-4 shrink-0" />
              {error}
              <Button variant="ghost" size="sm" onClick={run} className="ml-auto">Retry</Button>
            </div>
          )}

          {analysis && (
            <>
              {/* Score row */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">LinkedIn Score</span>
                  <ScoreBadge score={analysis.linkedinScore} grade={analysis.linkedinGrade} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Headline</span>
                  <ScoreBadge score={analysis.headline.score} grade={analysis.headline.score >= 80 ? "A" : analysis.headline.score >= 60 ? "B" : analysis.headline.score >= 40 ? "C" : "D"} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Profile Complete</span>
                  <ScoreBadge score={analysis.profileCompleteness.score} grade={analysis.profileCompleteness.score >= 80 ? "A" : analysis.profileCompleteness.score >= 60 ? "B" : analysis.profileCompleteness.score >= 40 ? "C" : "D"} />
                </div>
              </div>

              {/* Consistency issues */}
              {analysis.consistencyIssues.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-orange-500" />
                    Resume vs LinkedIn — Inconsistencies
                  </h3>
                  <ul className="space-y-2">
                    {analysis.consistencyIssues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <SeverityIcon severity={issue.severity} />
                        <span className="text-foreground/80">{issue.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing from LinkedIn */}
              {analysis.missingFromLinkedIn.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <ArrowRight className="h-4 w-4 text-blue-500" />
                    Resume highlights missing from LinkedIn
                  </h3>
                  <ul className="space-y-1.5">
                    {analysis.missingFromLinkedIn.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                        <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Headline */}
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Headline</h3>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowHeadlineSuggestion(v => !v)}>
                    {showHeadlineSuggestion ? "Hide suggestion" : "See improved version"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground italic">"{analysis.headline.current}"</p>
                {analysis.headline.issues.length > 0 && (
                  <ul className="space-y-1">
                    {analysis.headline.issues.map((issue, i) => (
                      <li key={i} className="text-xs text-orange-600 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
                {showHeadlineSuggestion && (
                  <div className="mt-2 bg-muted/60 rounded-md p-3 text-sm space-y-2">
                    <p className="font-medium text-foreground">Suggested headline:</p>
                    <p className="text-foreground/80 italic">"{analysis.headline.suggestion}"</p>
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => copy(analysis.headline.suggestion, "headline")}>
                      {copied === "headline" ? "Copied!" : "Copy to clipboard"}
                    </Button>
                  </div>
                )}
              </div>

              {/* About section */}
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">About section <span className="text-muted-foreground font-normal">({analysis.about.wordCount} words)</span></h3>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowAboutSuggestion(v => !v)}>
                    {showAboutSuggestion ? "Hide suggestion" : "See improved opening"}
                  </Button>
                </div>
                {analysis.about.issues.length > 0 && (
                  <ul className="space-y-1">
                    {analysis.about.issues.map((issue, i) => (
                      <li key={i} className="text-xs text-orange-600 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
                {showAboutSuggestion && (
                  <div className="mt-2 bg-muted/60 rounded-md p-3 text-sm space-y-2">
                    <p className="font-medium text-foreground">Suggested opening:</p>
                    <p className="text-foreground/80 italic">"{analysis.about.suggestion}"</p>
                    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => copy(analysis.about.suggestion, "about")}>
                      {copied === "about" ? "Copied!" : "Copy to clipboard"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Profile completeness */}
              {analysis.profileCompleteness.missing.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Star className="h-4 w-4 text-yellow-500" />
                    Profile completeness — missing items
                  </h3>
                  <ul className="space-y-1">
                    {analysis.profileCompleteness.missing.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                        <XCircle className="h-3 w-3 text-red-400" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tips */}
              {analysis.linkedinTips.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    LinkedIn optimisation tips
                  </h3>
                  <ul className="space-y-2">
                    {analysis.linkedinTips.map((tip, i) => (
                      <li key={i} className="text-sm text-foreground/80 flex items-start gap-2">
                        <span className="text-[#0077B5] font-bold shrink-0">{i + 1}.</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
