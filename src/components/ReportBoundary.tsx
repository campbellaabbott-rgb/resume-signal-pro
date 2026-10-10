// The free report's crash boundary (sweep S8-117).
//
// The report lives only in React state, so the old advice, "try refreshing
// the page to see the results", discarded the report and cost a scan. And the
// boundary never reset: once a report crashed, scanning again (even the same
// résumé) kept showing the crash notice. It is keyed by each new result, and
// it says what actually works: scan again.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CardErrorBoundary } from "@/components/CardErrorBoundary";

export function ReportCrashNotice() {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-6 text-center">
      <p className="text-sm font-semibold text-foreground mb-1">{t("homepage.reportCrash.title")}</p>
      <p className="text-xs text-muted-foreground">{t("homepage.reportCrash.body")}</p>
    </div>
  );
}

/** `resultKey` changes with every new scan result, so a new report starts with a fresh boundary. */
export function ReportBoundary({ resultKey, children }: { resultKey: string | number; children: ReactNode }) {
  return (
    <CardErrorBoundary key={resultKey} section="free-keyword-results" fallback={<ReportCrashNotice />}>
      {children}
    </CardErrorBoundary>
  );
}
