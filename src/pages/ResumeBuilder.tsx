import { useEffect, useRef, useState } from "react";
import { SEO } from "@/components/seo/SEO";
import { Loader2, Download, FileText, RotateCcw, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { hasUnsupportedPdfCharacters } from "@/lib/pdf-text-support";
import { supabase } from "@/integrations/supabase/client";
import { getResumeFromSession } from "@/hooks/use-session-resume";
import {
  BuilderResume,
  createEmptyResume,
  createEmptyExperienceEntry,
  normalizeBuilderResume,
} from "@/types/resume-builder";
import { ExperienceEditor } from "@/components/builder/ExperienceEditor";
import { EducationEditor } from "@/components/builder/EducationEditor";
import { TagListEditor } from "@/components/builder/TagListEditor";
import { ResumePreview } from "@/components/builder/ResumePreview";

const DRAFT_STORAGE_KEY = "resumeBuilderDraft";

function loadDraft(): BuilderResume | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BuilderResume;
  } catch {
    return null;
  }
}

function saveDraft(resume: BuilderResume) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(resume));
  } catch {
    // Storage full or disabled — not worth surfacing to the user, the draft just
    // won't persist across refreshes.
  }
}

// Scan→builder handoff payload written by the report's "Open in builder with
// fixes applied" button. Rewrites are applied to matching bullets after AI
// extraction; keywords render as a suggestion strip (never auto-inserted —
// only the user can honestly claim a skill).
interface ScanFixes {
  rewrites: Array<{ before: string; after: string }>;
  keywords: string[];
  reportId: string | null;
}

const normalizeBullet = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Plain-text serialization for the rescan ritual: the exported document goes
// back through the real scanner so the improvement is measured, not assumed.
function builderResumeToText(r: BuilderResume): string {
  const lines: string[] = [];
  const c = r.contact;
  if (c.fullName) lines.push(c.fullName);
  if (c.title) lines.push(c.title);
  lines.push([c.email, c.phone, c.location, c.linkedIn, c.website].filter(Boolean).join(" | "));
  if (r.summary) lines.push("", "SUMMARY", r.summary);
  if (r.experience.length) {
    lines.push("", "EXPERIENCE");
    for (const e of r.experience) {
      lines.push(`${e.title}${e.company ? `, ${e.company}` : ""}${e.location ? ` — ${e.location}` : ""} (${[e.startDate, e.endDate].filter(Boolean).join(" - ")})`);
      for (const b of e.bullets.filter(Boolean)) lines.push(`- ${b}`);
    }
  }
  if (r.education.length) {
    lines.push("", "EDUCATION");
    for (const e of r.education) {
      lines.push([[e.degree, e.field].filter(Boolean).join(" in "), e.school, [e.startDate, e.endDate].filter(Boolean).join(" - ")].filter(Boolean).join(", "));
      if (e.details) lines.push(e.details);
    }
  }
  if (r.skills.length) lines.push("", "SKILLS", r.skills.join(", "));
  if (r.certifications.length) lines.push("", "CERTIFICATIONS", r.certifications.join(", "));
  return lines.join("\n");
}

function applyScanRewrites(resume: BuilderResume, rewrites: ScanFixes["rewrites"]): { resume: BuilderResume; applied: number } {
  let applied = 0;
  const normalized = rewrites.map((r) => ({ key: normalizeBullet(r.before), after: r.after }));
  const experience = resume.experience.map((entry) => ({
    ...entry,
    bullets: entry.bullets.map((b) => {
      const nb = normalizeBullet(b);
      if (!nb) return b;
      const hit = normalized.find((r) => r.key && (r.key === nb || nb.includes(r.key) || r.key.includes(nb)));
      if (hit) {
        applied += 1;
        return hit.after;
      }
      return b;
    }),
  }));
  return { resume: { ...resume, experience }, applied };
}

export default function ResumeBuilder() {
  const [resume, setResume] = useState<BuilderResume>(() => loadDraft() || createEmptyResume());
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [scanKeywords, setScanKeywords] = useState<string[]>([]);
  const [showRescanCta, setShowRescanCta] = useState(false);
  const hasAttemptedPrefillRef = useRef(false);
  const { toast } = useToast();

  // On first load, if there's no existing draft but the user has a resume from a
  // recent scan/analysis, offer to prefill the builder from it via AI extraction.
  // When the report's "fixes applied" handoff is present, it takes priority —
  // including over an existing draft (with confirmation, since that's destructive).
  useEffect(() => {
    if (hasAttemptedPrefillRef.current) return;
    hasAttemptedPrefillRef.current = true;

    // Freelance Boost handoff: append the purchased experience section to
    // whatever draft exists (never overwrites — these are ADDITIONAL entries).
    // Takes priority over prefill because the user explicitly clicked insert.
    try {
      const boostRaw = sessionStorage.getItem("rb_boost_insert");
      if (boostRaw) {
        sessionStorage.removeItem("rb_boost_insert");
        const boost = JSON.parse(boostRaw) as {
          header: string; structure: string; scopeStatement?: string;
          projects: Array<{ clientLabel: string; bullets: string[] }>;
        };
        const entries = boost.structure.startsWith("consolidated")
          ? [{
              ...createEmptyExperienceEntry(),
              title: boost.header,
              company: "Independent / Freelance",
              bullets: [
                ...(boost.scopeStatement ? [boost.scopeStatement] : []),
                ...boost.projects.flatMap(p => p.bullets),
              ],
            }]
          : boost.projects.map(p => ({
              ...createEmptyExperienceEntry(),
              title: boost.header,
              company: p.clientLabel,
              bullets: p.bullets,
            }));
        const base = loadDraft() || createEmptyResume();
        // Drop the placeholder empty entry a fresh builder starts with.
        const existing = base.experience.filter(e => e.title || e.company || e.bullets.some(Boolean));
        setResume({ ...base, experience: [...entries, ...existing] });
        toast({
          title: `Freelance section inserted — ${entries.length} ${entries.length === 1 ? "entry" : "entries"} added`,
          description: "Add your dates to each entry, then export a typeset PDF or Word document.",
        });
        return;
      }
    } catch (e) {
      console.error("[ResumeBuilder] Boost insert failed:", e);
    }

    let fixes: ScanFixes | null = null;
    try {
      const raw = sessionStorage.getItem("rb_scan_fixes");
      if (raw) fixes = JSON.parse(raw) as ScanFixes;
    } catch { /* malformed payload — treat as absent */ }

    const existingDraft = loadDraft();
    if (existingDraft && !fixes) return;
    if (existingDraft && fixes) {
      const replace = window.confirm(
        "Replace your current builder draft with the resume from your scan, with the report's fixes applied?",
      );
      if (!replace) {
        try { sessionStorage.removeItem("rb_scan_fixes"); } catch { /* ignore */ }
        return;
      }
    }

    const sessionData = getResumeFromSession();
    if (!sessionData.resumeText || sessionData.resumeText.trim().length < 50) return;

    setIsPrefilling(true);
    supabase.functions
      .invoke("parse-resume-structured", { body: { resumeText: sessionData.resumeText } })
      .then(({ data, error }) => {
        if (error || !data?.success) {
          console.error("[ResumeBuilder] Prefill failed:", error || data?.error);
          return;
        }
        let next = normalizeBuilderResume(data);
        let appliedCount = 0;
        if (fixes?.rewrites?.length) {
          const result = applyScanRewrites(next, fixes.rewrites);
          next = result.resume;
          appliedCount = result.applied;
        }
        if (fixes?.keywords?.length) setScanKeywords(fixes.keywords);
        try { sessionStorage.removeItem("rb_scan_fixes"); } catch { /* ignore */ }
        setResume(next);
        toast({
          title: appliedCount > 0 ? `Resume imported — ${appliedCount} fix${appliedCount === 1 ? "" : "es"} from your report applied` : "Resume imported",
          description: appliedCount > 0
            ? "Rewritten bullets from your diagnostic are in place. Keyword suggestions from the scan are listed above the editor."
            : "We've prefilled the builder from your most recent resume — edit anything below.",
        });
      })
      .catch((err) => {
        console.error("[ResumeBuilder] Prefill error:", err);
      })
      .finally(() => setIsPrefilling(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveDraft(resume);
  }, [resume]);

  const handleStartOver = () => {
    if (!window.confirm("This will clear everything in the builder. Continue?")) return;
    setResume(createEmptyResume());
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      // The PDF export's standard font only supports Latin-1 + common
      // punctuation — a non-English resume would otherwise render with
      // blank/missing glyphs and no explanation.
      if (hasUnsupportedPdfCharacters(JSON.stringify(resume))) {
        toast({ title: "Heads up", description: "Some characters in your resume may not display correctly in the PDF (limited font support for non-Latin text)." });
      }
      const { exportResumeBuilderPDF } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderPDF(resume);
      setShowRescanCta(true);
    } catch (err) {
      console.error("[ResumeBuilder] PDF export failed:", err);
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportDocx = async () => {
    setIsExportingDocx(true);
    try {
      const { exportResumeBuilderDocx } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderDocx(resume);
      setShowRescanCta(true);
    } catch (err) {
      console.error("[ResumeBuilder] DOCX export failed:", err);
      toast({ title: "Export failed", description: "Could not generate the Word document. Please try again.", variant: "destructive" });
    } finally {
      setIsExportingDocx(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Free Resume Builder — Resume Booster" description="Build an ATS-friendly resume in minutes with our free guided builder. Export to PDF, no signup required." path="/builder" />
      <Header />
      <main className="pt-16 pb-20">
        <div className="container max-w-6xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1">Resume Builder</h1>
              <p className="text-muted-foreground text-sm">
                Build a clean, structured resume — edit any section and export when ready.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleStartOver}>
                <RotateCcw className="w-3.5 h-3.5" />
                Start Over
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" disabled={isExportingDocx} onClick={handleExportDocx}>
                {isExportingDocx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                Export DOCX
              </Button>
              <Button size="sm" className="gap-1.5" disabled={isExportingPdf} onClick={handleExportPdf}>
                {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Export PDF
              </Button>
            </div>
          </div>

          {isPrefilling && (
            <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
              <Sparkles className="w-4 h-4 text-primary animate-pulse shrink-0" />
              Importing your most recent resume into the builder...
            </div>
          )}

          {showRescanCta && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-success/5 border border-success/30 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Exported — now verify the fixes worked</p>
                <p className="text-xs text-muted-foreground">Rescan this exact version free and see the before/after score, same rubric both times.</p>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => {
                  try { sessionStorage.setItem("rb_resume_text", builderResumeToText(resume)); } catch { /* ignore */ }
                  window.location.href = "/?rescan=1#upload";
                }}
              >
                Rescan this version →
              </Button>
            </div>
          )}

          {scanKeywords.length > 0 && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-card border border-border">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-foreground">Keywords your scan found missing — work them in where they're true</p>
                <button onClick={() => setScanKeywords([])} className="text-xs text-muted-foreground hover:text-foreground shrink-0">dismiss</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scanKeywords.map((k) => (
                  <span key={k} className="px-2.5 py-1 rounded-full border border-primary/30 bg-primary/5 text-xs text-foreground">{k}</span>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">We never auto-insert keywords — only you can honestly claim a skill.</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Editor column */}
            <div className="space-y-8">
              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Contact</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Full Name</Label>
                    <Input
                      value={resume.contact.fullName}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, fullName: e.target.value } })}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Title / Headline</Label>
                    <Input
                      value={resume.contact.title}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, title: e.target.value } })}
                      placeholder="Senior Product Designer"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input
                      value={resume.contact.email}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, email: e.target.value } })}
                      placeholder="jane@example.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      value={resume.contact.phone}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, phone: e.target.value } })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Location</Label>
                    <Input
                      value={resume.contact.location}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, location: e.target.value } })}
                      placeholder="San Francisco, CA"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">LinkedIn</Label>
                    <Input
                      value={resume.contact.linkedIn}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, linkedIn: e.target.value } })}
                      placeholder="linkedin.com/in/janedoe"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Website / Portfolio</Label>
                    <Input
                      value={resume.contact.website}
                      onChange={(e) => setResume({ ...resume, contact: { ...resume.contact, website: e.target.value } })}
                      placeholder="janedoe.com"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Summary</h2>
                <Textarea
                  value={resume.summary}
                  onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                  placeholder="A brief 2-4 sentence overview of your experience and what you're looking for next."
                  className="min-h-[100px]"
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Experience</h2>
                <ExperienceEditor
                  entries={resume.experience}
                  onChange={(experience) => setResume({ ...resume, experience })}
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Education</h2>
                <EducationEditor
                  entries={resume.education}
                  onChange={(education) => setResume({ ...resume, education })}
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Skills</h2>
                <TagListEditor
                  tags={resume.skills}
                  onChange={(skills) => setResume({ ...resume, skills })}
                  placeholder="Add a skill and press Enter"
                />
              </section>

              <section className="space-y-3">
                <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Certifications</h2>
                <TagListEditor
                  tags={resume.certifications}
                  onChange={(certifications) => setResume({ ...resume, certifications })}
                  placeholder="Add a certification and press Enter"
                />
              </section>
            </div>

            {/* Live preview column */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mb-3">Preview</h2>
              <ResumePreview resume={resume} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
