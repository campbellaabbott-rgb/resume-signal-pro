import { useState } from "react";
import { Download, FileText, Send, AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResumePreview } from "@/components/builder/ResumePreview";
import { BuilderResume } from "@/types/resume-builder";
import { useToast } from "@/hooks/use-toast";

export interface ApplyPackageData {
  jobMetadata: {
    company: string;
    roleTitle: string;
    applyMethodHint: string;
  };
  tailoredResume: BuilderResume;
  skillGaps: string[];
  checklist: string[];
}

interface ApplyAssistantResultsProps {
  data: ApplyPackageData;
  coverLetter?: string;
}

export function ApplyAssistantResults({ data, coverLetter }: ApplyAssistantResultsProps) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const { toast } = useToast();

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      const { exportResumeBuilderPDF } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderPDF(data.tailoredResume);
    } catch (err) {
      console.error("[ApplyAssistantResults] PDF export failed:", err);
      toast({ title: "Export failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportDocx = async () => {
    setIsExportingDocx(true);
    try {
      const { exportResumeBuilderDocx } = await import("@/lib/resume-builder-export");
      await exportResumeBuilderDocx(data.tailoredResume);
    } catch (err) {
      console.error("[ApplyAssistantResults] DOCX export failed:", err);
      toast({ title: "Export failed", description: "Could not generate the Word document. Please try again.", variant: "destructive" });
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleCopyCoverLetter = async () => {
    if (!coverLetter) return;
    await navigator.clipboard.writeText(coverLetter);
    toast({ title: "Copied", description: "Cover letter copied to clipboard." });
  };

  return (
    <div className="space-y-6">
      {/* Explicit "you're in control" banner — this is the core promise of the product */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
        <Send className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">This is prep work, not auto-submission</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            We never submit anything on your behalf. Review everything below, then apply yourself on the
            employer's site — exactly as if you'd done all this preparation manually.
          </p>
        </div>
      </div>

      {/* Job metadata */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">{data.jobMetadata.company || "Unknown company"}</Badge>
          <span className="text-sm font-semibold">{data.jobMetadata.roleTitle || "Role"}</span>
        </div>
        {data.jobMetadata.applyMethodHint && (
          <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
            <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
            {data.jobMetadata.applyMethodHint}
          </p>
        )}
      </div>

      {/* Checklist */}
      <div className="p-4 rounded-xl border border-border bg-card">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-success" />
          Your Next Steps
        </h3>
        <ol className="space-y-2">
          {data.checklist.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Skill gaps — honest callout, not fabricated into the resume */}
      {data.skillGaps.length > 0 && (
        <div className="p-4 rounded-xl border border-warning/30 bg-warning/5">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2 text-warning">
            <AlertTriangle className="w-4 h-4" />
            Honest Gaps (Not Added to Your Resume)
          </h3>
          <p className="text-xs text-muted-foreground mb-2">
            This job wants the following, and your resume doesn't genuinely support claiming them — we won't
            fabricate experience you don't have.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.skillGaps.map((gap, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning border border-warning/20">
                {gap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tailored resume preview + export */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Tailored Resume</h3>
          <div className="flex gap-2">
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
        <ResumePreview resume={data.tailoredResume} />
      </div>

      {/* Cover letter */}
      {coverLetter && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Cover Letter</h3>
            <Button variant="outline" size="sm" onClick={handleCopyCoverLetter}>Copy Text</Button>
          </div>
          <div className="p-5 rounded-lg bg-white text-neutral-900 border border-border whitespace-pre-wrap text-sm leading-relaxed font-serif">
            {coverLetter}
          </div>
        </div>
      )}
    </div>
  );
}
