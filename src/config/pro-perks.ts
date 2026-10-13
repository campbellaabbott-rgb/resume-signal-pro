// WHAT THE $45 PRO PLAN INCLUDES, as the Pro card lists it.
//
// THE PRODUCT LINE OF 2026-10-12 (owner decisions): Pro is "everything in a
// free account, plus the writing tools". Saved searches, alerts and the
// tracker stay free, so they are not sold here as Pro's. The writing tools
// (a tailored résumé, a cover letter and interview prep for one job, a
// "package") are counted per account on the server: Pro 5 packages a day
// and 60 a month. The one-off products Pro still includes are the ones still
// sold: the $5 Full Analysis (create-checkout mints it for a member) and the
// two Freelance tiers (create-product-checkout mints them). The cut products
// are gone from this list, and so is "every paid tool ... and all future
// tools", which promised what the catalogue no longer sells.
//
// Every line is a shipped, factual capability OF THIS PLAN. Each carries its
// own translation key (the card renders t(key, text)); the English text is
// the default the translator works from. Guards that read this list:
// src/test/pricing-truth.test.ts (no line names what only the retired agent
// price unlocked), src/test/every-paid-tool-a-pro-perk-includes-is-free-to-a-pro-member.test.ts
// (every product a line includes is free to a member at checkout), and
// src/test/w4b-the-pro-card-says-what-pro-is-in-the-readers-language.test.tsx.

export interface ProPerk {
  key: string;
  text: string;
}

export const PRO_PERK_ITEMS: readonly ProPerk[] = [
  { key: "proPlan.perks.everythingFree", text: "Everything in a free account, plus the writing tools" },
  { key: "proPlan.perks.writingTools", text: "A tailored résumé, cover letter and interview prep for your jobs: up to 5 sets a day and 60 a month" },
  { key: "proPlan.perks.batchPrep", text: "Batch application prep: answers drafted for every saved job at once (you always press send yourself)" },
  { key: "proPlan.perks.includedOneOffs", text: "The $5 Full Analysis, Freelance Boost and Transition Pro included" },
  { key: "proPlan.perks.unlimitedScans", text: "Unlimited scans, and every application tracked against the résumé version you sent" },
  { key: "proPlan.perks.cancel", text: "Cancel anytime from your account" },
];

/** The English lines, for the guards that read the list as text. */
export const PRO_PERKS: readonly string[] = PRO_PERK_ITEMS.map((p) => p.text);

/**
 * The one-off products a line above includes, by the page's ProductId: what
 * a member's checkout must mint free instead of charging for.
 */
export const PRO_INCLUDED_PRODUCT_IDS = ["fullAnalysis", "freelanceBoost", "freelanceTransitionPro"] as const;
