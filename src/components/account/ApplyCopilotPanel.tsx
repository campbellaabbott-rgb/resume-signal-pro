// Apply co-pilot — batch application prep. The agent does the WORK (tailors a
// resume + cover letter to each saved posting, grounded against the user's
// real resume); the human stays in control of the SUBMIT (applies on the
// company's own site). No auto-submission — that would violate the ATS
// vendors' terms and hurt the candidate. Pro feature; per-item prep for
// everyone lives in ApplyKitPanel.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, ExternalLink, ChevronDown, CheckCircle2, Copy, AlertTriangle, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ApplyAssistantResults, type ApplyPackageData } from "@/components/ApplyAssistantResults";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";
import { normalizeBuilderResume } from "@/types/resume-builder";
import { toast } from "sonner";

export interface CopilotApp {
  id: string;
  company: string;
  role: string;
  job_posting?: string | null;
  apply_url?: string | null;
  status: string;
  scan_id?: string | null;
  fit_pct?: number | null;
  kit?: unknown;
  /** Board posting id (e.g. "greenhouse:stripe:123") — lets us fetch the REAL
   *  application questions for Greenhouse jobs instead of inferring them. */
  job_id?: string | null;
}

// Same qualitative buckets as the board: full JDs are keyword-dense, so a
// strong same-field resume covers ~20%+ of recognized terms. Show a word, not
// a raw percentage that reads as "bad" to a layperson.
function fitTier(pct: number | null | undefined): { label: string; cls: string } | null {
  if (typeof pct !== "number") return null;
  if (pct >= 20) return { label: "Strong match", cls: "bg-success/10 text-success" };
  if (pct >= 10) return { label: "Possible match", cls: "bg-warning/10 text-warning" };
  return { label: "Stretch", cls: "bg-muted text-muted-foreground" };
}

const appsTable = () => (supabase as unknown as { from: (t: string) => any }).from("user_applications");

function toKit(raw: unknown): (ApplyPackageData & { coverLetter?: string }) | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.tailoredResume) return null;
  const jm = (r.jobMetadata ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as ApplyPackageData),
    tailoredResume: normalizeBuilderResume(r.tailoredResume as Record<string, unknown>),
    // Defensive defaults: a truncated/legacy stored kit missing these would
    // otherwise crash ApplyAssistantResults (which reads jobMetadata.company
    // etc. directly). Belt-and-suspenders with the CardErrorBoundary below.
    jobMetadata: { company: String(jm.company ?? ""), roleTitle: String(jm.roleTitle ?? ""), applyMethodHint: String(jm.applyMethodHint ?? "") },
    skillGaps: Array.isArray(r.skillGaps) ? (r.skillGaps as string[]) : [],
    checklist: Array.isArray(r.checklist) ? (r.checklist as string[]) : [],
    coverLetter: typeof r.coverLetter === "string" ? r.coverLetter : undefined,
  };
}

interface DraftedAnswer { question: string; answer: string; supported: boolean; note: string; anticipated?: boolean; }

// The agent's screening-answer step: drafts grounded answers to the application's
// questions — the REAL ones when the ATS exposes them (Greenhouse), else the likely
// questions inferred from the JD (clearly labeled). Every answer is grounded in the
// resume; unsupported ones are flagged for the candidate, never fabricated. The
// human reviews, edits, and pastes into the company's own form.
function ApplicationAnswers({ app, resumeText }: { app: CopilotApp; resumeText: string | null }) {
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState<DraftedAnswer[] | null>(null);
  const [inferred, setInferred] = useState(false);

  const draft = async () => {
    if (loading || !resumeText) return;
    setLoading(true);
    try {
      // For Greenhouse postings we can fetch the posting's REAL application
      // questions (labels, required, field types) and draft to those exact
      // questions. Every other ATS doesn't publish its form, so we pass no
      // questions and the function infers the likely ones from the JD.
      let questions: Array<{ label: string; required?: boolean; type?: string }> | undefined;
      if (app.job_id?.startsWith("greenhouse:")) {
        try {
          const { data: q } = await supabase.functions.invoke("job-board", {
            body: { action: "application-questions", id: app.job_id },
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
        body: { resumeText, jobTitle: app.role, jobCompany: app.company, jobDescription: app.job_posting, questions },
      });
      if (error || !data) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        toast.error(status === 429 ? "Busy — try again shortly." : "Couldn't draft answers right now.");
        return;
      }
      const d = data as { answers?: DraftedAnswer[]; inferred?: boolean };
      setAnswers(Array.isArray(d.answers) ? d.answers : []);
      setInferred(!!d.inferred);
    } catch {
      toast.error("Couldn't draft answers right now.");
    } finally {
      setLoading(false);
    }
  };

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

  if (answers.length === 0) {
    return <p className="mt-3 text-[11px] text-muted-foreground">No auto-draftable questions — the rest are yours to complete honestly.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
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
    </div>
  );
}

export function ApplyCopilotPanel({
  apps,
  resumeFor,
  proActive,
  onKit,
  onStatus,
}: {
  apps: CopilotApp[];
  resumeFor: (app: CopilotApp) => string | null;
  proActive: boolean;
  onKit: (appId: string, kit: unknown) => void;
  onStatus: (appId: string, status: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; company: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Ready to prep = has a posting description + a resume to tailor, no kit yet.
  const preppable = useMemo(
    () => apps.filter((a) => (a.job_posting?.trim().length ?? 0) > 30 && (resumeFor(a)?.trim().length ?? 0) >= 50),
    [apps, resumeFor],
  );
  // Prep strongest fit first: if the daily generation limit cuts the batch
  // short, the best-matched jobs are the ones that got prepped, not whichever
  // happened to be saved first. Unknown fit sorts last (treated as -1).
  const pending = preppable
    .filter((a) => !a.kit)
    .sort((a, b) => (b.fit_pct ?? -1) - (a.fit_pct ?? -1));
  const prepped = preppable.filter((a) => a.kit);

  if (preppable.length === 0) return null;

  const prepAll = async () => {
    if (!proActive || busy) return;
    setBusy(true);
    let succeeded = 0; // only real kits — not skips, refusals, or failures
    let i = 0;
    for (const a of pending) {
      setProgress({ done: i, total: pending.length, company: a.company });
      i++;
      const resumeText = resumeFor(a);
      if (!resumeText) continue;
      try {
        const { data, error } = await supabase.functions.invoke("generate-apply-package", {
          body: { resumeText, jobPostingText: a.job_posting, jobTitle: a.role, jobCompany: a.company },
        });
        if (error) {
          // On a non-2xx the SDK nulls `data` and puts the Response on
          // error.context — that's the only place the real status lives.
          const status = (error as { context?: { status?: number } })?.context?.status;
          if (status === 402) { toast.error("Batch prep needs Pro. Upgrade to prep applications in bulk."); break; }
          if (status === 429) { toast.error("Daily generation limit reached — the ones prepped so far are saved. Try the rest tomorrow."); break; }
          continue; // 422 grounding refusal or transient — skip this one, keep going
        }
        if (!(data as { success?: boolean } | null)?.success) continue;
        // Persist the kit so it survives reloads and never re-charges.
        await appsTable().update({ kit: data, kit_generated_at: new Date().toISOString() }).eq("id", a.id);
        onKit(a.id, data);
        succeeded++;
      } catch {
        // network hiccup — leave it pending, next run picks it up
      }
      await new Promise((r) => setTimeout(r, 900)); // gentle pacing
    }
    setProgress(null);
    setBusy(false);
    if (succeeded > 0) {
      toast.success(`Prepped ${succeeded} application${succeeded === 1 ? "" : "s"} — review and apply below.`);
    } else {
      toast("Nothing new to prep — the saved postings couldn't be tailored (missing description or grounding check). Add a job posting and try again.");
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">Application co-pilot</h2>
        <span className="ml-auto text-xs text-muted-foreground">{prepped.length}/{preppable.length} prepped</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        We tailor a resume + cover letter to each saved posting — grounded against your real resume, no invented facts.
        You review and apply on the company's own site.
      </p>

      {pending.length > 0 && (
        proActive ? (
          <button
            onClick={prepAll}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy && progress
              ? `Prepping ${progress.done + 1} of ${progress.total} — ${progress.company}…`
              : `Prep ${pending.length} tailored application${pending.length === 1 ? "" : "s"}`}
          </button>
        ) : (
          <Link to="/pricing" className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/10 transition-colors">
            <Sparkles className="w-4 h-4" />
            Go Pro to batch-prep {pending.length} saved job{pending.length === 1 ? "" : "s"}
          </Link>
        )
      )}

      {prepped.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {prepped.map((a) => {
            const kit = toKit(a.kit);
            const isOpen = openId === a.id;
            const tier = fitTier(a.fit_pct);
            return (
              <div key={a.id} className="border border-border/60 rounded-lg bg-card">
                <div className="flex items-center gap-2 px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                  <button onClick={() => setOpenId(isOpen ? null : a.id)} className="flex-1 min-w-0 text-left">
                    <span className="text-sm font-medium text-foreground truncate block">
                      {a.company}{a.role ? <span className="text-muted-foreground font-normal"> · {a.role}</span> : null}
                    </span>
                  </button>
                  {tier && (
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tier.cls}`} title={`${a.fit_pct}% of the posting's recognized keywords are in your resume`}>
                      {tier.label}
                    </span>
                  )}
                  {a.apply_url && (
                    <a
                      href={a.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => a.status === "saved" && onStatus(a.id, "applied")}
                      className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-primary text-primary-foreground font-semibold"
                    >
                      Apply <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button onClick={() => setOpenId(isOpen ? null : a.id)} aria-label="Toggle kit" className="text-muted-foreground shrink-0">
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
                {isOpen && kit && (
                  <div className="px-3 pb-3 pt-1 border-t border-border/50">
                    <CardErrorBoundary section="apply-kit">
                      <ApplyAssistantResults data={kit} coverLetter={kit.coverLetter} />
                    </CardErrorBoundary>
                    <CardErrorBoundary section="application-answers">
                      <ApplicationAnswers app={a} resumeText={resumeFor(a)} />
                    </CardErrorBoundary>
                  </div>
                )}
                {isOpen && !kit && (
                  <p className="px-3 pb-3 text-[11px] text-muted-foreground">This kit couldn't be read — regenerate it from the tracker row below.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
