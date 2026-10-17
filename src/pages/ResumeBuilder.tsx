import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Loader2, Download, FileText, RotateCcw, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
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
import {
  IMPORTED_FROM_KEY,
  applyScanRewrites,
  builderResumeHasContent,
  importDecision,
  textFingerprint,
} from "@/lib/builder-import";

const DRAFT_STORAGE_KEY = "resumeBuilderDraft";

// A draft with nothing in it is no draft (L3-11): the empty starting résumé
// is never saved, and one saved before this change reads as absent.
function loadDraft(): BuilderResume | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as BuilderResume;
    return builderResumeHasContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

function saveDraft(resume: BuilderResume) {
  try {
    if (builderResumeHasContent(resume)) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(resume));
    else localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Storage full or disabled — not worth surfacing to the user, the draft just
    // won't persist across refreshes.
  }
}

/** The scan the draft was imported from, or last offered (see builder-import). */
function readImportedFrom(): string | null {
  try { return localStorage.getItem(IMPORTED_FROM_KEY); } catch { return null; }
}
function writeImportedFrom(text: string) {
  try { localStorage.setItem(IMPORTED_FROM_KEY, textFingerprint(text)); } catch { /* storage blocked */ }
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

export default function ResumeBuilder() {
  const { t } = useTranslation();
  const [resume, setResume] = useState<BuilderResume>(() => loadDraft() || createEmptyResume());
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [scanKeywords, setScanKeywords] = useState<string[]>([]);
  const [showRescanCta, setShowRescanCta] = useState(false);
  const hasAttemptedPrefillRef = useRef(false);
  const { toast } = useToast();

  // On first load, prefill from this tab's scan via AI extraction: at once when
  // there is no draft with content; with a confirmation over a real draft when
  // the scan is one it was not imported from (or the report's "fixes applied"
  // handoff is present). See lib/builder-import (L3-11).
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
        const isUmbrella = boost.structure.startsWith("consolidated") || boost.structure === "fractional_portfolio";
        const entries = isUmbrella
          ? [{
              ...createEmptyExperienceEntry(),
              title: boost.header,
              company: boost.structure === "fractional_portfolio" ? "Independent practice" : "Independent / Freelance",
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

    const sessionData = getResumeFromSession();
    const decision = importDecision({
      draft: loadDraft(),
      sessionText: sessionData.resumeText,
      hasFixes: !!fixes,
      lastOffered: readImportedFrom(),
    });
    if (decision === "none" || decision === "keep") return;
    if (decision === "ask" || decision === "ask-fixes") {
      // Asked once per scan: a "no" is remembered, so the next visit opens
      // the draft without asking again about the same scan.
      writeImportedFrom(sessionData.resumeText!);
      const replace = window.confirm(
        decision === "ask-fixes" ? t("resumeBuilder.replaceWithFixes") : t("resumeBuilder.replaceWithLatestScan"),
      );
      if (!replace) {
        try { sessionStorage.removeItem("rb_scan_fixes"); } catch { /* ignore */ }
        return;
      }
    }
    const importedText = sessionData.resumeText!;

    setIsPrefilling(true);
    supabase.functions
      .invoke("parse-resume-structured", { body: { resumeText: importedText } })
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
        writeImportedFrom(importedText);
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
    // The clear sticks (S11-144): the tab's scan counts as offered, so the
    // next visit opens the empty builder instead of re-importing it.
    const scanned = getResumeFromSession().resumeText;
    if (scanned && scanned.trim()) writeImportedFrom(scanned);
  };

  // A résumé with no name is refused by the exporter (no "Your Name" header
  // goes to an employer, S12-030): the person is asked for it.
  const missingName = (err: unknown) => (err as { code?: string } | null)?.code === "missing_name";
  const askForName = () => toast({
    title: t("resumeBuilder.toast.addNameTitle", "Add your name first"),
    description: t("resumeBuilder.toast.addNameDescription", "Your résumé needs your name at the top before it can be downloaded."),
    variant: "destructive",
  });

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      // The PDF's built-in fonts draw only Windows-1252. A résumé they cannot
      // draw (Łukasz, ₹) is saved as a Word file instead, never as a garbled
      // PDF (S12-006), and the person is told why.
      const { exportResumeBuilderPDF } = await import("@/lib/resume-builder-export");
      const saved = await exportResumeBuilderPDF(resume);
      if (saved?.format === "docx") {
        toast({
          title: t("resumeBuilder.toast.savedAsWordTitle", "Saved as a Word file"),
          description: t("resumeBuilder.toast.savedAsWordDescription", "The PDF's fonts can't draw {{chars}}, so we saved a Word file, which keeps every character.", { chars: saved.unsupported.slice(0, 5).join(" ") }),
        });
      }
      setShowRescanCta(true);
    } catch (err) {
      if (missingName(err)) { askForName(); return; }
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
      if (missingName(err)) { askForName(); return; }
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
                  // The rescan's text IS this draft (S11-143): marked as the
                  // draft's source, so coming back does not offer to replace
                  // the draft with a re-parse of its own export.
                  const builderText = builderResumeToText(resume);
                  try { sessionStorage.setItem("rb_resume_text", builderText); } catch { /* ignore */ }
                  writeImportedFrom(builderText);
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
