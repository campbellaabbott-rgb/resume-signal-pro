// The free report's partial-results banner. A report is partial for one of
// three reasons, and the banner names the one that happened: "our AI reviewer
// was unavailable" is false for a reply the model did write (sweep S8-067
// made thin model replies partial too), and a report the backup scanner wrote
// during an outage has none of the main scanner's score checks or audit
// (S11-150: /methodology described only the main scanner).
import { useTranslation } from "react-i18next";

export type PartialReason = "rule_based" | "thin" | "fallback";

export function PartialResultsNotice({ reason }: { reason?: PartialReason | string | null }) {
  const { t } = useTranslation();
  const body = reason === "thin" ? t("homepage.partialResults.thin")
    : reason === "fallback" ? t("homepage.partialResults.fallback")
    : t("homepage.partialResults.ruleBased");
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-2">
      <span className="text-warning text-sm shrink-0" aria-hidden="true">⚠️</span>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t("homepage.partialResults.title")}</span> {body}
      </p>
    </div>
  );
}
