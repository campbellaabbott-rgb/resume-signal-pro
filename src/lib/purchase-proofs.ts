/**
 * WHERE THIS BROWSER KEEPS PROOF OF A PURCHASE (the storage keys only).
 *
 * Their writers (use-scan-credits, FreelanceBoost) and the deliberate
 * sign-out that removes them (AuthContext.PERSONAL_LOCAL_KEYS) import them
 * from here, so the key a sign-out clears is the key a purchase wrote. On a
 * shared computer a leftover proof lets the next person see the previous
 * buyer's address beside their credits and spend them (review of R1,
 * 2026-10-12).
 */

/** The Stripe session ids of credit purchases made in this browser (use-scan-credits). */
export const CREDIT_SESSIONS_KEY = "scanCreditsSessions";

/** "This browser bought a Freelance Boost": hides the buy buttons (FreelanceBoost). */
export const FREELANCE_PURCHASE_KEY = "freelanceBoostPurchase";
