/**
 * WHAT AN AFFILIATE IS PAID, AS THE SERVER PAYS IT (register L13-63).
 *
 * The affiliate page promised "20% of every sale" while stripe-webhook and
 * verify-product-purchase both credit a FLAT amount: $1 when the sale is one
 * of the smaller tools below, $5 for every other sale. The owner's decision
 * (2026-10-07) was to make the copy say what the server pays, not to change
 * the payouts. These values mirror the two server lists and
 * src/test/an-affiliate-is-promised-what-the-server-pays.test.tsx holds them
 * equal, so the copy cannot drift from the payout again.
 */
export const AFFILIATE_COMMISSION_CENTS = {
  /** A sale of one of SMALL_TOOL_PRODUCT_TYPES. */
  smallTool: 100,
  /** Every other referred sale. */
  other: 500,
} as const;

/** The product types the server credits at the small-tool rate. */
export const SMALL_TOOL_PRODUCT_TYPES = [
  "basic_keyword_fix",
  "cover_letter",
  "scan_pack",
  "scan_credits",
  "career_bundle",
  "interview_coach",
  "career_path_simulator",
  "apply_assistant",
] as const;

/** The dashboard's payout minimum, in cents (affiliate-payout-request holds the same number). */
export const AFFILIATE_MIN_PAYOUT_CENTS = 2500;

export const formatUsd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
