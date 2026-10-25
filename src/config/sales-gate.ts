/**
 * WHAT IS ON SALE, BEYOND THE SELLER'S NAME (homepage and pricing spec of
 * 2026-10-17, section 1: gates G2, G2b and G6; owner decision 4).
 *
 * src/config/seller.ts is gate G1: no buy control renders until the seller's
 * legal name and postal address are published there (purchasesOpen()). Wave
 * 4's checkouts (create-checkout, create-subscription-checkout) refuse with
 * seller_identity_missing until then, and read none of the switches below:
 * these are the owner's further gates on what the PAGES offer. Each one is
 * flipped by hand, by the owner, after the thing it names has been watched;
 * nothing in the code flips them.
 *
 *   FULL_ANALYSIS_ON_SALE  G2: one real Full Analysis purchase was watched
 *     from payment to the delivered report, and the failed-delivery alarm was
 *     seen to fire on a forced failure. Neither has happened, so false.
 *   PRO_ON_SALE  G2b: one watched Pro subscription (subscribe, generate one
 *     package, cancel in the portal, Pro still on until the period ends).
 *     Not done, so false.
 *   DIGEST_MAIL_CLASS  G6: the owner's or counsel's ruling on the saved-search
 *     digest's mail class. There is no ruling yet, so "unruled". The code is
 *     not a ruling: seller.ts lists the digest among the marketing mails for
 *     its footer, marketing-pause.ts counts saved-search alerts as
 *     transactional, and send-search-digest does not wait for the seller's
 *     name. Until a ruling, the new homepage and pricing page say "saved
 *     searches" without "alerts" unless the seller is named.
 *
 * Readers: the scanner's Full Analysis link and button (G1 and G2, in
 * ResumeUploader), and from the homepage switch-over
 * (docs/homepage-pricing/README.md, step 5) the new homepage's plan strip and
 * the pricing page's cards, through SALE_SWITCHES. Buy controls elsewhere
 * (the scan report, the comparison table, the sticky bar, the Pro card) still
 * read purchasesOpen() alone.
 */

/** The saved-search digest's mail class, as ruled (G6). */
export type DigestMailClass = "transactional" | "marketing" | "unruled";

/** G2: the Full Analysis delivered to a watched real purchase, and the failed-delivery alarm fired on a forced failure. */
export const FULL_ANALYSIS_ON_SALE: boolean = false;

/** G2b: one watched Pro subscription, from checkout to cancellation. */
export const PRO_ON_SALE: boolean = false;

/** G6: the ruling on the saved-search digest's mail class. */
export const DIGEST_MAIL_CLASS: DigestMailClass = "unruled";
