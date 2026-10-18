/**
 * WHAT PRO INCLUDES, AS THE PRO CARD LISTS IT: THE ONE TYPED SOURCE.
 *
 * The owner's definition (final, 2026-10-17): Pro is everything in a free
 * account, plus the writing tools (5 packages a UTC day, 60 a UTC month),
 * plus the Full Analysis at no extra charge, and scans with no daily cap.
 * The card, the limits table and the tests all read this list; nothing on
 * the page types a Pro perk anywhere else.
 *
 * MIRROR. This list stands in for PRO_PERK_ITEMS in src/config/pro-perks.ts,
 * which wave 4 owns and is rewriting. At switch-over this file becomes
 *   export { PRO_PERK_ITEMS } from "@/config/pro-perks";
 * once wave 4's list says the same things (docs/homepage-pricing/README.md,
 * "Switch-over"). Until then src/test/hp-pricing-mirrors.test.ts compares the
 * two whenever wave 4's export exists, so the card and the server cannot
 * disagree silently.
 *
 * The shape is wave 4's ProPerk: a translation key and the English text the
 * translator works from. The text carries the same {{placeholders}} the key
 * does; plan-facts.ts fills them.
 */
export interface ProPerk {
  key: string;
  text: string;
}

export const PRO_PERK_ITEMS: readonly ProPerk[] = [
  { key: "pricingPlans.pro.perks.everythingFree", text: "Everything in a free account" },
  {
    key: "pricingPlans.pro.perks.writingTools",
    text: "A tailored résumé, a cover letter and interview prep for the jobs you pick: {{perDay}} of each a day and {{perMonth}} of each a month (a package is one of each)",
  },
  { key: "pricingPlans.pro.perks.includedFullAnalysis", text: "The {{faPrice}} Full Analysis included" },
  { key: "pricingPlans.pro.perks.noScanCap", text: "No daily cap on scans" },
  { key: "pricingPlans.pro.perks.cancel", text: "Cancel online from your account, any time" },
];

/**
 * A perk that may print only while a sale gate is open. The included Full
 * Analysis is hidden until the Full Analysis itself is on sale (gate G2):
 * Pro must never promise a report nobody has yet seen delivered.
 */
export const PRO_PERK_REQUIRES: Readonly<Record<string, "fullAnalysisOnSale">> = {
  "pricingPlans.pro.perks.includedFullAnalysis": "fullAnalysisOnSale",
};

/** The perks to print, given which gates are open. */
export function visibleProPerks(gates: { fullAnalysisOnSale: boolean }): readonly ProPerk[] {
  return PRO_PERK_ITEMS.filter((p) => {
    const need = PRO_PERK_REQUIRES[p.key];
    return !need || gates[need];
  });
}
