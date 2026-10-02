// THE FULL RESUME ANALYSIS: WHAT A SESSION MUST HAVE BOUGHT, AND WHETHER IT
// HAS ALREADY HAD ITS ANALYSIS.
//
// Pure, no imports: analyze-resume, stripe-webhook and retry-failed-deliveries
// share it, and the tests execute it.
//
// THE INCIDENT. From 2025-12-23 to 2026-10-01 no buyer of this product could
// receive it. analyze-resume refused any session worth under a $20 floor that
// dated from the week the analysis cost $25; the price moved to $5 and the
// floor did not, so every full-price purchase in all thirty currencies was a
// 402. Behind that, stripe-webhook claimed the session before looking at the
// product and then had nothing to deliver, so the success page's call met the
// claim and got 409; and analyze-resume wrote its own claim BEFORE the AI ran,
// so one gateway failure made every retry a 409 too.
//
// WHAT REPLACED THE FLOOR. Not a corrected number: the floor needed a second
// table of exchange rates kept in step with create-checkout's by hand, and
// that drift was the defect. A session is judged by the product type
// create-checkout wrote into its metadata -- the way _shared/paid-session.ts
// judges every other paid product, and the way the pass is known by its name
// and never its price. Stripe metadata is written server-side with our key, so
// it is not a claim the buyer can make. A promotion code lowering the total is
// a price the shop agreed to.

/** The product type create-checkout writes into session metadata. */
export const FULL_ANALYSIS_PRODUCT_TYPE = "full_analysis";
export const FULL_ANALYSIS_PRODUCT_NAME = "Full Resume Analysis";

type SessionLike = {
  payment_status?: string | null;
  metadata?: Record<string, string | null | undefined> | null;
} | null | undefined;

/** null when the session is a paid full analysis; otherwise why it is not. */
export function fullAnalysisRefusal(session: SessionLike): string | null {
  if (!session) return "no session";
  if (session.payment_status !== "paid") return `payment_status is ${session.payment_status ?? "missing"}`;
  const bought = session.metadata?.product_type ?? null;
  if (bought !== FULL_ANALYSIS_PRODUCT_TYPE) {
    return `the session bought ${bought ?? "a product it does not name"}, not the full analysis`;
  }
  return null;
}

/**
 * HAS THIS SESSION ALREADY HAD ITS ANALYSIS -- decided from the two rows that
 * can say so, read before any AI spend.
 *
 * `delivered` is the session's purchased_content row. analyze-resume writes it
 * with a plain INSERT on the table's UNIQUE stripe_session_id, at the moment
 * an analysis exists, holding a pointer ({ shareId }) to the stored analysis
 * rather than the analysis itself, so the success page's delete button still
 * removes the only copy. That insert is the redemption: whoever wins it is the
 * one analysis this session gets, and a second request is handed the same one.
 *
 * `claim` is the session's used_stripe_sessions row. It is NOT a redemption:
 * the webhook and verify-product-purchase write it on payment, before anything
 * is delivered. A claim recorded for this product therefore means "paid, not
 * yet analysed". A claim with NO product is the pre-fix analyze-resume's own
 * mark (it wrote none) or a claim from before products were recorded; it
 * cannot be told apart from a delivered analysis, so it is refused rather than
 * risk a second one. A claim for another product cannot belong to a full
 * analysis session and is refused.
 */
export type PriorRedemption =
  | { state: "none" }
  | { state: "delivered"; shareId: string | null }
  | { state: "refused"; reason: string };

export function priorRedemptionOf(
  delivered: { product_type?: string | null; generated_content?: unknown } | null | undefined,
  claim: { product_type?: string | null } | null | undefined,
): PriorRedemption {
  if (delivered) {
    if (delivered.product_type !== FULL_ANALYSIS_PRODUCT_TYPE) {
      return { state: "refused", reason: `content already delivered for ${delivered.product_type ?? "an unnamed product"}` };
    }
    const pointer = delivered.generated_content as { shareId?: unknown } | null | undefined;
    return { state: "delivered", shareId: typeof pointer?.shareId === "string" ? pointer.shareId : null };
  }
  if (claim) {
    const claimed = claim.product_type ?? null;
    if (claimed === FULL_ANALYSIS_PRODUCT_TYPE) return { state: "none" };
    return {
      state: "refused",
      reason: claimed === null
        ? "claimed with no product recorded (redeemed before 2026-10-01, or claimed before products were recorded)"
        : `claimed for ${claimed}`,
    };
  }
  return { state: "none" };
}
