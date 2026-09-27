/**
 * A CHECKOUT THAT BEGAN IS RECORDED WHERE THE SESSION IS MINTED.
 *
 * WHY THIS EXISTS. The funnel's checkout_started stage was client-only: a
 * browser event fired milliseconds before the page navigated to Stripe. Three
 * things ate it. The funnel writer refuses a repeat of (test, visitor, type)
 * inside a 24-hour window, so once a landing had landed the stage was answered
 * "duplicate" and never inserted; the page unloads before a plain fetch
 * completes; and the fifty-events-an-hour budget per IP is shared by every
 * hook on the site, so a shared address dropped it silently. Measured
 * 2026-09-27 over 30 days: 136,087 landing visitors, zero at checkout_started,
 * against 26 completed scans.
 *
 * WHAT THIS DOES. Every function that mints a Stripe Checkout session calls
 * recordCheckoutStart with the session Stripe just answered with, BEFORE the
 * url goes back to the browser. The browser cannot navigate until it has that
 * url, so no unload can race the write. The row is keyed on the Stripe
 * session id and nothing else: a visitor who starts checkout twice made two
 * sessions and gets two rows, and nothing here consults an IP budget. A
 * failed write is logged and the purchase proceeds -- analytics never stands
 * between a customer and Stripe.
 *
 * WHAT IT RECORDS, and where each value comes from:
 *   stripe_session_id  the join key. used_stripe_sessions.session_id and
 *                      product_deliveries.stripe_session_id carry the same
 *                      string once payment lands, so a paid session joins
 *                      back to its start with an equality on this column.
 *   visitor_id         the id the client sends in the request body as
 *                      `visitorId`, validated to the shape track-ab-event
 *                      accepts (8 to 64 characters). Anything else is stored
 *                      as unknown and the row is kept -- a start with no
 *                      visitor is still a start. This is the column that joins
 *                      a purchase to its landing_view in ab_test_events.
 *   origin_path        the pathname the client sends as `page`, reduced to a
 *                      path: never a query string, never a fragment.
 *   amount / currency  what Stripe answered (amount_total, currency), which
 *                      is the figure after a promotion code, not the list
 *                      price.
 *
 * THIS MODULE HAS NO IMPORTS ON PURPOSE. The unit guard imports it under
 * vitest and exercises the readers and the recorder for real, instead of
 * matching their spelling.
 */

export const CHECKOUT_START_VERSION = "2026-09-27.2";

/**
 * The longest the purchase path waits for the record. The call is awaited so
 * no unload can race it, and it cannot throw -- but a client library call has
 * no timeout of its own, so a stalled connection (a hang, not an error) would
 * hold the Stripe url until the runtime's own wall-clock limit. Past this
 * many milliseconds the start is answered "failed", logged with the session
 * id, and the purchase proceeds.
 */
export const CHECKOUT_START_TIMEOUT_MS = 2000;

/** The visitor-id shape the funnel's edge function accepts: a string of 8 to 64 characters. */
export const VISITOR_ID_MIN = 8;
export const VISITOR_ID_MAX = 64;
/** A recorded path is capped so a runaway client cannot store a novel. */
export const ORIGIN_PATH_MAX = 200;

export type CheckoutContext = {
  visitorId: string | null;
  page: string | null;
};

/**
 * The visitor id as sent, or null when it is not a string of 8 to 64
 * printable, non-space characters. Null is a value here, not a refusal: the
 * start is recorded either way.
 */
export function visitorIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length < VISITOR_ID_MIN || s.length > VISITOR_ID_MAX) return null;
  if (!/^[\x21-\x7e]+$/.test(s)) return null;
  return s;
}

/**
 * A path and only a path. A full URL is reduced to its pathname; a bare path
 * is taken as-is; the query string and the fragment are cut off; anything that
 * does not begin with a slash, or carries a character a pathname cannot, is
 * unknown.
 */
export function originPathOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      return null;
    }
  }
  s = s.split("?")[0].split("#")[0];
  if (!s.startsWith("/")) return null;
  if (s.length > ORIGIN_PATH_MAX) s = s.slice(0, ORIGIN_PATH_MAX);
  if (!/^[A-Za-z0-9/_\-.%~]+$/.test(s)) return null;
  return s;
}

/** The analytics context carried in a parsed request body: `visitorId` and `page`. */
export function checkoutContextOf(body: unknown): CheckoutContext {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return { visitorId: visitorIdOf(b.visitorId), page: originPathOf(b.page) };
}

/**
 * The same context read from a request whose body the caller does not
 * otherwise consume. The body is read from a clone, so the request stays
 * readable; a body that is not JSON yields an empty context.
 */
export async function checkoutContextFromRequest(req: Request): Promise<CheckoutContext> {
  try {
    return checkoutContextOf(await req.clone().json());
  } catch {
    return checkoutContextOf({});
  }
}

export type CheckoutStart = {
  /** Stripe's session id, as answered by the create call. The row's key. */
  stripeSessionId: string;
  /** The minting function's own directory name. */
  checkoutFunction: string;
  /** The product_type the session's metadata carries, so the paid side and this side agree. */
  productType: string;
  /** The frontend product key where one exists (create-product-checkout's map, the main flow), else null. */
  productId?: string | null;
  /** Stripe's amount_total: the smallest currency unit, after any promotion code. */
  amountCents?: number | null;
  currency?: string | null;
  /** payment or subscription. */
  mode?: string | null;
  context: CheckoutContext;
  metadata?: Record<string, unknown>;
};

export type CheckoutStartOutcome = "recorded" | "already_recorded" | "failed";

/** The one method this module needs from a service-role client. */
export type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
    // deno-lint-ignore no-explicit-any
  ) => PromiseLike<{ data: any; error: { message: string } | null }>;
};

/**
 * Writes the start through record_checkout_start (service_role only; the
 * function is the single writer to checkout_starts). Never throws and never
 * waits past CHECKOUT_START_TIMEOUT_MS: a failure or a stall is logged with
 * the function and the session id and answered as "failed".
 * "already_recorded" is the same session id seen again -- Stripe's
 * idempotency key can hand one session to two requests -- and is not an
 * error.
 */
export async function recordCheckoutStart(
  db: RpcClient,
  start: CheckoutStart,
  timeoutMs: number = CHECKOUT_START_TIMEOUT_MS,
): Promise<CheckoutStartOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const write = Promise.resolve(
      db.rpc("record_checkout_start", {
        p_stripe_session_id: start.stripeSessionId,
        p_checkout_function: start.checkoutFunction,
        p_product_type: start.productType,
        p_product_id: start.productId ?? null,
        p_visitor_id: start.context.visitorId,
        p_amount_cents: start.amountCents ?? null,
        p_currency: start.currency ?? null,
        p_origin_path: start.context.page,
        p_mode: start.mode ?? null,
        p_metadata: start.metadata ?? {},
      }),
    );
    const late = new Promise<{ timedOut: true }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const answer = await Promise.race([write, late]);
    if ("timedOut" in answer) {
      console.error(`[CHECKOUT-START] ${start.checkoutFunction} ${start.stripeSessionId}: no answer within ${timeoutMs}ms`);
      return "failed";
    }
    const { data, error } = answer;
    if (error) {
      console.error(`[CHECKOUT-START] ${start.checkoutFunction} ${start.stripeSessionId}: ${error.message}`);
      return "failed";
    }
    return data === true ? "recorded" : "already_recorded";
  } catch (e) {
    console.error(`[CHECKOUT-START] ${start.checkoutFunction} ${start.stripeSessionId}: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
