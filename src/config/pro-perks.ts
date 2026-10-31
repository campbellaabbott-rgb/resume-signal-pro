// WHAT THE $45 PRO PLAN INCLUDES, as every page that lists it says it.
//
// OWNER DECISION 2026-10-17: Pro is the writing tools (5 packages a day and
// 60 a month), the $5 Full Analysis included, and no daily cap on scans.
// Freelance Boost and Transition Pro are not part of it (they are no longer
// sold). The list lives in supabase/functions/_shared/pro-perks.ts, which
// create-subscription-checkout also reads for the description Stripe shows,
// so the page and the server read one list and cannot disagree.
//
// Each line carries its own translation key (pages render t(key, text)).
// Guards that read this list: src/test/pricing-truth.test.ts,
// src/test/every-paid-tool-a-pro-perk-includes-is-free-to-a-pro-member.test.ts
// and src/test/w4b-pro-is-the-writing-tools-the-full-analysis-and-no-daily-scan-cap.test.ts.

import { PRO_PERK_ITEMS, PRO_SUMMARY, type ProPerk } from "../../supabase/functions/_shared/pro-perks";
import { FULL_ANALYSIS_ON_SALE } from "@/config/sales-gate";

export {
  PRO_INCLUDED_PRODUCT_IDS,
  PRO_PERK_ITEMS,
  PRO_SUMMARY,
  proIncludes,
  proStripeDescription,
  type ProPerk,
} from "../../supabase/functions/_shared/pro-perks";

/** The English lines, for the guards that read the list as text. */
export const PRO_PERKS: readonly string[] = PRO_PERK_ITEMS.map((p) => p.text);

/**
 * WHILE THE FULL ANALYSIS IS NOT ON SALE (gate G2, src/config/sales-gate.ts),
 * a page that lists Pro leaves the included Full Analysis out: no real
 * purchase has been watched to its delivered report, so Pro must not promise
 * one. The pricing card does the same (visibleProPerks). The server's own
 * list and Stripe's description are unchanged: this is what a page says.
 */
export const PRO_INCLUDED_ANALYSIS_KEY = "proPlan.perks.fullAnalysisIncluded";

/** Pro's summary without the included Full Analysis, for while G2 is closed. */
export const PRO_SUMMARY_WITHOUT_ANALYSIS: ProPerk = {
  key: "proPlan.summaryLineWithoutAnalysis",
  text: "Everything in a free account, plus the writing tools and no daily cap on scans",
};

/** The perks a page may list today. */
export function proPerksOnSale(items: readonly ProPerk[] = PRO_PERK_ITEMS, analysisOnSale: boolean = FULL_ANALYSIS_ON_SALE): readonly ProPerk[] {
  return analysisOnSale ? items : items.filter((p) => p.key !== PRO_INCLUDED_ANALYSIS_KEY);
}

/** The summary a page may print today. */
export function proSummaryOnSale(analysisOnSale: boolean = FULL_ANALYSIS_ON_SALE): ProPerk {
  return analysisOnSale ? PRO_SUMMARY : PRO_SUMMARY_WITHOUT_ANALYSIS;
}
