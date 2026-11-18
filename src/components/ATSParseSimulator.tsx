import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { simulateAtsParse, type ParseCheckResult, type ParseCheckStatus } from "@/lib/ats-parse-simulator";
import { useTranslation } from "react-i18next";

interface ATSParseSimulatorProps {
  resumeText: string;
  multiColumnDetected?: boolean;
  /** True when the text came from a file upload (PDF/DOCX): the checks ran
      on the text our reader extracted, which an ATS may read differently. */
  isActualExtraction?: boolean;
  /** The file's email and phone sit only in its page header (parse-docx). */
  contactOnlyInHeader?: boolean;
  /**
   * Say each check in the reader's language (the free report). The paid
   * report leaves it off and keeps the English text it has always shown.
   */
  translated?: boolean;
}

const statusConfig: Record<ParseCheckStatus, { icon: typeof CheckCircle2; className: string; bg: string }> = {
  pass: { icon: CheckCircle2, className: "text-success", bg: "bg-success/5 border-success/20" },
  warning: { icon: AlertTriangle, className: "text-warning", bg: "bg-warning/5 border-warning/20" },
  fail: { icon: XCircle, className: "text-destructive", bg: "bg-destructive/5 border-destructive/20" },
};

// This is deliberately visually distinct from the AI-narrative sections elsewhere
// on the page — it's showing mechanical, reproducible findings (the same
// extracted text every check runs against), not a model's holistic judgment.
export function ATSParseSimulator({ resumeText, multiColumnDetected, isActualExtraction, contactOnlyInHeader, translated }: ATSParseSimulatorProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const result = useMemo(
    () => simulateAtsParse(resumeText, { multiColumnDetected, contactOnlyInHeader }),
    [resumeText, multiColumnDetected, contactOnlyInHeader]
  );
  // A list of section ids in vars is said as the translated section names.
  const sayVars = (check: ParseCheckResult) => Object.fromEntries(
    Object.entries(check.vars ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((id) => t(`freeScanPage.parseCheck.section.${id}`)).join(", ") : v]),
  );
  const labelOf = (check: ParseCheckResult) => (translated ? t(`freeScanPage.parseCheck.label.${check.key}`) : check.label);
  const detailOf = (check: ParseCheckResult) => (translated ? t(`freeScanPage.parseCheck.detail.${check.detailKey}`, sayVars(check)) : check.detail);

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
              {/* An upload's checks ran on the text OUR reader extracted, which
                  an ATS's own reader may see differently (RC-S13-036): the
                  line says so instead of claiming to be the ATS's view. */}
              {isActualExtraction ? t('freeScanPage.parseCheck.fromYourFile') : t('atsParseSimulator.subtitle')}
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
                  <p className={cn("text-sm font-semibold", className)}>{labelOf(check)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{detailOf(check)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
