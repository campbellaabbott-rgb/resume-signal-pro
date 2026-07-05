// Freelance Boost — guided flow that turns freelance/gig/side-hustle projects
// into a recruiter-grade experience section. Flow: intake (free, saved
// locally) → checkout → return with session_id → generate → results.
// Intake questions and formulas come from the launch-kit playbook; the
// structure decision happens server-side, deterministically.

import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Briefcase, Plus, Trash2, Loader2, Check, Copy, ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useProductCheckout } from "@/hooks/use-product-checkout";
import { useToast } from "@/hooks/use-toast";

interface ProjectIntake {
  clientType: string; problem: string; deliverable: string; toolsSkills: string;
  outcome: string; duration: string; paymentBand: string; repeatOrReferral: string;
}
const emptyProject = (): ProjectIntake => ({ clientType: "", problem: "", deliverable: "", toolsSkills: "", outcome: "", duration: "", paymentBand: "", repeatOrReferral: "" });

interface BoostResult {
  structure: string; structureNote: string; header: string; scopeStatement: string;
  projects: Array<{ clientLabel: string; relevance: number; bullets: string[]; keywordsCovered: string[] }>;
  transitionParagraph: string; gapHandling: string;
  keywordCoverage: { covered: string[]; total: number } | null;
}

const DRAFT_KEY = "freelanceBoostIntake";

export default function FreelanceBoost() {
  const [params] = useSearchParams();
  const { purchaseProduct, isLoading: checkoutLoading } = useProductCheckout();
  const { toast } = useToast();

  const [projects, setProjects] = useState<ProjectIntake[]>([emptyProject()]);
  const [targetRole, setTargetRole] = useState("");
  const [jobPosting, setJobPosting] = useState("");
  const [employmentTimeline, setEmploymentTimeline] = useState("");
  const [situation, setSituation] = useState<"primary" | "alongside" | "returning">("alongside");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<BoostResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Restore draft
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.projects) && d.projects.length) setProjects(d.projects);
        if (d.targetRole) setTargetRole(d.targetRole);
        if (d.jobPosting) setJobPosting(d.jobPosting);
        if (d.employmentTimeline) setEmploymentTimeline(d.employmentTimeline);
        if (d.situation) setSituation(d.situation);
      }
    } catch { /* fresh start */ }
  }, []);
  // Persist draft
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ projects, targetRole, jobPosting, employmentTimeline, situation }));
  }, [projects, targetRole, jobPosting, employmentTimeline, situation]);

  // Returned from checkout with a paid session → generate
  const sessionId = params.get("session_id");
  useEffect(() => {
    if (!sessionId || result || generating) return;
    const run = async () => {
      setGenerating(true);
      setGenError(null);
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        const d = raw ? JSON.parse(raw) : null;
        if (!d?.projects?.length || !d?.targetRole) {
          setGenError("Your intake answers weren't found on this device. Fill in the form below — your purchase is saved to this session link.");
          return;
        }
        const { data, error } = await supabase.functions.invoke("generate-freelance-boost", {
          body: {
            sessionId,
            projects: d.projects.filter((p: ProjectIntake) => p.deliverable.trim()),
            targetRole: d.targetRole,
            jobPosting: d.jobPosting || undefined,
            employmentTimeline: d.employmentTimeline || undefined,
            freelanceWasPrimary: d.situation === "primary",
            overlapsEmployment: d.situation === "alongside",
            returningToFullTime: d.situation === "returning",
            totalClientsOverall: d.projects.length,
          },
        });
        if (error || !data?.success) throw new Error(data?.error || error?.message || "Generation failed");
        setResult(data.data as BoostResult);
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "Generation failed — your purchase is safe; reload this page to retry.");
      } finally {
        setGenerating(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const intakeComplete = targetRole.trim().length > 1 && projects.some(p => p.deliverable.trim() && p.clientType.trim());

  const startCheckout = async () => {
    if (!intakeComplete) {
      toast({ title: "Almost there", description: "Add your target role and at least one project (who it was for + what you delivered).", variant: "destructive" });
      return;
    }
    await purchaseProduct("freelanceBoost" as never, { ctaSection: "freelance_boost_page" });
  };

  const copySection = () => {
    if (!result) return;
    const text = [
      `${result.header}`,
      result.scopeStatement,
      ...result.projects.flatMap(p => p.bullets.map(b => `• ${b}`)),
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Experience section copied — paste it into your resume." });
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, textarea = false) => (
    <label className="block">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {textarea
        ? <Textarea value={value} onChange={e => set(e.target.value)} placeholder={placeholder} className="mt-1 min-h-[60px] text-sm" />
        : <Input value={value} onChange={e => set(e.target.value)} placeholder={placeholder} className="mt-1 text-sm" />}
    </label>
  );

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Freelance Boost — Turn Projects Into Resume Experience" description="Turn freelance projects, gig work, and side hustles into recruiter-grade resume experience. Built for career changers who've already done the work." path="/freelance-boost" />
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-3xl">
          <div className="text-center mb-10">
            <h1 className="text-3xl md:text-4xl font-bold mb-3">Your freelance work counts.<br />Make recruiters see it.</h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Freelance Boost turns your projects, contracts, and side hustles into recruiter-grade resume experience —
              built for career changers who've already done the work, just not the job title.
            </p>
          </div>

          {/* Results */}
          {generating && (
            <div className="rounded-2xl border border-border bg-card p-10 text-center mb-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-foreground font-medium">Translating your projects into {targetRole || "your target field"}'s language…</p>
              <p className="text-xs text-muted-foreground mt-1">Structure, bullets, keywords — about 15 seconds.</p>
            </div>
          )}
          {genError && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 mb-8">
              <p className="text-sm text-foreground">{genError}</p>
            </div>
          )}
          {result && (
            <div className="rounded-2xl border-2 border-primary/40 bg-card p-6 mb-10">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Your experience section</p>
                <Button size="sm" variant="outline" onClick={copySection} className="gap-1.5"><Copy className="w-3.5 h-3.5" />Copy</Button>
              </div>
              <p className="text-xs text-muted-foreground mb-4">{result.structureNote}</p>
              <div className="bg-white text-neutral-900 rounded-lg p-6 font-serif text-sm leading-relaxed">
                <p className="font-bold">{result.header}</p>
                {result.scopeStatement && <p className="italic text-neutral-600 text-[13px] mt-0.5">{result.scopeStatement}</p>}
                <ul className="list-disc ml-4 mt-2 space-y-1">
                  {result.projects.flatMap((p, i) => p.bullets.map((b, j) => <li key={`${i}-${j}`}>{b}</li>))}
                </ul>
              </div>
              {result.keywordCoverage && result.keywordCoverage.total > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  <span className="font-semibold text-foreground">Posting keywords covered ({result.keywordCoverage.total}):</span>{" "}
                  {result.keywordCoverage.covered.join(", ")} — each verified to appear in the posting you provided.
                </p>
              )}
              {result.gapHandling && <p className="text-xs text-muted-foreground mt-2"><span className="font-semibold text-foreground">Dates & overlap:</span> {result.gapHandling}</p>}
              {result.transitionParagraph && (
                <div className="mt-4 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground mb-1">Cover-letter transition paragraph</p>
                  <p className="text-xs text-muted-foreground">{result.transitionParagraph}</p>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild><Link to="/?utm_source=freelance_boost">Scan the result free <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link></Button>
              </div>
            </div>
          )}

          {/* Intake */}
          {!result && !generating && (
            <>
              <div className="rounded-2xl border border-border bg-card p-5 mb-6">
                <h2 className="font-semibold text-foreground mb-3">1. Your target</h2>
                <div className="space-y-3">
                  {field("Target role or field", targetRole, setTargetRole, "e.g. UX Designer, Staff Accountant, Marketing Manager")}
                  {field("Job posting (optional — makes keywords exact)", jobPosting, setJobPosting, "Paste the posting you're aiming at", true)}
                  {field("Employment timeline (for honest date/overlap handling)", employmentTimeline, setEmploymentTimeline, "e.g. Marketing Coordinator at BrandCo 2021–present; freelancing nights/weekends since 2023", true)}
                  <div>
                    <span className="text-xs font-medium text-foreground">Which fits best?</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {([["alongside", "Freelancing alongside a job"], ["primary", "Freelance is my main work"], ["returning", "Freelancer returning to full-time"]] as const).map(([id, label]) => (
                        <button key={id} onClick={() => setSituation(id)} className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${situation === id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 mb-6">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="font-semibold text-foreground">2. Your projects <span className="text-xs text-muted-foreground font-normal">(up to 5 — no resume needed)</span></h2>
                  {projects.length < 5 && (
                    <Button size="sm" variant="outline" onClick={() => setProjects([...projects, emptyProject()])} className="gap-1"><Plus className="w-3.5 h-3.5" />Add project</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-4">Every question is answerable even if you think your work "doesn't count." It counts.</p>
                <div className="space-y-6">
                  {projects.map((p, i) => {
                    const set = (k: keyof ProjectIntake) => (v: string) => setProjects(projects.map((pp, j) => j === i ? { ...pp, [k]: v } : pp));
                    return (
                      <div key={i} className="rounded-xl border border-border/60 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5 text-primary" />Project {i + 1}</p>
                          {projects.length > 1 && (
                            <button onClick={() => setProjects(projects.filter((_, j) => j !== i))} aria-label="Remove project" className="text-muted-foreground/50 hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                        <div className="grid sm:grid-cols-2 gap-3">
                          {field("Who was it for? (industry + size is enough)", p.clientType, set("clientType"), 'e.g. "a 10-person dental practice"')}
                          {field("What problem did they have before you?", p.problem, set("problem"), "No website; bookings were phone-only")}
                          {field("What exactly did you deliver?", p.deliverable, set("deliverable"), "Site, campaign, analysis, app, content, bookkeeping…")}
                          {field("Tools, skills, or methods used", p.toolsSkills, set("toolsSkills"), "Figma, Webflow, client interviews")}
                          {field("What changed because of your work?", p.outcome, set("outcome"), "Numbers if known; else faster/cheaper/more customers")}
                          {field("How long did it take, and when?", p.duration, set("duration"), "3 weeks, spring 2025")}
                          {field("Roughly paid? (framing only, never displayed)", p.paymentBand, set("paymentBand"), "$500–1k / $1–5k / unpaid")}
                          {field("Did they come back, refer you, or say anything quotable?", p.repeatOrReferral, set("repeatOrReferral"), "Retained for 2 more projects")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
                <p className="font-semibold text-foreground mb-1">3. Get your experience section — $29, one-time</p>
                <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
                  Recruiter-grade bullets in your target field's vocabulary, the right structure for your situation,
                  honest date handling, and keyword coverage against your posting. No subscription.
                </p>
                <Button onClick={startCheckout} disabled={checkoutLoading} size="lg" className="gap-2">
                  {checkoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Boost my experience — $29
                </Button>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Your answers stay on this device until you purchase. We never invent clients, payments, or metrics —
                  honest framing is the whole product.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
