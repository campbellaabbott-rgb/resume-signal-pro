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

/**
 * WHICH SALES EARN AT ALL. Every checkout now carries the referral code
 * (wave 3: five of six used to drop it, so a referred Pro or Full Analysis
 * sale was invisible), but only create-product-checkout's catalogue is
 * commissioned: the Full Resume Analysis (create-checkout), scan credit
 * top-ups (create-scan-pack-checkout), Pro, Morning Queue and the Agent Pass
 * mark the referral "none" and the conversion is recorded at $0, attributed
 * and unpaid (supabase/functions/_shared/checkout-policy.ts). The copy names
 * the commissioned products and those exclusions; the affiliate test holds
 * this list equal to that checkout's catalogue, the checkouts that carry the
 * code to REFERRAL_CHECKOUTS and the ones that pay on it to
 * COMMISSIONED_CHECKOUTS. To pay on another product is an owner decision:
 * move its checkout into COMMISSIONED_CHECKOUTS, pass commissioned: true, and
 * change the copy in the same commit.
 */
export const COMMISSIONED_PRODUCT_TYPES = {
  /** Named in the copy, paid at AFFILIATE_COMMISSION_CENTS.other. */
  other: ["premium_package", "ats_defense", "career_snapshot", "graduate_gameplan", "freelance_boost", "freelance_transition_pro"],
  /** The smaller tools the copy lists, paid at AFFILIATE_COMMISSION_CENTS.smallTool. */
  smallTool: ["basic_keyword_fix", "cover_letter", "scan_pack", "interview_coach", "career_path_simulator", "apply_assistant"],
} as const;

/** The checkout functions whose Stripe sessions carry referral_code: all six that mint a live session. */
export const REFERRAL_CHECKOUTS = [
  "create-agent-checkout",
  "create-checkout",
  "create-pass-checkout",
  "create-product-checkout",
  "create-scan-pack-checkout",
  "create-subscription-checkout",
] as const;

/** The checkouts whose referred sales pay a commission; every other one records the referral at $0. */
export const COMMISSIONED_CHECKOUTS = ["create-product-checkout"] as const;

/** The dashboard's payout minimum, in cents (affiliate-payout-request holds the same number). */
export const AFFILIATE_MIN_PAYOUT_CENTS = 2500;

export const formatUsd = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
