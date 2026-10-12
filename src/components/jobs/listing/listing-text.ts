/**
 * The few sentences every listing component builds the same way, so the card,
 * the pane and the page cannot word one fact two ways. Pure functions over a
 * `t` — no hooks — so a test can call them directly.
 */
import type { TFunction } from "i18next";
import { possessive } from "@/lib/company-display";
import { durationSince, formatListingDate, listingAge, listingSource } from "@/lib/listing/age";
import { systemLabel } from "@/lib/listing/apply-url";
import type { ListingJob } from "@/lib/listing/types";
import type { PayBasisKey } from "@/lib/listing/pay";

/** "46 min ago" / "just now", or null for a stamp we cannot read. */
export function agoText(t: TFunction, iso: string | null | undefined, lng: string, now?: Date): string | null {
  const d = durationSince(iso, lng, now);
  if (!d) return null;
  return d.kind === "now"
    ? t("listing.ago.now", "just now")
    : t("listing.ago.since", { defaultValue: "{{duration}} ago", duration: d.text });
}

/** "/hr", "/yr" … the period suffix of our annual estimate and of a stated basis. */
export function periodSuffix(t: TFunction, period: PayBasisKey): string {
  const fallback: Record<PayBasisKey, string> = { hour: "/hr", day: "/day", week: "/wk", month: "/mo", year: "/yr" };
  return t(`listing.period.${period}`, fallback[period]);
}

/** The card's age clause: only for an employer-stated date from a system that does not move it. */
export function cardAgeText(t: TFunction, job: Pick<ListingJob, "id" | "source" | "postedAt">, now?: Date): string | null {
  const age = listingAge(job, now);
  if (age.kind !== "dated") return null;
  return age.days === 0
    ? t("listing.card.postedToday", "posted today")
    : t("listing.card.postedDaysAgo", {
        count: age.days,
        defaultValue_one: "posted {{count}} day ago",
        defaultValue_other: "posted {{count}} days ago",
      });
}

/** The pane's and page's Posted row: dated, re-dated (hedged) or undated — never a first-seen date. */
export function postedFactText(t: TFunction, job: Pick<ListingJob, "id" | "source" | "postedAt">, lng: string, now?: Date): string {
  const age = listingAge(job, now);
  if (age.kind === "undated") return t("listing.facts.postedUndated", "The employer's system states no posting date");
  const date = formatListingDate(age.day, lng);
  if (age.kind === "dated") return t("listing.facts.postedDated", { defaultValue: "{{date}}, as the employer's system states it", date });
  const system = systemLabel(listingSource(job));
  return system
    ? t("listing.facts.postedRedated", { defaultValue: "Feed date {{date}}; {{system}} can move this date when a posting is edited, so it may be older", date, system })
    : t("listing.facts.postedRedatedPlain", { defaultValue: "Feed date {{date}}; this hiring system can move this date when a posting is edited, so it may be older", date });
}

/** "Apply on Acme's site" — the possessive is the shared helper's (Domino's stays Domino's). */
export function applyLabel(t: TFunction, employer: string): string {
  return employer
    ? t("listing.actions.apply", { defaultValue: "Apply on {{employerPossessive}} site", employer, employerPossessive: possessive(employer) })
    : t("listing.actions.applyPlain", "Apply on the employer's site");
}
