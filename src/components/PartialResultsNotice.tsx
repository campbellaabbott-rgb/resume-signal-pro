// The free report's partial-results banner. A report is partial for one of
// two reasons, and the banner names the one that happened: "our AI reviewer
// was unavailable" is false for a reply the model did write (sweep S8-067
// made thin model replies partial too).
import { useTranslation } from "react-i18next";

export type PartialReason = "rule_based" | "thin";

export function PartialResultsNotice({ reason }: { reason?: PartialReason | string | null }) {
  const { t } = useTranslation();
  const body = reason === "thin" ? t("homepage.partialResults.thin") : t("homepage.partialResults.ruleBased");
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-2">
      <span className="text-warning text-sm shrink-0" aria-hidden="true">⚠️</span>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t("homepage.partialResults.title")}</span> {body}
      </p>
    </div>
  );
}
