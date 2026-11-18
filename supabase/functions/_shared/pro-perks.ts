// WHAT THE $45 PRO PLAN IS: ONE LIST FOR THE PAGES AND THE SERVER (owner
// decision 2026-10-17).
//
// Pro is the writing tools (a tailored résumé, a cover letter and interview
// prep for one job, a "package": 5 a day and 60 a month, counted per account
// on the server, writing-allowance.ts proPackagesPerDay/proPackagesPerMonth),
// the $5 Full Analysis included, and no daily cap on scans. The noun is
// "package" everywhere Pro is described (owner decision, homepage switch-over
// 2026-10-26): the pages, this list and so Stripe's description.
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
  key: "payments.perks.summaryPackages",
  text: "Everything in a free account, plus 5 writing packages a day (60 a month) on a stronger model, the $5 Full Analysis included and no daily cap on scans",
};

/** The included grants a member may mint (pro_grants_cap, 20261112111000; S14X-079). */
export const PRO_GRANTS_PER_DAY = 10;
export const PRO_GRANTS_PER_MONTH = 60;

export const PRO_PERK_ITEMS: readonly ProPerk[] = Object.freeze([
  { key: "payments.perks.everythingFreeOneEach", text: "Everything in a free account, which already has one of each writing tool a day" },
  { key: "proPlan.perks.writingToolsPackages", text: "A tailored résumé, cover letter and interview prep for your jobs: up to 5 packages a day and 60 a month" },
  { key: "proPlan.perks.fullAnalysisIncluded", text: "The $5 Full Analysis included" },
  { key: "payments.perks.fullAnalysisCap", text: `Up to ${PRO_GRANTS_PER_DAY} Full Analyses a day and ${PRO_GRANTS_PER_MONTH} a month` },
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
