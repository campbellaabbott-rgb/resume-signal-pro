/**
 * THE EU/UK SWITCH, BROWSER SIDE (owner decision 3, 2026-10-08).
 *
 * Off unless the build sets VITE_EU_UK_SALES to exactly "on", and it stays off
 * until the owner has registered for VAT. The server reads its own switch,
 * EU_UK_SALES (supabase/functions/_shared/checkout-policy.ts); both are turned
 * on together. While off, no buy button shows a box and nothing is sent.
 *
 * With it on, a one-time digital product asks the buyer to request delivery
 * now and to acknowledge that the right to withdraw ends with it (Directive
 * 2011/83/EU art. 16(m)), and a plan asks that the service start inside the
 * withdrawal period (art. 7(3)). The server refuses a checkout without the box
 * ticked and records the wording's version on the Stripe session.
 */
export const EU_UK_SALES_ON = import.meta.env.VITE_EU_UK_SALES === "on";

/** The checkbox wording's version; checkout-policy.ts WITHDRAWAL_WAIVER_VERSION holds the same string. */
export const WITHDRAWAL_WAIVER_VERSION = "2026-10-09";

/** The statutory withdrawal period, in days, as the checkbox states it. */
export const WITHDRAWAL_DAYS = 14;
