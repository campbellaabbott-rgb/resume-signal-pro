// The apply agent's screening-answer step, shared by the account co-pilot and the
// live board. Drafts grounded answers to an application's questions — the REAL ones
// when the ATS exposes them (Greenhouse, Ashby, Recruitee), else the likely questions
// inferred from the JD (clearly labeled). Every answer is grounded strictly in the
// resume; unsupported ones are flagged for the candidate, never fabricated. The human
// reviews, edits, and pastes into the company's own form — we never auto-submit.
import { useEffect, useRef, useState } from "react";
import { Loader2, Copy, AlertTriangle, MessageSquare, ShieldCheck, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DraftedAnswer { question: string; answer: string; supported: boolean; note: string; anticipated?: boolean; }

/** Vendors whose REAL application form the board function can fetch.
 * Exported so the board page gates its "Prep answers" button on the SAME
 * list — it was hardcoded to greenhouse: there, hiding the feature on Ashby
 * and Recruitee postings the backend had supported since task #201. */
/**
 * Vendors whose REAL application form job-board can read.
 *
 * MIRROR of `realQuestionVendors()` in
 * supabase/functions/_shared/apply-automation.ts, kept in sync by
 * `src/test/real-question-mirror.test.ts` — the same arrangement as
 * SENDABLE_VENDORS and the worker's ADAPTERS, and for the same reason: the
 * table is written for Deno and this is the browser bundle.
 *
 * IT HAD DRIFTED, measured 2026-08-03. This list said greenhouse/ashby/
 * recruitee while the deployed table said ashby/breezy/greenhouse/pinpoint/
 * teamtailor — disagreeing in BOTH directions at once. Postings on the three
 * missing vendors silently fell through to inferred questions, which the kit
 * then labelled as inferred and was honest about, so nothing looked broken; the
 * candidate simply got a guess where the employer's actual form was available.
 */
export const REAL_QUESTION_PREFIXES = [
  "ashby:", "breezy:", "greenhouse:", "pinpoint:", "recruitee:", "teamtailor:",
];

/**
 * Mirror of `cleanQuestionLabel` in
 * supabase/functions/_shared/application-questions.ts — same reason as the list
 * above, and the same mirror test. Entities are decoded AFTER tags are stripped
 * so an escaped `&lt;p&gt;` in real question text cannot become a tag the strip
 * pass has already walked past.
 */
export function stripLabelMarkup(raw: unknown): string {
  return String(raw ?? "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function ApplicationAnswers({
  resumeText,
  jobTitle,
  jobCompany,
  jobDescription,
  jobId,
  jobCategory,
  experienceBand,
  autoStart = false,
}: {
  resumeText: string | null;
  jobTitle: string;
  jobCompany: string;
  jobDescription?: string | null;
  /** Board posting id (e.g. "greenhouse:stripe:123"). Greenhouse/Ashby/Recruitee
   *  ids unlock the posting's REAL questions; anything else falls back to
   *  JD-inference. */
  jobId?: string | null;
  /** Board category slug — steers role-aware drafting emphasis server-side. */
  jobCategory?: string | null;
  /** Board experience band — same purpose. */
  experienceBand?: string | null;
  /** Kick off drafting on mount (e.g. a board modal that opens straight into it). */
  autoStart?: boolean;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<DraftedAnswer[] | null>(null);
  const [inferred, setInferred] = useState(false);
  const [skipped, setSkipped] = useState<Array<{ question: string; class: string }>>([]);
  /** Documents the real form demands (from the ATS form config) — shown as a
   *  pre-flight so the candidate has them ready before they start. */
  const [requirements, setRequirements] = useState<string[]>([]);
  const started = useRef(false);

  const draft = async () => {
    if (loading || !resumeText) return;
    setLoading(true);
    try {
      // For Greenhouse/Ashby/Recruitee postings we can fetch the posting's REAL
      // application form (question labels, required flags, document demands)
      // and draft to those exact questions. Other vendors don't publish their
      // forms, so we pass no questions and the function infers likely ones
      // from the JD.
      let questions: Array<{ label: string; required?: boolean; type?: string }> | undefined;
      if (jobId && REAL_QUESTION_PREFIXES.some((p) => jobId.startsWith(p))) {
        try {
          const { data: q } = await supabase.functions.invoke("job-board", {
            body: { action: "application-questions", id: jobId },
          });
          const qd = q as { supported?: boolean; questions?: Array<{ label?: string; required?: boolean; type?: string }>; requirements?: string[] } | null;
          if (qd?.supported && Array.isArray(qd.questions) && qd.questions.length) {
            questions = qd.questions
              .filter((x): x is { label: string; required?: boolean; type?: string } => typeof x?.label === "string" && !!x.label.trim())
              // Live Recruitee labels arrive as HTML — `<p>` wrappers and `<a>`
              // tags around the very link the question asks you to read. Left
              // alone they render as tag soup in the kit.
              .map((x) => ({ label: stripLabelMarkup(x.label), required: x.required, type: x.type }))
              .filter((x) => x.label !== "");
          }
          if (qd?.supported && Array.isArray(qd.requirements) && qd.requirements.length) {
            setRequirements(qd.requirements.filter((r): r is string => typeof r === "string" && !!r.trim()).slice(0, 6));
          }
        } catch {
          // Real-questions fetch is best-effort; fall through to JD-inference.
        }
      }
      const { data, error } = await supabase.functions.invoke("generate-application-answers", {
        body: { resumeText, jobTitle, jobCompany, jobDescription, questions, jobCategory, experienceBand },
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

  const copyAll = () => {
    if (!answers) return;
    const text = answers
      .filter((a) => a.answer.trim())
      .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
      .join("\n\n");
    if (text) navigator.clipboard?.writeText(text).then(() => toast.success("All answers copied"));
  };

  if (!resumeText) return null;

  if (answers === null) {
    return (
      <div className="mt-3 space-y-2">
        {/* The form's document demands render the moment the ATS form loads —
            while the answers are still drafting. */}
        {requirements.length > 0 && (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
              <ClipboardList className="w-3 h-3 shrink-0 text-primary" />
              {t("jobsPage.prepHaveReady", "Have these ready — this form asks for them")}
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {requirements.map((r, i) => (
                <li key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground">{r}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={draft}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
          Draft this application's questions
        </button>
      </div>
    );
  }

  if (answers.length === 0 && skipped.length === 0) {
    return <p className="mt-3 text-[11px] text-muted-foreground">No auto-draftable questions — the rest are yours to complete honestly.</p>;
  }

  const gaps = answers.filter((a) => !a.supported).length;

  return (
    <div className="mt-3 space-y-2">
      {requirements.length > 0 && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-2.5">
          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
            <ClipboardList className="w-3 h-3 shrink-0 text-primary" />
            {t("jobsPage.prepHaveReady", "Have these ready — this form asks for them")}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {requirements.map((r, i) => (
              <li key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground">{r}</li>
            ))}
          </ul>
        </div>
      )}
      {answers.length > 0 && (
        <>
          {/* The honesty guarantee, made visible: this is the anti-spray-bot moat —
              every answer is résumé-grounded, and gaps are flagged, never invented. */}
          {gaps === 0 ? (
            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
              <ShieldCheck className="w-3 h-3 shrink-0" /> Every answer is grounded in your résumé — nothing invented.
            </p>
          ) : (
            <p className="inline-flex items-start gap-1 text-[11px] font-medium text-warning">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {gaps} of {answers.length} need your input — we flagged them instead of inventing anything.
            </p>
          )}
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {inferred
                ? "Likely questions for this role (this ATS doesn't publish its form) — grounded in your resume. Review before you paste."
                : "This application's real questions, drafted from your resume. Review before you paste."}
            </p>
            <button
              onClick={copyAll}
              className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Copy className="w-3 h-3" /> Copy all
            </button>
          </div>
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
