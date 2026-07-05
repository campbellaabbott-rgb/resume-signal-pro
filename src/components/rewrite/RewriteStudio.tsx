import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, X, Pencil, Download, FileText, ShieldCheck, AlertTriangle, ArrowRight, Sparkles, RotateCcw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { parseEdgeFunctionError } from "@/lib/edge-function-errors";
import {
  ResumeRewriteData,
  BulletReviewState,
  normalizeRewriteData,
  assembleFinalResume,
  findUnresolvedBrackets,
} from "@/types/resume-rewrite";
import { extractResumeFields, resumeToPlainText, type AtsExtraction } from "@/lib/ats-extraction";

interface RewriteStudioProps {
  resumeText: string;
  jobDescription?: string;
  jobTitle?: string;
  jobCompany?: string;
}

type Phase = "generating" | "review" | "proof" | "error";

// Render text with [bracket] placeholders visually highlighted.
function BracketedText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]{1,60}\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[[^\]]+\]$/.test(part) ? (
          <mark key={i} className="bg-warning/20 text-warning-foreground border border-warning/40 rounded px-1 font-medium">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function ExtractionColumn({ label, extraction, accent }: { label: string; extraction: AtsExtraction; accent?: boolean }) {
  const Row = ({ name, value, ok }: { name: string; value: string; ok?: boolean }) => (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-border/60 text-sm">
      <span className="text-muted-foreground shrink-0">{name}</span>
      <span className={cn("text-right", ok === false && "text-destructive", ok === true && "text-success")}>{value}</span>
    </div>
  );
  return (
    <div className={cn("rounded-xl border p-4", accent ? "border-primary/40 bg-primary/5" : "border-border bg-card")}>
      <h4 className="font-semibold mb-3 flex items-center gap-2">
        {accent && <Sparkles className="w-4 h-4 text-primary" />}
        {label}
      </h4>
      <Row name="Name detected" value={extraction.nameGuess || "Not found"} ok={!!extraction.nameGuess} />
      <Row name="Email" value={extraction.emails[0] || "Not found"} ok={extraction.emails.length > 0} />
      <Row name="Phone" value={extraction.phones[0] || "Not found"} ok={extraction.phones.length > 0} />
      <Row name="Sections recognized" value={extraction.sectionsDetected.length ? extraction.sectionsDetected.join(", ") : "None"} ok={extraction.sectionsDetected.length >= 3} />
      <Row name="Employers/orgs extracted" value={String(extraction.organizations.length)} />
      <Row name="Date ranges parsed" value={String(extraction.datesFound.length)} />
      <Row name="Bullets parsed" value={String(extraction.bulletCount)} />
      <Row name="Bullets with metrics" value={`${extraction.quantifiedBullets} of ${extraction.bulletCount}`} />
      <Row name="Unclassifiable lines" value={String(extraction.unclassifiedLines)} ok={extraction.unclassifiedLines === 0 ? true : undefined} />
    </div>
  );
}

export function RewriteStudio({ resumeText, jobDescription, jobTitle, jobCompany }: RewriteStudioProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("generating");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ResumeRewriteData | null>(null);

  // Review state
  const [bulletStates, setBulletStates] = useState<Record<string, BulletReviewState>>({});
  const [summaryAccepted, setSummaryAccepted] = useState(true);
  const [summaryText, setSummaryText] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Proof state
  const [oldExtraction, setOldExtraction] = useState<AtsExtraction | null>(null);
  const [newExtraction, setNewExtraction] = useState<AtsExtraction | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "docx" | null>(null);

  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    try {
      const { data: res, error: fnError } = await supabase.functions.invoke("generate-resume-rewrite", {
        body: { resumeText, jobDescription, jobTitle, jobCompany },
      });
      if (fnError || !res?.success) {
        const parsed = await parseEdgeFunctionError(fnError || new Error(res?.error || "Generation failed"));
        setError(parsed.description || parsed.title);
        setPhase("error");
        return;
      }
      const normalized = normalizeRewriteData(res.data);
      setData(normalized);
      // Initialize review state: every change starts accepted.
      const states: Record<string, BulletReviewState> = {};
      normalized.experience.forEach((job, ji) =>
        job.bullets.forEach((b, bi) => {
          states[`${ji}-${bi}`] = { text: b.after, accepted: !b.reverted };
        })
      );
      setBulletStates(states);
      setSummaryText(normalized.summary.after);
      setSummaryAccepted(true);
      setPhase("review");
    } catch (err) {
      console.error("[RewriteStudio] Generation failed:", err);
      setError("Something went wrong while generating your rewrite. Please try again.");
      setPhase("error");
    }
  }, [resumeText, jobDescription, jobTitle, jobCompany]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generate();
  }, [generate]);

  const finalResume = useMemo(() => {
    if (!data) return null;
    return assembleFinalResume(data, summaryAccepted, summaryText, bulletStates);
  }, [data, summaryAccepted, summaryText, bulletStates]);

  const unresolvedBrackets = useMemo(
    () => (finalResume ? findUnresolvedBrackets(finalResume) : []),
    [finalResume]
  );

  const changedCount = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    data.experience.forEach((job, ji) =>
      job.bullets.forEach((b, bi) => {
        const s = bulletStates[`${ji}-${bi}`];
        if (s?.accepted && s.text !== b.before) n++;
      })
    );
    if (summaryAccepted && summaryText !== data.summary.before) n++;
    return n;
  }, [data, bulletStates, summaryAccepted, summaryText]);

  const runProof = useCallback(async () => {
    if (!data || !finalResume) return;
    setPhase("proof");
    setIsExtracting(true);
    try {
      const newText = resumeToPlainText(finalResume);
      const [oldEx, newEx] = await Promise.all([
        extractResumeFields(data.originalResumeText),
        extractResumeFields(newText),
      ]);
      setOldExtraction(oldEx);
      setNewExtraction(newEx);
    } catch (err) {
      console.error("[RewriteStudio] Extraction proof failed:", err);
      toast({ title: "Parse preview unavailable", description: "Couldn't run the independent parser — your documents are still ready to download.", variant: "destructive" });
    } finally {
      setIsExtracting(false);
    }
  }, [data, finalResume, toast]);

  const handleExport = useCallback(
    async (format: "pdf" | "docx") => {
      if (!finalResume) return;
      setIsExporting(format);
      try {
        const exports = await import("@/lib/resume-builder-export");
        if (format === "pdf") await exports.exportResumeBuilderPDF(finalResume);
        else await exports.exportResumeBuilderDocx(finalResume);
      } catch (err) {
        console.error(`[RewriteStudio] ${format} export failed:`, err);
        toast({ title: "Export failed", description: "Could not generate the document. Please try again.", variant: "destructive" });
      } finally {
        setIsExporting(null);
      }
    },
    [finalResume, toast]
  );

  // === PHASES ===

  if (phase === "generating") {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <h3 className="text-xl font-bold">Rewriting your resume…</h3>
        <p className="text-muted-foreground max-w-md mx-auto text-sm">
          Every rewritten line is verified against your original resume — nothing gets invented.
          Unknown numbers arrive as [placeholders] you'll fill in during review. This takes 30–60 seconds.
        </p>
      </div>
    );
  }

  if (phase === "error" || !data) {
    return (
      <div className="text-center py-16 space-y-4">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
        <h3 className="text-xl font-bold">Generation failed</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">{error || "Something went wrong."}</p>
        <Button onClick={generate} className="gap-2">
          <RotateCcw className="w-4 h-4" /> Try Again
        </Button>
      </div>
    );
  }

  const grounding = data.grounding;
  const groundingTotal = grounding.droppedBullets + grounding.revertedBullets + grounding.droppedJobs;

  // === REVIEW PHASE ===
  if (phase === "review") {
    return (
      <div className="space-y-8">
        {/* Review header */}
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
          <div className="flex items-start gap-3">
            <Eye className="w-6 h-6 text-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="text-lg font-bold mb-1">Review every change before download</h3>
              <p className="text-sm text-muted-foreground">
                {changedCount} rewrites are staged below. Accept, revert, or edit each one — and fill in the{" "}
                <mark className="bg-warning/20 border border-warning/40 rounded px-1">[highlighted placeholders]</mark>{" "}
                where only you know the real number. The download unlocks once every placeholder is resolved.
              </p>
              {data.strategy && <p className="text-sm mt-2 italic text-muted-foreground">Strategy: {data.strategy}</p>}
            </div>
          </div>
          {groundingTotal + grounding.notes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-primary/20 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium text-success">
                <ShieldCheck className="w-4 h-4" />
                Anti-fabrication check ran on this rewrite
              </div>
              <ul className="text-muted-foreground list-disc pl-6 space-y-0.5">
                {grounding.revertedBullets > 0 && <li>{grounding.revertedBullets} rewrite{grounding.revertedBullets > 1 ? "s" : ""} reverted to your original wording (contained a number we couldn't verify)</li>}
                {grounding.droppedBullets > 0 && <li>{grounding.droppedBullets} suggested bullet{grounding.droppedBullets > 1 ? "s" : ""} removed (not traceable to your resume)</li>}
                {grounding.droppedJobs > 0 && <li>{grounding.droppedJobs} job entr{grounding.droppedJobs > 1 ? "ies" : "y"} removed (not found in your resume)</li>}
                {grounding.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Summary change */}
        {data.summary.after && (
          <section className="space-y-3">
            <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Professional Summary</h4>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {data.summary.before ? (
                <p className={cn("text-sm text-muted-foreground", summaryAccepted && "line-through decoration-destructive/60")}>{data.summary.before}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">No summary in your original resume — this one is new (built only from facts in your resume).</p>
              )}
              {editingKey === "summary" ? (
                <Textarea value={summaryText} onChange={(e) => setSummaryText(e.target.value)} className="min-h-[90px] text-sm" onBlur={() => setEditingKey(null)} autoFocus />
              ) : (
                <p className={cn("text-sm", summaryAccepted ? "text-foreground bg-success/5 border border-success/20 rounded-lg p-2" : "text-muted-foreground opacity-50")}>
                  <BracketedText text={summaryText} />
                </p>
              )}
              {data.summary.reason && <p className="text-xs text-muted-foreground italic">{data.summary.reason}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant={summaryAccepted ? "default" : "outline"} className="gap-1 h-7 text-xs" onClick={() => setSummaryAccepted(true)}>
                  <Check className="w-3 h-3" /> Use rewrite
                </Button>
                <Button size="sm" variant={!summaryAccepted ? "default" : "outline"} className="gap-1 h-7 text-xs" onClick={() => setSummaryAccepted(false)}>
                  <X className="w-3 h-3" /> Keep original
                </Button>
                <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={() => setEditingKey("summary")}>
                  <Pencil className="w-3 h-3" /> Edit
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Experience changes */}
        {data.experience.map((job, ji) => (
          <section key={ji} className="space-y-3">
            <div>
              <h4 className="font-semibold">{job.title || "Role"} — {job.company}</h4>
              <p className="text-xs text-muted-foreground">{[job.location, [job.startDate, job.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="space-y-2">
              {job.bullets.map((bullet, bi) => {
                const key = `${ji}-${bi}`;
                const state = bulletStates[key];
                if (!state) return null;
                const unchanged = bullet.after === bullet.before && state.text === bullet.before;
                return (
                  <div key={key} className={cn("rounded-xl border p-3 space-y-2", state.accepted && !unchanged ? "border-success/30 bg-success/[0.03]" : "border-border bg-card")}>
                    <p className={cn("text-sm", state.accepted && !unchanged ? "text-muted-foreground line-through decoration-destructive/60" : "text-foreground")}>
                      {bullet.before}
                    </p>
                    {!unchanged && (
                      <>
                        {editingKey === key ? (
                          <Textarea
                            value={state.text}
                            onChange={(e) => setBulletStates((s) => ({ ...s, [key]: { ...s[key], text: e.target.value } }))}
                            className="min-h-[70px] text-sm"
                            onBlur={() => setEditingKey(null)}
                            autoFocus
                          />
                        ) : (
                          <p className={cn("text-sm rounded-lg p-2", state.accepted ? "bg-success/5 border border-success/20" : "opacity-50")}>
                            <BracketedText text={state.text} />
                          </p>
                        )}
                        {bullet.reason && <p className="text-xs text-muted-foreground italic">{bullet.reason}</p>}
                        {bullet.reverted && (
                          <Badge variant="outline" className="text-xs border-warning/40 text-warning-foreground">
                            <ShieldCheck className="w-3 h-3 mr-1" /> Auto-reverted: rewrite contained an unverifiable number
                          </Badge>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" variant={state.accepted ? "default" : "outline"} className="gap-1 h-7 text-xs" onClick={() => setBulletStates((s) => ({ ...s, [key]: { ...s[key], accepted: true } }))}>
                            <Check className="w-3 h-3" /> Accept
                          </Button>
                          <Button size="sm" variant={!state.accepted ? "default" : "outline"} className="gap-1 h-7 text-xs" onClick={() => setBulletStates((s) => ({ ...s, [key]: { ...s[key], accepted: false } }))}>
                            <X className="w-3 h-3" /> Keep original
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs" onClick={() => setEditingKey(key)}>
                            <Pencil className="w-3 h-3" /> Edit
                          </Button>
                        </div>
                      </>
                    )}
                    {unchanged && <p className="text-xs text-muted-foreground italic">Kept as-is.</p>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Skills preview */}
        {data.skills.length > 0 && (
          <section className="space-y-2">
            <h4 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Skills (verified against your resume{jobDescription ? " and the job description" : ""})</h4>
            <div className="flex flex-wrap gap-1.5">
              {data.skills.map((s, i) => <Badge key={i} variant="secondary" className="text-xs">{s}</Badge>)}
            </div>
          </section>
        )}

        {/* Continue gate */}
        <div className="sticky bottom-4 rounded-2xl border border-border bg-card/95 backdrop-blur p-4 shadow-lg">
          {unresolvedBrackets.length > 0 ? (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-warning-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                {unresolvedBrackets.length} placeholder{unresolvedBrackets.length > 1 ? "s" : ""} still need your real numbers — click <strong>Edit</strong> on the highlighted lines to fill them in (or <strong>Keep original</strong> to skip that change).
              </p>
              <Button disabled className="gap-2">Continue to Parse Proof <ArrowRight className="w-4 h-4" /></Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-muted-foreground">
                <Check className="w-4 h-4 text-success inline mr-1" />
                {changedCount} change{changedCount === 1 ? "" : "s"} approved · all placeholders resolved
              </p>
              <Button onClick={runProof} className="gap-2">
                Continue to Parse Proof <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // === PROOF + DOWNLOAD PHASE ===
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> Independent parse check
        </h3>
        <p className="text-sm text-muted-foreground">
          Both versions were run through the open-source{" "}
          <a href="https://github.com/spencermountain/compromise" target="_blank" rel="noopener noreferrer" className="text-primary underline">compromise</a>{" "}
          NLP parser using standard ATS field-extraction rules. This is what an independent parser — not our scoring — extracts from each version.
        </p>
      </div>

      {isExtracting ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Running the independent parser on both versions…</p>
        </div>
      ) : oldExtraction && newExtraction ? (
        <div className="grid md:grid-cols-2 gap-4">
          <ExtractionColumn label="Your original resume" extraction={oldExtraction} />
          <ExtractionColumn label="Your rewritten resume" extraction={newExtraction} accent />
        </div>
      ) : null}

      <div className="rounded-2xl border-2 border-primary/40 bg-primary/5 p-6 text-center space-y-4">
        <h3 className="text-xl font-bold">Download your finished resume</h3>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          ATS-safe single-column layout, standard section headers, real bullet characters — the same structure the parser above just verified.
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Button size="lg" className="gap-2" disabled={isExporting !== null} onClick={() => handleExport("docx")}>
            {isExporting === "docx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Download DOCX
          </Button>
          <Button size="lg" variant="outline" className="gap-2" disabled={isExporting !== null} onClick={() => handleExport("pdf")}>
            {isExporting === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download PDF
          </Button>
        </div>
        <button className="text-xs text-muted-foreground underline" onClick={() => setPhase("review")}>
          ← Back to review
        </button>
      </div>
    </div>
  );
}
