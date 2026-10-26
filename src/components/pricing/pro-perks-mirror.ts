/**
 * WHAT PRO INCLUDES, AS THE PRO CARD LISTS IT: WAVE 4'S ONE LIST.
 *
 * The owner's definition (final, 2026-10-17): Pro is everything in a free
 * account, plus the writing tools (5 packages a UTC day, 60 a UTC month),
 * plus the Full Analysis at no extra charge, and scans with no daily cap.
 * The list is PRO_PERK_ITEMS in supabase/functions/_shared/pro-perks.ts
 * (re-exported by src/config/pro-perks.ts), the list every page that sells
 * Pro and create-subscription-checkout's Stripe description read, so the
 * card and the server cannot disagree (switch-over step 6). Each item carries
 * its translation key (proPlan.perks.*, translated in the main locales) and
 * the English text the translator works from; the card renders
 * t(key, { defaultValue: text }).
 */
export { PRO_PERK_ITEMS, type ProPerk } from "@/config/pro-perks";
import { PRO_PERK_ITEMS, type ProPerk } from "@/config/pro-perks";

/**
 * The included Full Analysis line, by wave 4's key
 * ("proPlan.perks.fullAnalysisIncluded", the list above) and by the key the
 * card's own list used before switch-over step 6. Keyed on both, the G2 rule
 * hides the line whichever list a caller passes.
 */
export const INCLUDED_FULL_ANALYSIS_KEYS = ["pricingPlans.pro.perks.includedFullAnalysis", "proPlan.perks.fullAnalysisIncluded"] as const;

/**
 * A perk that may print only while a sale gate is open. The included Full
 * Analysis is hidden until the Full Analysis itself is on sale (gate G2):
 * Pro must never promise a report nobody has yet seen delivered.
 */
export const PRO_PERK_REQUIRES: Readonly<Record<string, "fullAnalysisOnSale">> = Object.fromEntries(
  INCLUDED_FULL_ANALYSIS_KEYS.map((k) => [k, "fullAnalysisOnSale" as const]),
);

/** The perks to print, given which gates are open. */
export function visibleProPerks(gates: { fullAnalysisOnSale: boolean }, items: readonly ProPerk[] = PRO_PERK_ITEMS): readonly ProPerk[] {
  return items.filter((p) => {
    const need = PRO_PERK_REQUIRES[p.key];
    return !need || gates[need];
  });
}
