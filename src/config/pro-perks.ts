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

import { PRO_PERK_ITEMS } from "../../supabase/functions/_shared/pro-perks";

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
