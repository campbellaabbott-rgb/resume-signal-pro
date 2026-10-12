/**
 * THE DECISION ROW: one filled primary, Apply on the employer's own site; the
 * free fit check as the secondary; Save as a named icon. Each caption sits
 * under its own button, so no sentence is left describing the wrong control.
 *
 * Apply opens in a new tab and says so to a screen reader. Its URL goes through
 * cleanApplyUrl (the one Workday rewrite) here, at the only place a listing
 * renders an apply link, so the card, the pane, the sheet and the page all
 * open the same address.
 */
import { Bookmark, BookmarkCheck, ExternalLink, Loader2, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { applySystem, cleanApplyUrl } from "@/lib/listing/apply-url";
import { applyLabel } from "./listing-text";

export interface PostingActionsProps {
  employer: string;
  applyUrl: string | null | undefined;
  onApply?: () => void;
  /** Absent: no fit button (a description the scanner would refuse offers none). */
  onCheckFit?: () => void;
  checkFitBusy?: boolean;
  /** Absent: no Save control (the posting page has no tracker to save into). */
  onToggleSave?: () => void;
  saved?: boolean;
  /** "short": the phone sheet's footer — "Apply on employer site", no captions. */
  variant?: "full" | "short";
  title?: string;
}

export function PostingActions({
  employer, applyUrl, onApply, onCheckFit, checkFitBusy, onToggleSave, saved, variant = "full", title,
}: PostingActionsProps) {
  const { t } = useTranslation();
  const href = cleanApplyUrl(applyUrl);
  const system = applySystem(href);
  const short = variant === "short";
  const saveLabel = title
    ? t("listing.card.save", { defaultValue: "Save {{title}}", title })
    : t("jobsPage.saveJob", "Save");
  return (
    <div className={short ? "flex min-w-0 flex-wrap items-center gap-2" : "flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2"} data-posting-actions={variant}>
      {href && (
        <div className={short ? "min-w-0 flex-1 basis-full sm:basis-auto" : "min-w-0 max-w-full"}>
          <Button asChild className={short ? "w-full whitespace-normal text-center" : "max-w-full whitespace-normal text-left"}>
            <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={() => onApply?.()} data-apply-link="">
              <span>{short ? t("listing.actions.applyShort", "Apply on employer site") : applyLabel(t, employer)}</span>
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only"> {t("listing.actions.newTab", "(opens in a new tab)")}</span>
            </a>
          </Button>
          {!short && (
            <p className="mt-1 text-xs text-muted-foreground">
              {system?.named
                ? t("listing.actions.applyCaption", { defaultValue: "Opens on {{system}}, in a new tab.", system: system.label })
                : t("listing.actions.applyCaptionPlain", "Opens the employer's own site, in a new tab.")}
            </p>
          )}
        </div>
      )}
      {onCheckFit && (
        <div className={short ? "min-w-0 flex-1" : "min-w-0 max-w-full"}>
          <Button variant="secondary" className={short ? "w-full whitespace-normal" : "max-w-full whitespace-normal"} disabled={checkFitBusy} onClick={onCheckFit}>
            {checkFitBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Target className="h-4 w-4" aria-hidden="true" />}
            {t("listing.actions.checkFit", "Check my fit, free")}
          </Button>
          {!short && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("listing.actions.checkFitCaption", "Scores your résumé against this posting's own description.")}
            </p>
          )}
        </div>
      )}
      {onToggleSave && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-pressed={!!saved}
          aria-label={saveLabel}
          title={saved ? t("jobsPage.savedTip", "In your application tracker — click to open it") : t("jobsPage.saveTip", "Save this posting to your application tracker")}
          onClick={onToggleSave}
        >
          {saved ? <BookmarkCheck className="h-5 w-5 text-primary" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />}
        </Button>
      )}
    </div>
  );
}
