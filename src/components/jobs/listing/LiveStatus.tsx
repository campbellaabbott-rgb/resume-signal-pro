/**
 * WHERE THIS POSTING STANDS AT ITS SOURCE — one line, three states, never
 * colour alone (an icon and a sentence in each).
 *
 *   read     the board still serves it, and the line says only what our data
 *            can support: when we last read THIS BOARD's feed ("Employer's
 *            feed read 46 min ago"). It is not a claim that this posting was
 *            in that read. recheckedAt is job_board_verifications.verified_at,
 *            which the job-board stamps on every successful visit of the
 *            board -- including a truncated one that "still cannot distinguish
 *            closed from displaced" -- so it dates the FEED, not the posting
 *            (supabase/functions/job-board/index.ts, attachRecheckedAt). The
 *            green "Live at source" chip that stood here claimed more than
 *            that and is gone. Without a read time there is nothing to date,
 *            so no line renders.
 *   partial  the board is bigger than one read reaches (a caution, not a
 *            verdict on the posting). The contract carries the flag
 *            (contracts.ts partialRead); no reader sends it yet, so this
 *            state renders only where a caller passes it.
 *   gone     a read of the employer's feed found it missing, with the day we
 *            first found it missing. That is OUR detection date
 *            (missing_since), which on a board read in laps can trail the
 *            employer's takedown by a read or more, so it is never worded as
 *            the day the employer took it down.
 */
import { AlertTriangle, Clock, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { date as fmtDate } from "@/lib/format";
import { agoText } from "./listing-text";

export interface ListingServed {
  missingSince?: string | null;
  recheckedAt?: string | null;
  /** The board is read in laps: no single read reaches every posting on it. */
  partialRead?: boolean;
}

const CHIP = "inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-xs font-medium leading-4";

export function LiveStatus({ served, now }: { served: ListingServed; now?: Date }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language || "en";
  if (served.missingSince) {
    return (
      <p data-live-status="gone" className={`${CHIP} border-destructive/40 text-destructive`}>
        <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {Number.isFinite(Date.parse(served.missingSince))
            ? t("listing.status.gone", { defaultValue: "No longer listed by the employer · first missing from its feed {{date}}", date: fmtDate(served.missingSince.slice(0, 10), { lng }) })
            : t("listing.status.goneUndated", "No longer listed by the employer")}
        </span>
      </p>
    );
  }
  if (served.partialRead) {
    return (
      <p data-live-status="partial" className={`${CHIP} border-warning/40 text-warning`}>
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {t("listing.status.partial", "We could read only part of this board")}
          <span className="sr-only">. {t("listing.status.partialTip", "This employer's board is bigger than one read reaches, so we cannot confirm every posting on it at every read.")}</span>
        </span>
      </p>
    );
  }
  const ago = agoText(served.recheckedAt, lng, now);
  if (!ago) return null;
  return (
    <p data-live-status="read" className={`${CHIP} border-border text-muted-foreground`}>
      <Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t("listing.status.read", { defaultValue: "Employer's feed read {{ago}}", ago })}
        <span className="sr-only">. {t("listing.status.readTip", "That read covers the employer's whole board. It is not a check of this one posting.")}</span>
      </span>
    </p>
  );
}
