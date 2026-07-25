// Apply co-pilot — batch application prep. The agent does the WORK (tailors a
// resume + cover letter to each saved posting, grounded against the user's
// real resume); the human stays in control of the SUBMIT (applies on the
// company's own site). No auto-submission — that would violate the ATS
// vendors' terms and hurt the candidate. Pro feature; per-item prep for
// everyone lives in ApplyKitPanel.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Sparkles, Loader2, ExternalLink, ChevronDown, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ApplicationAnswers } from "@/components/apply/ApplicationAnswers";
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
function fitTier(pct: number | null | undefined): { key: string; label: string; cls: string } | null {
  if (typeof pct !== "number") return null;
  if (pct >= 20) return { key: "accountPage.acStrong", label: "Strong match", cls: "bg-success/10 text-success" };
  if (pct >= 10) return { key: "accountPage.acPossible", label: "Possible match", cls: "bg-warning/10 text-warning" };
  return { key: "accountPage.acStretch", label: "Stretch", cls: "bg-muted text-muted-foreground" };
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

// The agent's screening-answer step lives in the shared ApplicationAnswers
// component (also used by the live board). Here we feed it each saved app.

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
  const { t } = useTranslation();
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
          if (status === 402) { toast.error(t("accountPage.acNeedsPro", "Batch prep needs Pro. Upgrade to prep applications in bulk.")); break; }
          if (status === 429) { toast.error(t("accountPage.acDailyLimit", "Daily generation limit reached — the ones prepped so far are saved. Try the rest tomorrow.")); break; }
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
      toast.success(t("accountPage.acPreppedToast", "Prepped {{count}} applications — review and apply below.", { count: succeeded }));
    } else {
      toast(t("accountPage.acNothingNew", "Nothing new to prep — the saved postings couldn't be tailored (missing description or grounding check). Add a job posting and try again."));
    }
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountPage.acTitle", "Application co-pilot")}</h2>
        <span className="ml-auto text-xs text-muted-foreground">{t("accountPage.acPreppedCount", "{{done}}/{{total}} prepped", { done: prepped.length, total: preppable.length })}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {t("accountPage.acBlurb", "We tailor a resume + cover letter to each saved posting — grounded against your real resume, no invented facts. You review and apply on the company's own site.")}
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
              ? t("accountPage.acPrepProgress", "Prepping {{i}} of {{total}} — {{company}}…", { i: progress.done + 1, total: progress.total, company: progress.company })
              : t("accountPage.acPrepAll", "Prep {{count}} tailored applications", { count: pending.length })}
          </button>
        ) : (
          <Link to="/pricing" className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-primary/40 text-primary text-sm font-semibold hover:bg-primary/10 transition-colors">
            <Sparkles className="w-4 h-4" />
            {t("accountPage.acGoPro", "Go Pro to batch-prep {{count}} saved jobs", { count: pending.length })}
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
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tier.cls}`} title={t("accountPage.acFitTitle", "{{pct}}% of the posting's recognized keywords are in your resume", { pct: a.fit_pct })}>
                      {t(tier.key, tier.label)}
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
                      {t("accountPage.acApply", "Apply")} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <button onClick={() => setOpenId(isOpen ? null : a.id)} aria-label={t("accountPage.acToggleKit", "Toggle kit")} className="text-muted-foreground shrink-0">
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                </div>
                {isOpen && kit && (
                  <div className="px-3 pb-3 pt-1 border-t border-border/50">
                    <CardErrorBoundary section="apply-kit">
                      <ApplyAssistantResults data={kit} coverLetter={kit.coverLetter} />
                    </CardErrorBoundary>
                    <CardErrorBoundary section="application-answers">
                      <ApplicationAnswers
                        resumeText={resumeFor(a)}
                        jobTitle={a.role}
                        jobCompany={a.company}
                        jobDescription={a.job_posting}
                        jobId={a.job_id}
                      />
                    </CardErrorBoundary>
                  </div>
                )}
                {isOpen && !kit && (
                  <p className="px-3 pb-3 text-[11px] text-muted-foreground">{t("accountPage.acKitUnreadable", "This kit couldn't be read — regenerate it from the tracker row below.")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
