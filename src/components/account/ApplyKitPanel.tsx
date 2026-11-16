// Per-application apply kit, launched from the Account tracker. Pro members
// generate the kit their plan includes (the gated function accepts their
// JWT). The $7 Apply Assistant is retired (owner decision 2026-10-11) and the
// free preview that sold it is retired with it (NB-10), so a member without
// Pro is offered nothing here.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ApplyAssistantResults, type ApplyPackageData } from "@/components/ApplyAssistantResults";
import { normalizeBuilderResume } from "@/types/resume-builder";
import { toast } from "sonner";
import { writingRefusalOf, writingRefusalText } from "@/lib/writing-refusal";

interface ApplyKitPanelProps {
  jobPosting: string;
  resumeText: string;
  proActive: boolean;
}

export function ApplyKitPanel({ jobPosting, resumeText, proActive }: ApplyKitPanelProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [kit, setKit] = useState<ApplyPackageData | null>(null);

  const openPanel = () => setOpen((v) => !v);

  const generateAsPro = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-apply-package", {
        body: { resumeText, jobPostingText: jobPosting },
      });
      if (error || !data?.success) {
        // The account's writing allowance is used up, or the session ended:
        // said with when it comes back, never as a failure to retry now.
        const refusal = error ? await writingRefusalOf(error) : null;
        if (refusal) { toast.error(writingRefusalText(refusal, (k, d, v) => t(k, d, v), i18n.language)); return; }
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
  // THE APPLY ASSISTANT IS RETIRED (owner decision 2026-10-11), and so is the
  // preview that sold it: a member without Pro is offered nothing here. Pro
  // members still generate the kit their plan includes.
  if (!proActive) return null;

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
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
