/**
 * A PURCHASE STRIPE DOES NOT HAVE, OR A STRIPE THAT DID NOT ANSWER (S13-048,
 * the fixer's review).
 *
 * verify-product-purchase answered its "we couldn't find that purchase" 400
 * for ANY throw from stripe.checkout.sessions.retrieve: a rate limit, a
 * timeout or a Stripe 5xx on a real paid session included. The success page
 * reads that 400 as "this link names no purchase", offers no Try again and
 * tells a buyer who has just paid that the link may be cut short or expired.
 *
 * Now only Stripe's own "no such session" (code resource_missing, or a 404)
 * is that answer; every other failure is a 503 the page offers to try again.
 *
 * Import-free, so the Node tests import it.
 */
export const PURCHASE_NOT_FOUND_MESSAGE = "We couldn't find that purchase. If you just paid, wait a moment and refresh; otherwise the link may have expired.";
export const STRIPE_UNREACHABLE_MESSAGE = "We couldn't reach the payment provider just now. Your purchase is safe: wait a moment and try again.";

/** Whether a thrown retrieve error is Stripe saying the session does not exist. */
export function stripeSaysNoSuchSession(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; statusCode?: unknown; raw?: { code?: unknown; statusCode?: unknown } };
  return err.code === "resource_missing" || err.statusCode === 404 || err.raw?.code === "resource_missing" || err.raw?.statusCode === 404;
}

/** The status and body a failed retrieve answers. */
export function retrieveFailureAnswer(e: unknown): { status: 400 | 503; body: { error: string; retryable?: true } } {
  return stripeSaysNoSuchSession(e)
    ? { status: 400, body: { error: PURCHASE_NOT_FOUND_MESSAGE } }
    : { status: 503, body: { error: STRIPE_UNREACHABLE_MESSAGE, retryable: true } };
}
