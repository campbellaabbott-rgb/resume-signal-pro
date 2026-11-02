/**
 * WHY A PURCHASE LINK DID NOT OPEN (S13-048).
 *
 * The product success page stored the SDK's generic message for any non-2xx
 * from verify-product-purchase and told every such buyer that the payment
 * "may still be processing" and the purchase "is safe", with Try again. A
 * refunded buyer, a buyer whose included tool was withdrawn, a link that
 * names no purchase and a checkout that was never paid all read that, and
 * reloading could never change their answer. The page now reads the status
 * and the body verify-product-purchase answers:
 *   429                               rate_limited  (its hourly budget; try again later)
 *   402 { refunded: true }            refunded      (REFUNDED_PURCHASE_MESSAGE)
 *   402 otherwise                     withdrawn     (a revoked or lapsed Pro grant)
 *   400 { error: "Payment not completed" }  unpaid  (Stripe has not settled it)
 *   400 unknown, expired or malformed link  not_found
 *   anything else, 503 and 500 included     unknown (the old answer, with Try again)
 * Try again is offered only where asking again can change the answer.
 */

import { purchaseReferenceIn } from "../../supabase/functions/_shared/purchase-links";

export type VerifyRefusal = "rate_limited" | "refunded" | "withdrawn" | "unpaid" | "not_found" | "unknown";

/** Whether reloading the page can change this answer. */
export const VERIFY_REFUSAL_RETRIES: Readonly<Record<VerifyRefusal, boolean>> = {
  rate_limited: true,
  unpaid: true,
  unknown: true,
  refunded: false,
  withdrawn: false,
  not_found: false,
};

const NOT_FOUND = /couldn't find that purchase|^Invalid session$|^Session ID is required$/i;

/** The refusal a status and a parsed body name. */
export function verifyRefusalFrom(status: number | undefined, body: unknown): VerifyRefusal {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = typeof b.error === "string" ? b.error : "";
  if (status === 429) return "rate_limited";
  if (status === 402) return b.refunded === true ? "refunded" : "withdrawn";
  if (status === 400) {
    if (message === "Payment not completed") return "unpaid";
    if (NOT_FOUND.test(message)) return "not_found";
  }
  return "unknown";
}

/** The refusal behind a supabase.functions.invoke error (its `context` is the Response). Never throws. */
export async function verifyRefusalOf(error: unknown): Promise<VerifyRefusal> {
  const ctx = (error as { context?: unknown } | null)?.context as Response | undefined;
  if (!ctx || typeof ctx.status !== "number") return "unknown";
  let body: unknown = null;
  try {
    body = typeof ctx.clone === "function" ? await ctx.clone().json() : null;
  } catch {
    body = null;
  }
  return verifyRefusalFrom(ctx.status, body);
}

/**
 * THE PAGE A PASTED PURCHASE LINK OPENS (S13-128): the product page with the
 * reference the paste carries (the email's whole link, the line that holds
 * it, or the bare reference), or null when it carries none. A link without
 * its reference opened the paid badge and an upload form whose Generate
 * could only be refused.
 */
export function productPageForPaste(pasted: unknown, productKey: string | null): string | null {
  const ref = purchaseReferenceIn(pasted);
  if (!ref) return null;
  const product = productKey && /^[A-Za-z]{1,40}$/.test(productKey) ? `&product=${productKey}` : "";
  return `/product-success?session_id=${encodeURIComponent(ref)}${product}`;
}

/**
 * Opens it as a new page load, so the first script in index.html moves the
 * reference out of the address before any analytics read it.
 */
export function openPage(href: string): void {
  window.location.assign(href);
}
