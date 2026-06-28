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
import { supabase } from "@/integrations/supabase/client";
import { getResumeFromSession } from "@/hooks/use-session-resume";
import {
  BuilderResume,
  createEmptyResume,
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

export default function ResumeBuilder() {
  const [resume, setResume] = useState<BuilderResume>(() => loadDraft() || createEmptyResume());
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const hasAttemptedPrefillRef = useRef(false);
  const { toast } = useToast();

  // On first load, if there's no existing draft but the user has a resume from a
  // recent scan/analysis, offer to prefill the builder from it via AI extraction.
  useEffect(() => {
    if (hasAttemptedPrefillRef.current) return;
    hasAttemptedPrefillRef.current = true;

    const existingDraft = loadDraft();
    if (existingDraft) return;

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
        setResume(normalizeBuilderResume(data));
        toast({
          title: "Resume imported",
          description: "We've prefilled the builder from your most recent resume — edit anything below.",
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
      const { exportResumeBuilderPDF } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderPDF(resume);
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
      <main className="pt-24 pb-20">
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
