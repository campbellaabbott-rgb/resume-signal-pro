// WHAT THE $45 PRO PLAN IS: ONE LIST FOR THE PAGES AND THE SERVER (owner
// decision 2026-10-17).
//
// Pro is the writing tools (a tailored résumé, a cover letter and interview
// prep for one job, a "package": 5 a day and 60 a month, counted per account
// on the server), the $5 Full Analysis included, and no daily cap on scans.
// Freelance Boost and Transition Pro are not part of Pro: they are no longer
// sold (product-cuts.ts). Saved searches, alerts and the tracker are free, so
// they are not sold here as Pro's.
//
// Every page that lists Pro's perks reads PRO_PERK_ITEMS (src/config/
// pro-perks.ts re-exports this file), and create-subscription-checkout builds
// the description Stripe's page and receipts carry from the same items
// (proStripeDescription), so the page and the server cannot disagree. Each
// line carries its own translation key; the English text is the default the
// translator works from. A line whose words change gets a NEW key, because an
// existing locale value is never edited.
//
// NO IMPORTS: the frontend and vitest import this file directly.

export interface ProPerk {
  key: string;
  text: string;
}

/** The plan in one sentence, for the places that summarise it. */
export const PRO_SUMMARY: ProPerk = {
  key: "proPlan.summaryLine",
  text: "Everything in a free account, plus the writing tools, the $5 Full Analysis included and no daily cap on scans",
};

export const PRO_PERK_ITEMS: readonly ProPerk[] = Object.freeze([
  { key: "proPlan.perks.everythingFree", text: "Everything in a free account, plus the writing tools" },
  { key: "proPlan.perks.writingTools", text: "A tailored résumé, cover letter and interview prep for your jobs: up to 5 sets a day and 60 a month" },
  { key: "proPlan.perks.fullAnalysisIncluded", text: "The $5 Full Analysis included" },
  { key: "proPlan.perks.noDailyScanCap", text: "No daily cap on scans" },
  { key: "proPlan.perks.cancel", text: "Cancel anytime from your account" },
]);

/**
 * The one-off products the plan includes, by the page's ProductId: what a
 * member's checkout mints free instead of charging for. Only the Full
 * Analysis (create-checkout mints it); create-product-checkout mints nothing
 * else.
 */
export const PRO_INCLUDED_PRODUCT_IDS: readonly string[] = Object.freeze(["fullAnalysis"]);

/** True when a member's checkout mints this product free. */
export function proIncludes(productId: unknown): boolean {
  return typeof productId === "string" && PRO_INCLUDED_PRODUCT_IDS.includes(productId);
}

/**
 * What Stripe's page and receipts say Pro is: the items above, in order, as
 * sentences. Stripe caps a product description well above this length.
 */
export function proStripeDescription(items: readonly ProPerk[] = PRO_PERK_ITEMS): string {
  return items.map((p) => p.text.replace(/[.\s]+$/, "")).join(". ") + ".";
}
