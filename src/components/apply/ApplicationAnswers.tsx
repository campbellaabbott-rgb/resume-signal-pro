// The apply agent's screening-answer step, shared by the account co-pilot and the
// live board. Drafts grounded answers to an application's questions — the REAL ones
// when the ATS exposes them (Greenhouse ?questions=true), else the likely questions
// inferred from the JD (clearly labeled). Every answer is grounded strictly in the
// resume; unsupported ones are flagged for the candidate, never fabricated. The human
// reviews, edits, and pastes into the company's own form — we never auto-submit.
import { useEffect, useRef, useState } from "react";
import { Loader2, Copy, AlertTriangle, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DraftedAnswer { question: string; answer: string; supported: boolean; note: string; anticipated?: boolean; }

export function ApplicationAnswers({
  resumeText,
  jobTitle,
  jobCompany,
  jobDescription,
  jobId,
  autoStart = false,
}: {
  resumeText: string | null;
  jobTitle: string;
  jobCompany: string;
  jobDescription?: string | null;
  /** Board posting id (e.g. "greenhouse:stripe:123"). Greenhouse ids unlock the
   *  posting's REAL questions; anything else falls back to JD-inference. */
  jobId?: string | null;
  /** Kick off drafting on mount (e.g. a board modal that opens straight into it). */
  autoStart?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<DraftedAnswer[] | null>(null);
  const [inferred, setInferred] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ question: string; class: string }>>([]);
  const started = useRef(false);

  const draft = async () => {
    if (loading || !resumeText) return;
    setLoading(true);
    try {
      // For Greenhouse postings we can fetch the posting's REAL application
      // questions (labels, required, field types) and draft to those exact
      // questions. Every other ATS doesn't publish its form, so we pass no
      // questions and the function infers the likely ones from the JD.
      let questions: Array<{ label: string; required?: boolean; type?: string }> | undefined;
      if (jobId?.startsWith("greenhouse:")) {
        try {
          const { data: q } = await supabase.functions.invoke("job-board", {
            body: { action: "application-questions", id: jobId },
          });
          const qd = q as { supported?: boolean; questions?: Array<{ label?: string; required?: boolean; type?: string }> } | null;
          if (qd?.supported && Array.isArray(qd.questions) && qd.questions.length) {
            questions = qd.questions
              .filter((x): x is { label: string; required?: boolean; type?: string } => typeof x?.label === "string" && !!x.label.trim())
              .map((x) => ({ label: x.label, required: x.required, type: x.type }));
          }
        } catch {
          // Real-questions fetch is best-effort; fall through to JD-inference.
        }
      }
      const { data, error } = await supabase.functions.invoke("generate-application-answers", {
        body: { resumeText, jobTitle, jobCompany, jobDescription, questions },
      });
      if (error || !data) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        toast.error(status === 429 ? "Busy — try again shortly." : "Couldn't draft answers right now.");
        return;
      }
      const d = data as { answers?: DraftedAnswer[]; inferred?: boolean; skipped?: Array<{ question?: string; class?: string }> };
      setAnswers(Array.isArray(d.answers) ? d.answers : []);
      setInferred(!!d.inferred);
      setSkipped(
        Array.isArray(d.skipped)
          ? d.skipped
              .filter((s): s is { question: string; class?: string } => typeof s?.question === "string" && !!s.question.trim())
              .map((s) => ({ question: s.question, class: s.class ?? "" }))
          : [],
      );
    } catch {
      toast.error("Couldn't draft answers right now.");
    } finally {
      setLoading(false);
    }
  };

  // Optional auto-start once a resume is available. The ref guard makes it fire
  // exactly once even as resumeText resolves.
  useEffect(() => {
    if (autoStart && !started.current && resumeText && answers === null) {
      started.current = true;
      void draft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, resumeText]);

  if (!resumeText) return null;

  if (answers === null) {
    return (
      <button
        onClick={draft}
        disabled={loading}
        className="mt-3 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
        Draft this application's questions
      </button>
    );
  }

  if (answers.length === 0 && skipped.length === 0) {
    return <p className="mt-3 text-[11px] text-muted-foreground">No auto-draftable questions — the rest are yours to complete honestly.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {answers.length > 0 && (
        <>
          <p className="text-[11px] text-muted-foreground">
            {inferred
              ? "Likely questions for this role (this ATS doesn't publish its form) — grounded in your resume. Review before you paste."
              : "This application's real questions, drafted from your resume. Review before you paste."}
          </p>
          {answers.map((a, i) => (
            <div key={i} className="rounded-lg border border-border/60 bg-background p-2.5">
              <div className="flex items-start gap-1.5">
                <p className="flex-1 text-[12px] font-medium text-foreground">{a.question}</p>
                <button
                  onClick={() => navigator.clipboard?.writeText(a.answer).then(() => toast.success("Copied"))}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Copy answer"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground whitespace-pre-wrap">{a.answer}</p>
              {!a.supported && (
                <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-warning">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {a.note || "Add specifics from your own experience — we won't invent them."}
                </p>
              )}
            </div>
          ))}
        </>
      )}
      {skipped.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-muted/40 p-2.5">
          <p className="text-[11px] font-medium text-foreground">You'll answer these yourself</p>
          <p className="text-[11px] text-muted-foreground">We don't guess your identity, work authorization, salary, or demographics — the honest answer to each is yours alone.</p>
          <ul className="mt-1.5 space-y-0.5">
            {skipped.map((s, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">• {s.question}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
