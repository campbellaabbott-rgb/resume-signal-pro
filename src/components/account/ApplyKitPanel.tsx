// Per-application apply kit, launched from the Account tracker. Pro members
// generate directly (the gated function accepts their JWT); everyone else
// gets the standard preview-before-pay flow with the resume + posting
// pre-stored server-side so post-purchase delivery has everything.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProductPreview } from "@/components/ProductPreview";
import { ApplyAssistantResults, type ApplyPackageData } from "@/components/ApplyAssistantResults";
import { normalizeBuilderResume } from "@/types/resume-builder";
import { toast } from "sonner";

interface ApplyKitPanelProps {
  jobPosting: string;
  resumeText: string;
  proActive: boolean;
}

export function ApplyKitPanel({ jobPosting, resumeText, proActive }: ApplyKitPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [kit, setKit] = useState<ApplyPackageData | null>(null);
  const [tempSessionId, setTempSessionId] = useState<string | undefined>(undefined);

  const openPanel = async () => {
    setOpen((v) => !v);
    if (!proActive && !tempSessionId) {
      // Pre-store resume + posting so checkout delivery can pick them up.
      try {
        const { data } = await supabase.rpc("store_temp_resume", {
          p_resume: resumeText,
          p_linkedin: null,
          p_job_description: jobPosting,
        } as never);
        if (typeof data === "string") setTempSessionId(data);
      } catch { /* checkout re-stores as fallback */ }
    }
  };

  const generateAsPro = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-apply-package", {
        body: { resumeText, jobPostingText: jobPosting },
      });
      if (error || !data?.success) {
        const msg = (data as { error?: string })?.error ?? t("accountPage.akGenFailed", "Generation failed — try again.");
        toast.error(msg);
        return;
      }
      setKit({
        ...(data as ApplyPackageData),
        tailoredResume: normalizeBuilderResume((data as { tailoredResume: Record<string, unknown> }).tailoredResume),
      });
    } catch {
      toast.error(t("accountPage.akGenFailed", "Generation failed — try again."));
    } finally {
      setGenerating(false);
    }
  };

  if (!jobPosting || jobPosting.trim().length < 30 || !resumeText || resumeText.trim().length < 50) return null;

  return (
    <div className="mt-2">
      <button
        onClick={openPanel}
        className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
      >
        <FileText className="w-3 h-3" />
        {t("accountPage.akButton", "Application kit — tailored resume for this job")}
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-border/50">
          {kit ? (
            <ApplyAssistantResults data={kit} />
          ) : proActive ? (
            <div className="flex items-center gap-3">
              <button
                onClick={generateAsPro}
                disabled={generating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
              >
                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {generating ? t("accountPage.akGenerating", "Tailoring your resume… (~30s)") : t("accountPage.akGenerate", "Generate kit (included in Pro)")}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {t("accountPage.akBlurb", "Tailored resume + gap list + checklist, fact-checked against your real resume.")}
              </span>
            </div>
          ) : (
            <ProductPreview
              productId="applyAssistant"
              resumeText={resumeText}
              jobDescription={jobPosting}
              sessionId={tempSessionId}
            />
          )}
        </div>
      )}
    </div>
  );
}
