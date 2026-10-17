/**
 * WHAT AN AFFILIATE IS PAID, AS THE SERVER PAYS IT (register L13-63; the
 * affiliate re-base of the product line, owner decision 2026-10-12).
 *
 * The old flat rates ($1 on the smaller tools, $5 on the rest) paid on a
 * one-off catalogue the product line cut. An affiliate now earns one flat
 * amount: AFFILIATE_PRO_FIRST_MONTH_CENTS when a referred customer pays for
 * their first month of Pro. Every other referred purchase is recorded at $0.
 * Commissions already earned stay earned and are paid as before.
 *
 * These values mirror supabase/functions/_shared/affiliate-commission.ts, the
 * rule the server pays by, and src/test/w4b-an-affiliate-earns-a-flat-amount-
 * on-a-first-paid-pro-month.test.ts holds the two equal, so the copy cannot
 * drift from the payout again.
 */
export const AFFILIATE_PRO_FIRST_MONTH_CENTS = 1000;

/** The checkout functions whose Stripe sessions carry referral_code (every one that can mint a live session). */
export const REFERRAL_CHECKOUTS = [
  "create-agent-checkout",
  "create-checkout",
  "create-pass-checkout",
  "create-product-checkout",
  "create-scan-pack-checkout",
  "create-subscription-checkout",
] as const;

/** The one checkout whose referred sale pays a commission: Pro's first paid month. */
export const COMMISSIONED_CHECKOUTS = ["create-subscription-checkout"] as const;

/** The dashboard's payout minimum, in cents (affiliate-payout-request holds the same number). */
export const AFFILIATE_MIN_PAYOUT_CENTS = 2500;

export const formatUsd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
