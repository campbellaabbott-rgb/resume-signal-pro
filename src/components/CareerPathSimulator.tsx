import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TrendingUp, Loader2, ChevronRight, DollarSign, AlertTriangle, Zap, Download, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { hasUnsupportedPdfCharacters } from "@/lib/pdf-text-support";

interface CareerPathSimulatorProps {
  resumeText: string;
  industry?: string;
  currentRole?: string;
  // Paid tier: a concrete 90-day action plan per path and a downloadable
  // roadmap PDF — distinct from the free version's high-level timeline only.
  isPremium?: boolean;
}

interface TimelineStep {
  year: string;
  role: string;
  company: string;
  salaryRange: string;
  keyMove: string;
}

interface CareerPath {
  id: string;
  name: string;
  emoji: string;
  description: string;
  timeline: TimelineStep[];
  requiredSkills: string[];
  riskLevel: string;
  probability: string;
  actionPlan90Days?: string[];
}

interface CareerData {
  currentPosition: {
    title: string;
    level: string;
    strengths: string[];
    gaps: string[];
  };
  paths: CareerPath[];
  immediateNextStep: string;
}

const riskColors: Record<string, string> = {
  High: "text-red-600",
  Medium: "text-yellow-600",
  Low: "text-green-600",
};

const pathColors: Record<string, { bg: string; border: string; accent: string }> = {
  ambitious: { bg: "bg-purple-500/5", border: "border-purple-500/20", accent: "text-purple-700" },
  steady: { bg: "bg-blue-500/5", border: "border-blue-500/20", accent: "text-blue-700" },
  pivot: { bg: "bg-orange-500/5", border: "border-orange-500/20", accent: "text-orange-700" },
};

export function CareerPathSimulator({ resumeText, industry, currentRole, isPremium }: CareerPathSimulatorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<CareerData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const { toast } = useToast();

  const generate = async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("generate-career-path", {
        body: { resumeText, industry, currentRole, isPremium, language: localStorage.getItem('i18nextLng') },
      });
      if (error) throw error;
      if (!result?.success) throw new Error(result?.error || "Generation failed");
      setData(result.data);
      if (result.data.paths?.length > 0) setActivePath(result.data.paths[0].id);
    } catch (err: any) {
      toast({ title: t('careerPathSimulator.error'), description: err.message || t('careerPathSimulator.generateFailed'), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPdf = async () => {
    if (!data) return;
    setIsExportingPdf(true);
    try {
      // The PDF export's standard font only supports Latin-1 + common
      // punctuation — content in other scripts would otherwise render as
      // blank/missing glyphs with no explanation.
      if (hasUnsupportedPdfCharacters(JSON.stringify(data))) {
        toast({ title: t('careerPathSimulator.toast.headsUp'), description: t('careerPathSimulator.toast.pdfCharWarning') });
      }
      const { exportCareerPathPDF } = await import("@/lib/career-tools-export");
      await exportCareerPathPDF(data);
    } catch (err) {
      console.error("[CareerPathSimulator] PDF export failed:", err);
      toast({ title: t('careerPathSimulator.toast.exportFailed'), description: t('careerPathSimulator.toast.exportFailedDescription'), variant: "destructive" });
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (!data) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 text-muted-foreground text-xs mb-2">
          <TrendingUp className="w-3.5 h-3.5" />
          {t('careerPathSimulator.badge')}
        </div>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          {isPremium ? t('careerPathSimulator.descriptionPremium') : t('careerPathSimulator.descriptionFree')}
        </p>
        <Button onClick={generate} disabled={isLoading} size="sm" className="gap-2">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
          {isLoading ? t('careerPathSimulator.mapping') : t('careerPathSimulator.simulateButton')}
        </Button>
      </div>
    );
  }

  const activePathData = data.paths?.find(p => p.id === activePath);
  const colors = pathColors[activePath || "steady"] || pathColors.steady;

  return (
    <div className="space-y-4">
      {/* Current Position */}
      <div className="rounded-xl bg-muted/20 border border-border/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-foreground">📍 {data.currentPosition?.title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
            {data.currentPosition?.level}
          </span>
          {isPremium && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 text-[10px] px-2 ml-auto"
              disabled={isExportingPdf}
              onClick={handleExportPdf}
            >
              {isExportingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {t('careerPathSimulator.exportRoadmap')}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            {data.currentPosition?.strengths?.map((s, i) => (
              <p key={i} className="text-[11px] text-green-700">✓ {s}</p>
            ))}
          </div>
          <div>
            {data.currentPosition?.gaps?.map((g, i) => (
              <p key={i} className="text-[11px] text-orange-700">⚠ {g}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Path Selector */}
      <div className="flex gap-1.5">
        {data.paths?.map((path) => {
          const isActive = activePath === path.id;
          const pc = pathColors[path.id] || pathColors.steady;
          return (
            <button
              key={path.id}
              onClick={() => setActivePath(path.id)}
              className={cn(
                "flex-1 rounded-lg p-2 text-center border transition-all",
                isActive ? `${pc.bg} ${pc.border} ring-1 ring-primary/20` : "bg-muted/10 border-border/30 hover:bg-muted/20"
              )}
            >
              <span className="text-lg block">{path.emoji}</span>
              <span className={cn("text-[10px] font-semibold block", isActive ? pc.accent : "text-muted-foreground")}>{path.name}</span>
              <span className="text-[10px] text-muted-foreground block">{path.probability}</span>
            </button>
          );
        })}
      </div>

      {/* Active Path Timeline */}
      {activePathData && (
        <div className={cn("rounded-xl border p-4", colors.bg, colors.border)}>
          <p className="text-xs text-muted-foreground mb-3">{activePathData.description}</p>

          {/* Timeline */}
          <div className="relative pl-4 space-y-4">
            <div className="absolute left-1.5 top-2 bottom-2 w-0.5 bg-border/50" />
            {activePathData.timeline?.map((step, i) => (
              <div key={i} className="relative">
                <div className={cn("absolute -left-2.5 top-1 w-2.5 h-2.5 rounded-full border-2 border-background",
                  i === 0 ? "bg-primary" : "bg-muted-foreground/30"
                )} />
                <div className="ml-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-muted-foreground">{step.year}</span>
                    <span className="text-xs font-semibold text-foreground">{step.role}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{step.company}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700">
                      <DollarSign className="w-3 h-3" />{step.salaryRange}
                    </span>
                  </div>
                  <div className="flex items-start gap-1 mt-1">
                    <Zap className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                    <span className="text-[11px] text-foreground">{step.keyMove}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Path details */}
          <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-3 flex-wrap">
            <span className={cn("text-[10px] font-semibold", riskColors[activePathData.riskLevel] || "text-muted-foreground")}>
              {t('careerPathSimulator.risk', { level: activePathData.riskLevel })}
            </span>
            <div className="flex gap-1 flex-wrap">
              {activePathData.requiredSkills?.map((s, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{s}</span>
              ))}
            </div>
          </div>

          {isPremium && activePathData.actionPlan90Days && activePathData.actionPlan90Days.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <p className="text-[10px] font-semibold text-foreground mb-1.5 flex items-center gap-1">
                <ListChecks className="w-3 h-3 text-primary" /> {t('careerPathSimulator.actionPlan90Days')}
              </p>
              <div className="space-y-1">
                {activePathData.actionPlan90Days.map((step, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground">
                    <span className="font-semibold text-primary shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Immediate Next Step */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3">
        <p className="text-xs font-semibold text-primary mb-1">{t('careerPathSimulator.doThisWeek')}</p>
        <p className="text-xs text-foreground">{data.immediateNextStep}</p>
      </div>
    </div>
  );
}
