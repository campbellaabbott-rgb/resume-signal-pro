// The free report's partial-results banner. A report is partial for one of
// three reasons, and the banner names the one that happened: "our AI reviewer
// was unavailable" is false for a reply the model did write (sweep S8-067
// made thin model replies partial too); "automated analysis filled them in"
// is false for the streaming fallback, which fills nothing: its empty sections
// are hidden (S11-147); and a report the backup scanner wrote during an outage
// has none of the main scanner's score checks or audit (S11-150: /methodology
// described only the main scanner). A backup report whose own reply was thin
// says both: the backup wrote it, and the sections it left empty are hidden.
// A backup report on a scan run with a posting also says it compared nothing
// with that posting (S14X-118): the backup scanner sends postingComparison
// 'not_available', and the reader had pasted a posting to be checked against.
import { useTranslation } from "react-i18next";

export type PartialReason = "rule_based" | "thin" | "thin_unfilled" | "fallback";

export function PartialResultsNotice({ reason, hidden, postingComparison }: {
  reason?: PartialReason | string | null;
  hidden?: boolean | null;
  /** The scan's postingComparison field: 'not_available' when the posting was not compared. */
  postingComparison?: string | null;
}) {
  const { t } = useTranslation();
  const base = reason === "thin" ? t("homepage.partialResults.thin")
    : reason === "thin_unfilled" ? t("homepage.partialResults.thinUnfilled")
    : reason === "fallback"
      ? (hidden ? `${t("homepage.partialResults.fallback")} ${t("homepage.partialResults.fallbackHidden")}` : t("homepage.partialResults.fallback"))
    : t("homepage.partialResults.ruleBased");
  const body = postingComparison === "not_available" ? `${base} ${t("freeScanPage.partial.noPostingComparison")}` : base;
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 flex items-start gap-2">
      <span className="text-warning text-sm shrink-0" aria-hidden="true">⚠️</span>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t("homepage.partialResults.title")}</span> {body}
      </p>
    </div>
  );
}
