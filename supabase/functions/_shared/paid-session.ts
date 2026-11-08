// Purchase gate for the browser-facing paid streaming generators. These endpoints
// are public (verify_jwt=false) and stream premium content, so they must confirm
// the caller actually paid — rate limiting alone caps abuse volume but doesn't
// stop a determined caller from pulling premium output for free.
//
// Proof of payment = membership in used_stripe_sessions. Only the payment-
// validating server functions (verify-product-purchase, stripe-webhook) write
// that table, and only AFTER confirming Stripe payment_status === 'paid' (Pro
// subscribers' synthetic pro_ sessions are claimed the same way). ProductSuccess
// always awaits verify-product-purchase — which claims the session — before it
// starts the stream, and the claim is permanent, so a real buyer's session (and a
// returning buyer's, on recovery/refresh) is always present; a direct or unpaid
// caller's is not.
//
// Returns null when the session is a confirmed paid one, or a customer-facing
// error string otherwise (the caller turns a non-null result into a 402).

// Loose client type so this accepts the real SupabaseClient and stays trivially
// unit-testable with a fake. Only .from(...).select(...).eq(...).maybeSingle()
// is used; typing the whole builder chain against supabase-js is not worth it.
// deno-lint-ignore no-explicit-any
type SessionLookupClient = { from: (table: string) => any };

/**
 * The columns the gate reads. The address and the claim's date decide an
 * unnamed claim (unnamedClaimRefusal), so a lookup that left either out would
 * refuse every unnamed claim rather than guess.
 */
export const CLAIM_COLUMNS = "session_id, product_type, ip_address, used_at";

/**
 * When claims began to name their product: the column arrived with
 * 20260827180000, and verify-product-purchase and stripe-webhook have
 * recorded the product on every claim since. Frozen: it describes claims
 * already written.
 */
export const CLAIMS_NAMED_FROM = "2026-08-27T18:00:00Z";

/**
 * WHY AN UNNAMED CLAIM IS NOT A PURCHASE OF THIS TOOL, or null when it may be
 * a past buyer's (M-S14-057).
 *
 * The gate used to accept every claim with no product as a purchase of
 * everything, because rows claimed before 20260827180000 have none. That made
 * a $2 scan pack's id, a $5 Full Analysis's id, or a link a buyer forwarded a
 * key to every paid generator, the retired premium package included.
 * 20261110140000 names every unnamed claim whose product our own records
 * still hold (the order row, the delivered content, the checkout start, the
 * Pro grant). What is still unnamed after it is refused when the row itself
 * says it cannot be a purchase of a generator:
 *
 *   - a cs_test_ session: test mode, which paid nothing;
 *   - an address beside it: from the table's first day only analyze-resume
 *     (the Full Analysis), verify-scan-pack-purchase (scan packs) and
 *     generate-ats-defense (ATS Defense, which asks this gate only for a Pro
 *     grant, never for the Checkout session it claims) wrote one, each with a
 *     non-null fallback; stripe-webhook and verify-product-purchase, the
 *     writers for every product a generator sells, never did;
 *   - written on or after CLAIMS_NAMED_FROM: both writers have named the
 *     product since, so an unnamed claim from then on is a checkout that
 *     carried no product (the switched-off test checkout, a Payment Link),
 *     which no generator delivers;
 *   - an address or a date the lookup did not read: never a guess.
 *
 * Anything else is a claim from before products were named, by a writer that
 * sells generators, whose product no record we keep can say. It is accepted:
 * locking out a real buyer of an older order costs more than what is left
 * open, a set the migration counts (RAISE NOTICE and job_board_meta
 * 'paid_session_names') that no new claim can join, because a claim written
 * after CLAIMS_NAMED_FROM is refused above.
 */
export function unnamedClaimRefusal(
  sessionId: string,
  claim: { ip_address?: unknown; used_at?: unknown },
): string | null {
  if (sessionId.startsWith("cs_test_")) return "a test-mode session, which paid nothing";
  if (claim.ip_address === undefined) return "the claim was read without the address that says who wrote it";
  if (claim.ip_address !== null) return "the claim carries an address, so it was a full analysis, a scan pack or an ATS Defense";
  const at = typeof claim.used_at === "string" ? Date.parse(claim.used_at) : NaN;
  if (!Number.isFinite(at)) return "the claim's date was not read";
  if (at >= Date.parse(CLAIMS_NAMED_FROM)) return "the claim was written after claims began to name their product";
  return null;
}

/**
 * WHICH PRODUCT, not merely whether one was bought.
 *
 * This gate used to ask only whether the session id existed in
 * used_stripe_sessions — and that table had no product column, so a session
 * minted by the $2 scan pack was indistinguishable from one that bought the $59
 * package. Buy the cheapest item, keep the id from the success-page URL, and
 * every paid generator answered for as long as the row lived, which is forever:
 * the claim is permanent by design so a real buyer can refresh the page.
 *
 * `allowed` is the set of product_type values the CALLING generator actually
 * sells. Omit it and behaviour is exactly as before, which is what keeps
 * endpoints whose product mapping is not one-to-one working unchanged.
 *
 * A claim with no product_type is judged by unnamedClaimRefusal above: it is
 * accepted only when it may be a past buyer's from before products were named.
 */
export async function assertPaidSession(
  supabase: SessionLookupClient,
  sessionId: unknown,
  allowed?: readonly string[],
): Promise<string | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return "This content requires a completed purchase.";
  }
  const { data, error } = await supabase
    .from("used_stripe_sessions")
    .select(CLAIM_COLUMNS)
    .eq("session_id", sessionId)
    .maybeSingle();
  // Fail closed: a real buyer's session is always present (verify claimed it
  // before the stream), so a missing row means unpaid, and a transient lookup
  // error is safer to reject-and-retry than to hand out premium content free.
  if (error) return "We couldn't verify your purchase just now — please refresh to try again.";
  if (!data) return "We couldn't confirm a completed purchase for this session.";
  if (!allowed || allowed.length === 0) return null;
  const claim = data as { product_type?: string | null; ip_address?: unknown; used_at?: unknown };
  const bought = claim.product_type ?? null;
  if (bought === null) {
    const why = unnamedClaimRefusal(sessionId, claim);
    if (why) {
      console.warn(`[PAID-SESSION] unnamed claim refused: ${why}`);
      return "That purchase does not include this tool.";
    }
    return null;
  }
  if (!allowed.includes(bought)) return "That purchase does not include this tool.";
  return null;
}
