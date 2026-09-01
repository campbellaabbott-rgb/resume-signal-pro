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
 * A NULL product_type is ACCEPTED. Rows claimed before 20260827180000 have no
 * product recorded, and a real buyer's row is reused on every refresh — so
 * rejecting NULL would 402 people who paid. The gate therefore closes for every
 * session claimed from now on and stays open for ones already banked.
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
    .select("session_id, product_type")
    .eq("session_id", sessionId)
    .maybeSingle();
  // Fail closed: a real buyer's session is always present (verify claimed it
  // before the stream), so a missing row means unpaid, and a transient lookup
  // error is safer to reject-and-retry than to hand out premium content free.
  if (error) return "We couldn't verify your purchase just now — please refresh to try again.";
  if (!data) return "We couldn't confirm a completed purchase for this session.";
  const bought = (data as { product_type?: string | null }).product_type ?? null;
  if (allowed && allowed.length > 0 && bought !== null && !allowed.includes(bought)) {
    return "That purchase does not include this tool.";
  }
  return null;
}
