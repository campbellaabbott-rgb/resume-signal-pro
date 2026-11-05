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
 *   429                               rate_limited  (the connection's hourly budget; try again later)
 *   402 { refunded: true }            refunded      (REFUNDED_PURCHASE_MESSAGE)
 *   402 "made before an update"       sign_in_again (a Pro grant minted before grants named
 *                                                    their account: open the tool again signed in)
 *   402 "Invalid session"             not_found
 *   402 otherwise                     withdrawn     (a revoked or lapsed Pro grant)
 *   400 { error: "Payment not completed" }  unpaid  (Stripe has not settled it)
 *   400 unknown, expired or malformed link  not_found (Stripe's own "no such session")
 *   503 { retryable: true }           busy          (Stripe did not answer: a rate limit,
 *                                                    a timeout, a 5xx; try again)
 *   anything else, 500 included       unknown       (the old answer, with Try again)
 * Try again is offered only where asking again can change the answer.
 * (The fixer's review: a transient Stripe failure was answered as not_found,
 * a dead end with no Try again, and the legacy grant's actionable 402 as
 * withdrawn, telling a paying member their plan had lapsed.)
 */

import { purchaseReferenceIn } from "../../supabase/functions/_shared/purchase-links";

export type VerifyRefusal = "rate_limited" | "refunded" | "withdrawn" | "sign_in_again" | "unpaid" | "not_found" | "busy" | "unknown";

/** Whether reloading the page can change this answer. */
export const VERIFY_REFUSAL_RETRIES: Readonly<Record<VerifyRefusal, boolean>> = {
  rate_limited: true,
  unpaid: true,
  busy: true,
  unknown: true,
  refunded: false,
  withdrawn: false,
  sign_in_again: false,
  // The function's own sentence tells a buyer to refresh, and until
  // verify-product-purchase 2026-11-03.1 serves it also covers a Stripe that
  // did not answer. A press costs nothing.
  not_found: true,
};

const NOT_FOUND = /couldn't find that purchase|^Invalid session$|^Session ID is required$/i;
/** _shared/pro-standing.ts proGrantRefusal's answer for a grant that names no account. */
const LEGACY_GRANT = /made before an update/i;

/** The refusal a status and a parsed body name. */
export function verifyRefusalFrom(status: number | undefined, body: unknown): VerifyRefusal {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message = typeof b.error === "string" ? b.error : "";
  if (status === 429) return "rate_limited";
  if (status === 402) {
    if (b.refunded === true) return "refunded";
    if (LEGACY_GRANT.test(message)) return "sign_in_again";
    if (/^Invalid session$/i.test(message)) return "not_found";
    return "withdrawn";
  }
  if (status === 400) {
    if (message === "Payment not completed") return "unpaid";
    if (NOT_FOUND.test(message)) return "not_found";
  }
  if (status === 503 && b.retryable === true) return "busy";
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
