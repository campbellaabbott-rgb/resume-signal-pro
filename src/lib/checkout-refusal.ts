/**
 * WHAT A CHECKOUT'S REFUSAL SAYS, READ FROM ITS BODY (S12-170, wave 4 round 2).
 *
 * A checkout that will not sell answers with a sentence written for the
 * buyer: 410 for a product no longer sold (the retired agent products and the
 * cut catalogue), 451 for a buyer in the EU, the EEA, the UK or India while
 * sales there wait for the tax registration, 429 for a Pro member's included
 * tool over the fair-use cap, 409 for a plan whose first payment is not
 * through, 409 `seller_identity_missing` while purchases wait for the
 * seller's name and address (owner decision 2026-10-17), and 400 for a Pro
 * checkout pressed without its automatic-renewal box ticked.
 * The generic error parser drops any sentence over 200 characters and knows
 * no 410 or 451, so the retired sentence showed as "Something went wrong —
 * try again", which invites the retry the 410 exists to stop.
 *
 * This reads the body of a supabase-js FunctionsHttpError (error.context is
 * the Response) or a body already parsed, and returns the buyer's sentence
 * and what kind of refusal it is, or null when the answer is none of these.
 */

export type CheckoutRefusalKind = "retired" | "territory" | "fair_use" | "plan_unpaid" | "seller_missing" | "auto_renew";

/** The English fallback when a seller_identity_missing body carries no sentence. */
export const PURCHASES_OPEN_SOON = "Purchases open soon. Nothing was charged.";

export interface CheckoutRefusal {
  kind: CheckoutRefusalKind;
  /** The server's sentence, in the buyer's language when the server had it. */
  message: string;
  /** Where the refusal points, when it names a page (the pricing page, /agents). */
  link: string | null;
}

type Body = Record<string, unknown>;

function fromBody(body: unknown, status: number | null): CheckoutRefusal | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Body;
  // The seller gate names a code in `error` and its sentence in `message`.
  if (b.error === "seller_identity_missing") {
    const said = typeof b.message === "string" ? b.message.trim() : "";
    return { kind: "seller_missing", message: said || PURCHASES_OPEN_SOON, link: null };
  }
  const message = typeof b.error === "string" ? b.error.trim() : "";
  if (!message) return null;
  const link = typeof b.pricing === "string" ? b.pricing : typeof b.applyYourself === "string" ? b.applyYourself : null;
  if (b.retired === true || status === 410) return { kind: "retired", message, link };
  if (b.territoryRefused === true || status === 451) return { kind: "territory", message, link: null };
  if (b.fairUse === true) return { kind: "fair_use", message, link: null };
  if (b.planUnpaid === true) return { kind: "plan_unpaid", message, link: null };
  if (b.autoRenewConsentRequired === true) return { kind: "auto_renew", message, link: null };
  return null;
}

/** The refusal in an already-parsed body (a resilient caller's errorBody, or a 2xx data). */
export function checkoutRefusalOfBody(body: unknown, status: number | null = null): CheckoutRefusal | null {
  return fromBody(body, status);
}

/** The refusal behind a supabase-js functions error, or null. Never throws. */
export async function checkoutRefusalOf(error: unknown): Promise<CheckoutRefusal | null> {
  if (!error || typeof error !== "object") return null;
  const ctx = (error as { context?: unknown }).context;
  if (!ctx || typeof ctx !== "object") return null;
  const res = ctx as { status?: unknown; clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> };
  const status = typeof res.status === "number" ? res.status : null;
  try {
    const body = typeof res.clone === "function" ? await res.clone().json() : typeof res.json === "function" ? await res.json() : null;
    return fromBody(body, status);
  } catch {
    return null;
  }
}
