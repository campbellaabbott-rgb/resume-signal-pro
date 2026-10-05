/**
 * WHO PAID, AS STRIPE RECORDED IT (platform sweep L6-25, register 2.02).
 *
 * A checkout started without an address (an anonymous buyer with nothing
 * stored) has no customer_email and an empty metadata.customer_email; the
 * address the buyer typed into Stripe Checkout is in customer_details.email.
 * The webhook, verify-product-purchase, verify-scan-pack-purchase and
 * reconcile-stripe read only the first two, so that buyer got no delivery
 * email, their purchased_content was saved under '' (recover-purchase could
 * never match it) and their credits went nowhere. Every reader now asks this.
 *
 * Normalised (trimmed, lower-case) because every table keyed on an address
 * stores it that way.
 */
export type BuyerSessionLike = {
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  metadata?: Record<string, string | null | undefined> | null;
} | null | undefined;

export function buyerEmailOf(session: BuyerSessionLike): string | null {
  const candidates = [
    session?.customer_details?.email,
    session?.customer_email,
    session?.metadata?.customer_email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.includes("@")) return c.trim().toLowerCase();
  }
  return null;
}
