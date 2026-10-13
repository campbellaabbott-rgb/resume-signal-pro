// WHO IS BUYING, AND THE RECORD THAT THEY DID (wave 4 round 2,
// checkout-catalogue; critical-path CP-022 and CP-025).
//
// THREE ANSWERS, NOT TWO. A checkout asked the auth server who the bearer
// was and read any failure as "anonymous". A token the server REFUSED is an
// anonymous buyer; but when the auth server itself failed (a network error,
// a 5xx), a Pro member was sent to a paid Stripe page for a tool their plan
// includes. checkoutCaller tells the three apart, and a checkout answers
// "unavailable" with a 503 and no Stripe url.
//
// THE BUYER IS RECORDED. A one-time purchase made while signed in named no
// account, so it could never be listed under that account. A checkout now
// stamps the account on the session (client_reference_id, metadata.user_id)
// and writes checkout_buyers (20261011150000) before the browser has the url.
// A failed write is logged and the purchase goes ahead: the account join is
// a convenience, never a reason to refuse a sale.
//
// A GRANT OVER THE CAP (owner decision D7) is a fair-use answer, never a
// charge: pro_grants_cap refuses the 11th grant in a day and the 61st in 30
// days with SQLSTATE P0001 and a message starting "pro_grant_cap:".
//
// Pure apart from the clients it is handed: importable by Deno and vitest.

type AuthLike = {
  getUser: (jwt: string) => Promise<{
    data?: { user?: { id?: string | null; email?: string | null } | null } | null;
    error?: unknown;
  }>;
};

export type CheckoutCaller =
  | { kind: "anonymous" }
  | { kind: "signed_in"; id: string; email: string }
  | { kind: "unavailable"; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Did the auth server itself fail (rather than refuse the token)? */
export function authServerFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: unknown; status?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  const status = typeof e.status === "number" ? e.status : null;
  return status !== null && (status === 0 || status >= 500);
}

/**
 * The caller behind the request's bearer token. The publishable key every
 * visitor holds is not a user and costs no round trip.
 */
export async function checkoutCaller(auth: AuthLike, headers: Headers, publishableKey: string): Promise<CheckoutCaller> {
  const token = (headers.get("Authorization") ?? headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || (publishableKey && token === publishableKey)) return { kind: "anonymous" };
  try {
    const { data, error } = await auth.getUser(token);
    const user = data?.user;
    if (user && typeof user.email === "string" && user.email.includes("@") && typeof user.id === "string" && UUID_RE.test(user.id)) {
      return { kind: "signed_in", id: user.id, email: user.email.trim().toLowerCase() };
    }
    if (authServerFailed(error)) return { kind: "unavailable", reason: String((error as { message?: unknown })?.message ?? "auth server error").slice(0, 160) };
    return { kind: "anonymous" };
  } catch (err) {
    // A thrown call is the transport failing, not a verdict on the token.
    return { kind: "unavailable", reason: String(err instanceof Error ? err.message : err).slice(0, 160) };
  }
}

/** The 503 every checkout answers when it cannot tell who is buying. */
export const CALLER_UNAVAILABLE_BODY = {
  error: "We couldn't check your account just now, so nothing was charged. Please try again in a minute.",
  retryable: true,
} as const;

/** What the session carries about a signed-in buyer (nothing for an anonymous one). */
export function buyerSessionFields(caller: CheckoutCaller): { client_reference_id?: string } {
  return caller.kind === "signed_in" ? { client_reference_id: caller.id } : {};
}

export function buyerMetadata(caller: CheckoutCaller): Record<string, string> {
  return caller.kind === "signed_in" ? { user_id: caller.id } : {};
}

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

export const CHECKOUT_BUYER_TIMEOUT_MS = 2000;

/**
 * Record the account behind a Stripe session. Never throws; "skipped" for an
 * anonymous buyer, "failed" when the write errored or stalled.
 */
export async function recordCheckoutBuyer(
  db: TableClient,
  row: { stripeSessionId: string; caller: CheckoutCaller; checkoutFunction: string; productType: string | null },
): Promise<"recorded" | "skipped" | "failed"> {
  if (row.caller.kind !== "signed_in") return "skipped";
  if (!/^cs_[A-Za-z0-9_]{8,250}$/.test(row.stripeSessionId)) return "failed";
  try {
    const write = Promise.resolve(
      db.from("checkout_buyers").upsert({
        stripe_session_id: row.stripeSessionId,
        user_id: row.caller.id,
        checkout_function: row.checkoutFunction,
        product_type: row.productType,
      }, { onConflict: "stripe_session_id", ignoreDuplicates: true }),
    ) as Promise<{ error?: { message?: string } | null }>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<{ error: { message: string } }>((resolve) => {
      timer = setTimeout(() => resolve({ error: { message: "timed out" } }), CHECKOUT_BUYER_TIMEOUT_MS);
    });
    const { error } = await Promise.race([write, timed]).finally(() => clearTimeout(timer));
    if (error) {
      console.error(`[CHECKOUT-BUYER] ${row.checkoutFunction} ${row.stripeSessionId}: not recorded: ${error.message ?? "error"}`);
      return "failed";
    }
    return "recorded";
  } catch (err) {
    console.error(`[CHECKOUT-BUYER] ${row.checkoutFunction} ${row.stripeSessionId}: threw: ${String(err).slice(0, 160)}`);
    return "failed";
  }
}

/** The cap's refusal, read off a failed pro_grants insert; null for any other error. */
export function grantCapOf(error: unknown): "daily" | "monthly" | null {
  if (!error || typeof error !== "object") return null;
  const message = String((error as { message?: unknown }).message ?? "");
  const m = /^pro_grant_cap:\s*(daily|monthly)/.exec(message);
  return m ? (m[1] as "daily" | "monthly") : null;
}

/** The fair-use answer for a grant over the cap: 429, and never a Stripe url. */
export function fairUseAnswer(cap: "daily" | "monthly"): { status: 429; body: { error: string; fairUse: true; reason: "pro_grant_cap"; window: "daily" | "monthly" } } {
  return {
    status: 429,
    body: {
      error: cap === "daily"
        ? "Pro includes up to 10 of these a day and 60 a month, and you've reached today's 10. Nothing was charged; it opens again tomorrow."
        : "Pro includes up to 10 of these a day and 60 a month, and you've reached the 60 for the last 30 days. Nothing was charged.",
      fairUse: true,
      reason: "pro_grant_cap",
      window: cap,
    },
  };
}
