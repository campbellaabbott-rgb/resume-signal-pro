/**
 * WAS THIS CHECKOUT SESSION'S PAYMENT TAKEN BACK? (platform sweep L6-18)
 *
 * stripe-webhook records every refund in full and every dispute in
 * payment_revocations (payment_revoke, 20261008131000), and rewrites the
 * session's claim to the product 'refunded', which no paid generator sells.
 * Stripe keeps answering payment_status 'paid' for a refunded session, so the
 * two deliverers that read Stripe themselves -- verify-product-purchase and
 * analyze-resume -- ask this before they deliver anything.
 *
 * A lookup that fails answers false: the claim rewrite still stops every
 * generator and every first-use delivery, and a refund is a rare correction,
 * so a database hiccup must not refuse every honest buyer at the success page.
 *
 * Import-free: the Node tests import it directly.
 */

/** The product a refunded session's claim names: no generator sells it. */
export const REFUNDED_CLAIM_PRODUCT = "refunded";

/** What a buyer is told when their refunded purchase is asked for again. */
export const REFUNDED_PURCHASE_MESSAGE = "This purchase was refunded, so it can no longer be delivered.";

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

export async function sessionWasRefunded(db: TableClient, sessionId: unknown): Promise<boolean> {
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) return false;
  try {
    const { data, error } = await db
      .from("payment_revocations")
      .select("reason")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}
