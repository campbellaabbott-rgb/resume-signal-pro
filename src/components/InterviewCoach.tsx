import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  MessageSquare, Loader2, ChevronRight, CheckCircle, AlertTriangle,
  Send, RotateCcw, Star
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface InterviewCoachProps {
  resumeText: string;
  industry?: string;
  currentRole?: string;
}

interface Question {
  id: number;
  category: string;
  question: string;
  whyAsked: string;
  strongAnswerTips: string[];
  redFlags: string[];
  sampleOpener: string;
  timeLimit: string;
  difficulty: string;
}

interface Evaluation {
  score: number;
  grade: string;
  strengths: string[];
  improvements: string[];
  revisedAnswer: string;
  recruiterReaction: string;
}

interface InterviewData {
  interviewProfile: {
    targetRole: string;
    difficulty: string;
    interviewType: string;
  };
  questions: Question[];
  interviewTips: {
    beforeInterview: string[];
    duringInterview: string[];
    closingQuestions: string[];
  };
}

const difficultyColors = {
  Easy: "bg-green-500/10 text-green-700",
  Medium: "bg-yellow-500/10 text-yellow-700",
  Hard: "bg-red-500/10 text-red-700",
};

const categoryColors: Record<string, string> = {
  Behavioral: "bg-blue-500/10 text-blue-700",
  Technical: "bg-purple-500/10 text-purple-700",
  Situational: "bg-orange-500/10 text-orange-700",
  "Culture Fit": "bg-green-500/10 text-green-700",
};

export function InterviewCoach({ resumeText, industry, currentRole }: InterviewCoachProps) {
  const [data, setData] = useState<InterviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [evaluations, setEvaluations] = useState<Record<number, Evaluation>>({});
  const [evaluatingId, setEvaluatingId] = useState<number | null>(null);
  const [showTips, setShowTips] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("generate-interview-coach", {
        body: { resumeText, industry, currentRole, targetRole: currentRole },
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || "Generation failed");
      setData(result.data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to generate", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const submitAnswer = async (q: Question) => {
    if (!answer.trim()) return;
    setEvaluatingId(q.id);
    try {
      const { data: result, error } = await supabase.functions.invoke("generate-interview-coach", {
        body: { resumeText, question: q.question, answer, category: q.category, mode: "evaluate" },
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || "Evaluation failed");
      setEvaluations(prev => ({ ...prev, [q.id]: result.data }));
      setAnswer("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to evaluate", variant: "destructive" });
    } finally {
      setEvaluatingId(null);
    }
  };

  if (!data) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs mb-2">
          <MessageSquare className="w-3.5 h-3.5" />
          Practice with an AI interview coach
        </div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Get personalized interview questions based on your resume, practice your answers, and get instant AI feedback.
        </p>
        <Button onClick={generate} disabled={isLoading} size="sm" className="gap-2">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
          {isLoading ? "Preparing your interview..." : "Start Mock Interview"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Interview Profile */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-foreground">{data.interviewProfile?.targetRole}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
          {data.interviewProfile?.difficulty}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
          {data.interviewProfile?.interviewType}
        </span>
        <button onClick={() => setShowTips(!showTips)} className="ml-auto text-[10px] text-primary hover:underline">
          {showTips ? "Hide tips" : "Interview tips"}
        </button>
      </div>

      {/* Tips panel */}
      {showTips && data.interviewTips && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-xl bg-muted/20 border border-border/50">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Before</p>
            {data.interviewTips.beforeInterview?.map((t, i) => (
              <p key={i} className="text-[11px] text-foreground">• {t}</p>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">During</p>
            {data.interviewTips.duringInterview?.map((t, i) => (
              <p key={i} className="text-[11px] text-foreground">• {t}</p>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Questions to Ask</p>
            {data.interviewTips.closingQuestions?.map((t, i) => (
              <p key={i} className="text-[11px] text-foreground">• {t}</p>
            ))}
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="space-y-2">
        {data.questions?.map((q) => {
          const isActive = activeQuestion === q.id;
          const evaluation = evaluations[q.id];
          return (
            <div key={q.id} className="rounded-xl border border-border/50 overflow-hidden">
              <button
                onClick={() => setActiveQuestion(isActive ? null : q.id)}
                className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/20 transition-colors"
              >
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0", categoryColors[q.category] || "bg-muted/50 text-muted-foreground")}>
                  {q.category}
                </span>
                <span className="text-xs font-medium text-foreground flex-1">{q.question}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {evaluation && (
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                      evaluation.score >= 7 ? "bg-green-500/10 text-green-700" :
                      evaluation.score >= 5 ? "bg-yellow-500/10 text-yellow-700" :
                      "bg-red-500/10 text-red-700"
                    )}>{evaluation.grade}</span>
                  )}
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", difficultyColors[q.difficulty as keyof typeof difficultyColors] || "bg-muted/50 text-muted-foreground")}>
                    {q.difficulty}
                  </span>
                  <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", isActive && "rotate-90")} />
                </div>
              </button>

              {isActive && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/30 pt-3">
                  <div className="text-[11px] text-muted-foreground">
                    <span className="font-semibold">Why they ask:</span> {q.whyAsked}
                  </div>

                  {/* Answer input */}
                  {!evaluation && (
                    <div className="space-y-2">
                      <textarea
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type your answer here... (or use the tips below to prepare)"
                        className="w-full text-xs p-2 rounded-lg border border-border/50 bg-background min-h-[80px] resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="gap-1 text-xs h-7" onClick={() => submitAnswer(q)} disabled={!answer.trim() || evaluatingId === q.id}>
                          {evaluatingId === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {evaluatingId === q.id ? "Evaluating..." : "Submit Answer"}
                        </Button>
                        <span className="text-[10px] text-muted-foreground">⏱ {q.timeLimit}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/20">
                        <p className="text-[10px] font-semibold text-muted-foreground mb-1">💡 Strong opener:</p>
                        <p className="text-[11px] text-foreground italic">"{q.sampleOpener}"</p>
                      </div>
                    </div>
                  )}

                  {/* Evaluation */}
                  {evaluation && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={cn("text-lg font-bold",
                          evaluation.score >= 7 ? "text-green-600" : evaluation.score >= 5 ? "text-yellow-600" : "text-red-600"
                        )}>{evaluation.score}/10</span>
                        <span className="text-xs text-muted-foreground">"{evaluation.recruiterReaction}"</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] font-semibold text-green-700 mb-0.5">Strengths</p>
                          {evaluation.strengths?.map((s, i) => (
                            <div key={i} className="flex items-start gap-1 text-[11px]">
                              <CheckCircle className="w-3 h-3 text-green-600 shrink-0 mt-0.5" />
                              <span>{s}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-orange-700 mb-0.5">Improve</p>
                          {evaluation.improvements?.map((s, i) => (
                            <div key={i} className="flex items-start gap-1 text-[11px]">
                              <AlertTriangle className="w-3 h-3 text-orange-600 shrink-0 mt-0.5" />
                              <span>{s}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                        <p className="text-[10px] font-semibold text-primary mb-0.5">✨ Stronger version:</p>
                        <p className="text-[11px] text-foreground">{evaluation.revisedAnswer}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="text-xs h-6 gap-1" onClick={() => {
                        setEvaluations(prev => { const n = {...prev}; delete n[q.id]; return n; });
                        setAnswer("");
                      }}>
                        <RotateCcw className="w-3 h-3" /> Try Again
                      </Button>
                    </div>
                  )}

                  {/* Tips and Red Flags */}
                  {!evaluation && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] font-semibold text-green-700 mb-0.5">Tips for a strong answer</p>
                        {q.strongAnswerTips?.map((t, i) => (
                          <p key={i} className="text-[11px] text-foreground">✓ {t}</p>
                        ))}
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-red-700 mb-0.5">Red flags to avoid</p>
                        {q.redFlags?.map((t, i) => (
                          <p key={i} className="text-[11px] text-foreground">✗ {t}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Score summary */}
      {Object.keys(evaluations).length > 0 && (
        <div className="rounded-xl bg-muted/20 border border-border/50 p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Questions answered: {Object.keys(evaluations).length}/{data.questions?.length}</p>
          <p className="text-lg font-bold text-foreground">
            Avg Score: {(Object.values(evaluations).reduce((sum, e) => sum + e.score, 0) / Object.keys(evaluations).length).toFixed(1)}/10
          </p>
        </div>
      )}
    </div>
  );
}
