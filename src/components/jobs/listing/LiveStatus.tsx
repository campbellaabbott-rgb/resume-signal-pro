/**
 * WHERE THIS POSTING STANDS AT ITS SOURCE — one chip, three states, never
 * colour alone (an icon and a sentence in each).
 *
 *   live     the employer's feed listed it at our last read, and the read
 *            time is printed beside the claim: "Live at source · feed read
 *            46 min ago". Without a read time there is no claim to date, so
 *            no live chip renders at all.
 *   partial  the board is bigger than one read reaches (a caution, not a
 *            verdict on the posting).
 *   gone     the employer's feed stopped listing it, with the day it did.
 */
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatListingDate } from "@/lib/listing/age";
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
            ? t("listing.status.gone", { defaultValue: "No longer listed by the employer · taken down {{date}}", date: formatListingDate(served.missingSince, lng) })
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
  const ago = agoText(t, served.recheckedAt, lng, now);
  if (!ago) return null;
  return (
    <p data-live-status="live" className={`${CHIP} border-success/40 text-success`} title={t("listing.status.liveTip", "The employer's own feed listed this posting the last time we read it.")}>
      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t("listing.status.live", { defaultValue: "Live at source · feed read {{ago}}", ago })}</span>
    </p>
  );
}
