/**
 * WHAT IS ON SALE (homepage and pricing spec of 2026-10-17, section 1: gates
 * G2, G2b and G6; the owner's rule of 2026-10-27: there is no sales pause).
 *
 * Every product main sells stays on sale wherever main sells it. No buy
 * control and no checkout waits for the seller's legal name and postal
 * address (src/config/seller.ts): they print once the owner gives them, and
 * are never invented. The switches below are the owner's further say over
 * what the PAGES offer; the checkouts read none of them.
 *
 *   FULL_ANALYSIS_ON_SALE  G2: the $5 Full Analysis, on sale today on main
 *     and on live, so on.
 *   PRO_ON_SALE  G2b: Pro, on sale today on main and on live, so on.
 *   DIGEST_MAIL_CLASS  G6: the owner's or counsel's ruling on the
 *     saved-search digest's mail class. There is no ruling yet, so
 *     "unruled". send-search-digest sends whatever the seller's state, as on
 *     main, so while the digest is unruled the pages name saved-search
 *     alerts, as live does; a "marketing" ruling would also need a sender
 *     that waits for the seller before the word comes off the pages
 *     (the-sale-switches-say-what-the-owner-has-watched.test.ts).
 *
 * Readers: every buy control, through fullAnalysisOnSale() (G2) and
 * proOnSale() (G2b) in src/lib/purchases-open.ts: the uploader, the free
 * report, the sticky bar, the comparison table, the closing call to action
 * and the Pro card, which leaves the included Full
 * Analysis out of its list and summary only while G2 is off. The new
 * homepage's plan strip and the pricing page's cards read the switches
 * through SALE_SWITCHES (src/lib/home/sale-gates.ts).
 *
 * THE ORDER: PRO_ON_SALE IS ON ONLY WHILE FULL_ANALYSIS_ON_SALE IS. Pro
 * includes the Full Analysis, and Stripe's description of Pro says so
 * (_shared/pro-perks.ts proStripeDescription, read by
 * create-subscription-checkout, which cannot read these switches), while the
 * pages leave the included analysis out when G2 is off. So G2b never stays on
 * with G2 off; the-sale-switches-say-what-the-owner-has-watched.test.ts fails
 * on that state.
 */

/** The saved-search digest's mail class, as ruled (G6). */
export type DigestMailClass = "transactional" | "marketing" | "unruled";

/** G2: the $5 Full Analysis is on sale, as on main and on live. */
export const FULL_ANALYSIS_ON_SALE: boolean = true;

/** G2b: Pro is on sale, as on main and on live. */
export const PRO_ON_SALE: boolean = true;

/** G6: the ruling on the saved-search digest's mail class. */
export const DIGEST_MAIL_CLASS: DigestMailClass = "unruled";
