/**
 * WAS THIS CHECKOUT SESSION'S PAYMENT TAKEN BACK? (platform sweep L6-18)
 *
 * stripe-webhook records every refund in full and every dispute in
 * payment_revocations (payment_revoke, 20261008131000), and rewrites the
 * session's claim to the product 'refunded'. A generator that gates on the
 * claim (assertPaidSession) refuses that product. But Stripe keeps answering
 * payment_status 'paid' for a refunded session, so every function that reads
 * Stripe itself must ask here before it delivers anything:
 * verify-product-purchase, analyze-resume, generate-freelance-boost,
 * generate-ats-defense and generate-apply-package (on their cs_ path), and
 * agent-pass-status before it grants a pass from a session.
 *
 * sessionWasRefunded fails OPEN: a lookup that fails answers false, because a
 * refund is a rare correction and a database hiccup must not refuse every
 * honest buyer at the success page. paymentRevocationState says which of the
 * three it was, for a caller that must not hand out something durable (a
 * pass) on a read it could not make.
 *
 * Import-free: the Node tests import it directly.
 */

/** The product a refunded session's claim names: no generator sells it. */
export const REFUNDED_CLAIM_PRODUCT = "refunded";

/** What a buyer is told when their refunded purchase is asked for again. */
export const REFUNDED_PURCHASE_MESSAGE = "This purchase was refunded, so it can no longer be delivered.";

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

export type RevocationState = "revoked" | "clear" | "unreadable";

/** Is there a revocation receipt for this session, or for its payment intent? */
export async function paymentRevocationState(
  db: TableClient,
  ids: { sessionId?: unknown; paymentIntentId?: unknown },
): Promise<RevocationState> {
  const lookups: Array<[string, string]> = [];
  if (typeof ids.sessionId === "string" && ids.sessionId.startsWith("cs_")) lookups.push(["stripe_session_id", ids.sessionId]);
  if (typeof ids.paymentIntentId === "string" && ids.paymentIntentId.startsWith("pi_")) lookups.push(["payment_intent_id", ids.paymentIntentId]);
  for (const [column, value] of lookups) {
    try {
      const { data, error } = await db
        .from("payment_revocations")
        .select("reason")
        .eq(column, value)
        .maybeSingle();
      if (error) return "unreadable";
      if (data) return "revoked";
    } catch {
      return "unreadable";
    }
  }
  return "clear";
}

export async function sessionWasRefunded(db: TableClient, sessionId: unknown): Promise<boolean> {
  return (await paymentRevocationState(db, { sessionId })) === "revoked";
}
