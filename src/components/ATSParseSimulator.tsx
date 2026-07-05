import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { simulateAtsParse, type ParseCheckStatus } from "@/lib/ats-parse-simulator";
import { useTranslation } from "react-i18next";

interface ATSParseSimulatorProps {
  resumeText: string;
  multiColumnDetected?: boolean;
  /** True when the text came from a real file extraction (PDF/DOCX upload) —
      the analyzed text IS what an ATS receives, not a simulation of it. */
  isActualExtraction?: boolean;
}

const statusConfig: Record<ParseCheckStatus, { icon: typeof CheckCircle2; className: string; bg: string }> = {
  pass: { icon: CheckCircle2, className: "text-success", bg: "bg-success/5 border-success/20" },
  warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/5 border-warning/20" },
  fail: { icon: XCircle, className: "text-destructive", bg: "bg-destructive/5 border-destructive/20" },
};

// This is deliberately visually distinct from the AI-narrative sections elsewhere
// on the page — it's showing mechanical, reproducible findings (the same
// extracted text every check runs against), not a model's holistic judgment.
export function ATSParseSimulator({ resumeText, multiColumnDetected, isActualExtraction }: ATSParseSimulatorProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const result = useMemo(
    () => simulateAtsParse(resumeText, { multiColumnDetected }),
    [resumeText, multiColumnDetected]
  );

  const { overallConfidence, checks } = result;
  const color = overallConfidence >= 80 ? "text-success" : overallConfidence >= 50 ? "text-warning" : "text-destructive";

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 text-left">
          <div className="p-2 rounded-xl bg-muted shrink-0">
            <ScanLine className="w-4 h-4 text-foreground" />
          </div>
          <div>
            <h3 className="font-bold text-foreground">{t('atsParseSimulator.title')}</h3>
            <p className="text-xs text-muted-foreground">
              {isActualExtraction
                ? "This is the actual text extracted from your uploaded file — the same operation an ATS performs. Not a simulation."
                : t('atsParseSimulator.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={cn("text-xl font-bold tabular-nums", color)}>{overallConfidence}%</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="mt-4 space-y-2">
          {checks.map((check) => {
            const { icon: Icon, className, bg } = statusConfig[check.status];
            return (
              <div key={check.id} className={cn("rounded-xl border p-3 flex items-start gap-2.5", bg)}>
                <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", className)} />
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-semibold", className)}>{check.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
