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
// a price the shop agreed to. The one exception is the six months when
// create-checkout wrote no product at all; those sessions are known by the
// exact shape it wrote instead (legacyFullAnalysisRefusal, below).

/** The product type create-checkout writes into session metadata. */
export const FULL_ANALYSIS_PRODUCT_TYPE = "full_analysis";
export const FULL_ANALYSIS_PRODUCT_NAME = "Full Resume Analysis";

type SessionLike = {
  payment_status?: string | null;
  metadata?: Record<string, string | null | undefined> | null;
  total_details?: { amount_discount?: number | null } | null;
} | null | undefined;

/**
 * THE SAME PRODUCT, SOLD BEFORE ITS NAME WAS WRITTEN DOWN.
 *
 * create-checkout began writing product_type on 2026-06-30 (6bdda09f). From
 * the $5 price cut on 2025-12-23 (33e3e3c5) until then, every session it
 * minted carried exactly three metadata keys and nothing else -- resumeData
 * (which Stripe drops when it is empty), originalCurrency and baseAmountUSD
 * "5". Those buyers paid for this analysis and, behind the floor, never
 * received it; judged by product name alone they were refused a second time.
 *
 * The shape that admits them, and why it admits nothing else:
 *
 *   - NO product_type, and NO key outside those three. Every checkout that
 *     mints a session today writes product_type, and each also writes keys
 *     of its own (product_name, customer_email, credits, test_mode, ...).
 *   - baseAmountUSD is exactly "5". No function but create-checkout has ever
 *     written that key (the whole history, every branch); "25" is the week
 *     before the cut, whose sessions the old floor DID admit.
 *   - NO promotion-code discount. Across every analyze-resume from 2025-12-21
 *     to the fix, the floor was $20, it let a discounted session through, it
 *     ran before the claim was written, and the nearest any legacy $5 charge
 *     came to it was a quarter (usd 500 against 2000; every currency in every
 *     create-checkout table of the window was replayed). So an undiscounted
 *     legacy session was never analysed -- provably -- while a discounted
 *     one may have been, and the only trace of that is a used_stripe_sessions
 *     row the codebase treats as thirty-day (cleanup_expired_stripe_sessions).
 *     Admitting it could hand one purchase a second analysis.
 *
 * A session that passes is then redeemed exactly like a named one: once, by
 * the purchased_content insert, and its claim is written naming this product.
 */
export const LEGACY_FULL_ANALYSIS_METADATA_KEYS: readonly string[] = ["resumeData", "originalCurrency", "baseAmountUSD"];
/** The base price create-checkout recorded on every session of the window. Frozen: it describes sessions already sold. */
export const LEGACY_FULL_ANALYSIS_BASE_USD = "5";

/** null when the session carries create-checkout's pre-product-type $5 shape; otherwise why it does not. */
export function legacyFullAnalysisRefusal(session: SessionLike): string | null {
  if (!session) return "no session";
  const metadata = session.metadata ?? {};
  const stray = Object.keys(metadata).filter((k) => !LEGACY_FULL_ANALYSIS_METADATA_KEYS.includes(k));
  if (stray.length > 0) return `it carries ${stray.join(", ")}, which create-checkout never wrote`;
  if (metadata.baseAmountUSD !== LEGACY_FULL_ANALYSIS_BASE_USD) {
    return `its baseAmountUSD is ${metadata.baseAmountUSD ?? "absent"}, not the ${LEGACY_FULL_ANALYSIS_BASE_USD} create-checkout recorded from 2025-12-23 to 2026-06-30`;
  }
  if (!metadata.originalCurrency) return "it records no originalCurrency";
  if ((session.total_details?.amount_discount ?? 0) > 0) {
    return "a promotion code was applied, which the pre-fix floor admitted -- it may already have had its analysis";
  }
  return null;
}

/** null when the session is a paid full analysis; otherwise why it is not. */
export function fullAnalysisRefusal(session: SessionLike): string | null {
  if (!session) return "no session";
  if (session.payment_status !== "paid") return `payment_status is ${session.payment_status ?? "missing"}`;
  const bought = session.metadata?.product_type ?? null;
  if (bought === FULL_ANALYSIS_PRODUCT_TYPE) return null;
  if (bought) return `the session bought ${bought}, not the full analysis`;
  const legacy = legacyFullAnalysisRefusal(session);
  return legacy === null ? null : `the session names no product, and is not create-checkout's $5 sale from before products were named: ${legacy}`;
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
 * yet analysed". A claim for another product cannot belong to a full analysis
 * session and is refused.
 *
 * A claim with NO product is told apart by WHO wrote it, which the row
 * records. Every analyze-resume since the table was created (2025-12-16)
 * wrote the caller's address beside its claim, and its address reader never
 * yields null (it falls back to 'unknown'); the webhook and
 * verify-product-purchase have never written an address at all. So:
 *   - no product, an address: the pre-fix analyze-resume's own mark, written
 *     before its AI call. It cannot be told apart from a delivered analysis,
 *     so it is refused rather than risk a second one.
 *   - no product, address null: a payment claim from a webhook (or verify)
 *     deployed before claims named their product (20260827180000). That is
 *     what a buyer meets if analyze-resume ships ahead of the webhook, and
 *     what most legacy sessions carry; it is paid-not-yet-analysed. The old
 *     analyze-resume answered 409 to any existing claim, so it never analysed
 *     a session that already had one.
 *   - address NOT READ (the key absent): refused. A caller that forgets to
 *     select the column must not turn every refusal above into an admission.
 */
export type PriorRedemption =
  | { state: "none" }
  | { state: "delivered"; shareId: string | null }
  | { state: "refused"; reason: string };

export function priorRedemptionOf(
  delivered: { product_type?: string | null; generated_content?: unknown } | null | undefined,
  claim: { product_type?: string | null; ip_address?: string | null } | null | undefined,
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
    if (claimed !== null) return { state: "refused", reason: `claimed for ${claimed}` };
    if (claim.ip_address === null) return { state: "none" };
    return {
      state: "refused",
      reason: claim.ip_address === undefined
        ? "claimed with no product recorded, and the claim was read without the address that says who wrote it"
        : "claimed with no product recorded, beside a caller address: the pre-fix analyze-resume's mark, written before its AI call",
    };
  }
  return { state: "none" };
}
