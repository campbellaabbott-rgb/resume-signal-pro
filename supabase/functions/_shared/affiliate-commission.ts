// WHAT AN AFFILIATE EARNS ON ONE REFERRED CHECKOUT (owner decision
// 2026-10-12, the product line: the affiliate programme is re-based).
//
// The one-off catalogue the old flat rates paid on ($1 on the smaller tools,
// $5 on the rest) was cut to the Full Analysis and the two Freelance tiers.
// An affiliate now earns ONE flat amount: PRO_FIRST_MONTH_COMMISSION_CENTS
// on a referred customer's first paid Pro month, which is the Pro checkout
// itself (Pro sells no trial, so the session that completes is the first
// month paid). Every other referred checkout is recorded at $0: attributed,
// not paid. Commissions already earned stay earned and are paid as before
// (affiliate-payout-request, send-affiliate-commission-email).
//
// HOW A SESSION SAYS WHAT IT EARNS. checkout-policy.ts policyMetadata writes
// `referral_commission: "none"` on every referred session. Pro's checkout
// passes its metadata through withReferralCommission, which turns that into
// "pro_first_month" and NAMES the amount (`referral_commission_cents`,
// PRO_FIRST_MONTH_COMMISSION_CENTS); every other checkout leaves "none". stripe-webhook and verify-product-purchase pay
// "none" nothing and a named amount exactly (wave 4 round 2,
// payments-delivery). A session minted BEFORE this rule shipped carries no
// marker for the one-off catalogue (the old create-product-checkout passed
// `commissioned: true`, which wrote nothing); it is paid by the rule it was
// sold under (LEGACY_*), so a checkout open across the deploy is not cut.
// Stripe sessions expire within a day, so that branch empties itself.
//
// commissionCentsFor is that rule as one function. src/config/
// affiliate-commission.ts mirrors these numbers for the affiliate page, and
// src/test/w4b-an-affiliate-earns-a-flat-amount-on-a-first-paid-pro-month.test.tsx
// holds the two equal.
//
// NO IMPORTS: vitest imports this file directly.

/** The flat commission on a referred customer's first paid Pro month, in cents. */
export const PRO_FIRST_MONTH_COMMISSION_CENTS = 1000;

/** The product type the Pro checkout stamps on its session (create-subscription-checkout metadata). */
export const PRO_PRODUCT_TYPE = "pro_subscription";

/** The marker Pro's checkout writes (withReferralCommission). */
export const PRO_FIRST_MONTH_MARKER = "pro_first_month";

/** The rules a checkout can stamp on a referred session. */
export type ReferralCommission = "none" | typeof PRO_FIRST_MONTH_MARKER;

/**
 * A checkout's metadata with the commission rule it sells under. A session
 * with no referral code is returned as it was (nothing to pay or record).
 * A referred one is stamped with the rule's name, and the first-month rule
 * also names its amount; "none" never names one, whatever came in.
 */
export function withReferralCommission<T extends Record<string, string>>(
  metadata: T,
  rule: ReferralCommission,
): T & { referral_commission?: string; referral_commission_cents?: string } {
  if (!metadata.referral_code) return metadata;
  const { referral_commission_cents: _dropped, ...rest } = metadata;
  return {
    ...rest,
    referral_commission: rule,
    ...(rule === PRO_FIRST_MONTH_MARKER ? { referral_commission_cents: String(PRO_FIRST_MONTH_COMMISSION_CENTS) } : {}),
  } as unknown as T & { referral_commission?: string; referral_commission_cents?: string };
}

/** The old rule, for sessions minted before this file shipped: the smaller tools. */
export const LEGACY_SMALL_TOOL_PRODUCT_TYPES: readonly string[] = Object.freeze([
  "basic_keyword_fix", "cover_letter", "scan_pack", "scan_credits", "career_bundle",
  "interview_coach", "career_path_simulator", "apply_assistant",
]);
export const LEGACY_SMALL_TOOL_CENTS = 100;
export const LEGACY_OTHER_CENTS = 500;

/** The one-off products the old catalogue paid on (create-product-checkout's rows). */
const LEGACY_COMMISSIONED_TYPES: ReadonlySet<string> = new Set([
  ...LEGACY_SMALL_TOOL_PRODUCT_TYPES,
  "premium_package", "ats_defense", "career_snapshot", "graduate_gameplan",
  "freelance_boost", "freelance_transition_pro",
]);

export type CommissionMetadata = {
  referral_commission?: string | null;
  referral_commission_cents?: string | null;
  product_type?: string | null;
} | null | undefined;

/** A named amount as the payers read it: 1 to 5 digits, at most $100; null otherwise. */
export function namedCommissionCents(raw: unknown): number | null {
  return typeof raw === "string" && /^\d{1,5}$/.test(raw) && Number(raw) <= 10_000 ? Number(raw) : null;
}

/**
 * The commission for one referred, paid checkout session, in cents, from the
 * session's metadata. 0 means "record the referral, pay nothing".
 */
export function commissionCentsFor(metadata: CommissionMetadata): number {
  const marker = String(metadata?.referral_commission ?? "");
  const productType = String(metadata?.product_type ?? "");
  if (marker === "none") return 0;
  const named = namedCommissionCents(metadata?.referral_commission_cents);
  if (named !== null) return named;
  if (marker !== "") return 0;
  // No marker: a one-off session sold under the old rule.
  if (!LEGACY_COMMISSIONED_TYPES.has(productType)) return 0;
  return LEGACY_SMALL_TOOL_PRODUCT_TYPES.includes(productType) ? LEGACY_SMALL_TOOL_CENTS : LEGACY_OTHER_CENTS;
}
