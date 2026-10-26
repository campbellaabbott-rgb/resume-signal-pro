import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { ago, date, isoAttr } from "@/lib/format";

/**
 * EVERY NUMBER NAMES ITS DATE BASIS. This is the small print that does it:
 * "read 46 min ago", "loaded 23 Jul 2026", "filed 3 Sep 2026", "as of 12 Oct
 * 2026", "posted 3 days ago", inside a <time dateTime> a machine can read.
 *
 * The basis is the word for what the date IS, and a caller must choose one:
 *   read    when we last read the employer's system
 *   loaded  when a public dataset was loaded (SEC figures)
 *   filed   when a public record was filed (WARN, 8-K)
 *   asOf    when a computed figure was computed
 *   posted  the date the employer's own system states for a posting
 * There is no basis for first_seen: our discovery time is never a posting age.
 */
export type AsOfBasis = "read" | "loaded" | "filed" | "asOf" | "posted";

export interface AsOfProps {
  iso: string | number | Date | null | undefined;
  basis: AsOfBasis;
  /** "46 min ago" rather than "12 Oct 2026". */
  relative?: boolean;
  now?: number;
  className?: string;
}

const FALLBACK: Record<AsOfBasis, string> = {
  read: "read {{when}}",
  loaded: "loaded {{when}}",
  filed: "filed {{when}}",
  asOf: "as of {{when}}",
  posted: "posted {{when}}",
};

export function AsOf({ iso, basis, relative = false, now, className }: AsOfProps) {
  const { t, i18n } = useTranslation();
  const attr = isoAttr(iso);
  if (!attr) return null;
  const when = relative ? ago(iso, { now, lng: i18n.language }) : date(iso, { lng: i18n.language });
  return (
    <time dateTime={attr} className={cn("text-xs text-subtle-foreground", className)}>
      {t(`ds.asOf.${basis}`, { when, defaultValue: FALLBACK[basis] })}
    </time>
  );
}
