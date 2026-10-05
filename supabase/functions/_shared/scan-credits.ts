/**
 * A PURCHASED SCAN CREDIT IS SPENT ONLY BY SOMEONE WHO PROVED THE PURCHASE.
 *
 * THE HOLE (defect sweep 2026-10-02, items 2.07, 1.26, 2.06). Credits live in
 * user_scan_credits, keyed by the email typed at Stripe checkout. Three doors
 * opened that pool to anyone who could type an address:
 *
 *   - free-keyword-scan took an address from the request body of an anonymous
 *     caller, checked only that it contained an "@", and spent that address's
 *     credit on the caller's scan (or, for a Pro subscriber's address, gave
 *     unlimited scans for nothing);
 *   - the credit reader and spender were callable with the publishable key,
 *     so anyone could drain a customer's balance in a loop or learn which
 *     addresses had bought;
 *   - the credit was spent before the cache lookup and the model call and
 *     never given back, so a busy gateway or a 500 cost a credit and gave no
 *     report.
 *
 * THE RULE NOW. A credit is spent for one of exactly two proven identities:
 *
 *   1. the signed-in account: the email on the JWT the platform verified
 *      (never an email from the request body); or
 *   2. a purchase the caller holds: the Stripe Checkout session id from the
 *      success redirect. It is a bearer secret only the buyer's browser saw.
 *      It is checked once against Stripe (paid, a credit product, which email
 *      was credited, how many credits) and recorded in
 *      scan_credit_session_grants by its SHA-256. From then on it can spend AT
 *      MOST the credits that purchase bought. Stripe never checked that the
 *      typed email belongs to the buyer, so a one-credit purchase made "as"
 *      somebody else must not unlock everything that address holds. The cap
 *      is what stops that.
 *
 * And a credit is RESERVED, not spent, until a full report exists: the caller
 * refunds the hold on every path that delivers less (a cache hit, a rule-based
 * or load-shed report, a busy gateway, an error).
 *
 * WHAT THIS CANNOT FIX: the project's auth settings report mailer_autoconfirm
 * = true (read 2026-10-04 from /auth/v1/settings), so a password sign-up gets a
 * session for an address it never proved it owns. Until email confirmation is
 * turned on, rule 1 is only as strong as that. It is an owner setting, not
 * code.
 *
 * Plain Web APIs only (fetch, crypto.subtle), so the Node test suite imports
 * this module directly. The database and Stripe are passed in.
 */

/** Products whose purchase adds scan credits (the three verifiers agree on these). */
export const CREDIT_PRODUCT_TYPES: ReadonlySet<string> = new Set(["scan_pack", "scan_credits", "career_bundle"]);

/** Session ids one request may present. The browser keeps the newest ten. */
export const MAX_CREDIT_SESSIONS = 5;

/** Ids not yet on record that one request may check against Stripe. */
export const MAX_STRIPE_LOOKUPS = 3;

/** The per-purchase ceiling the verifiers also apply. */
export const MAX_CREDITS_PER_PURCHASE = 500;

const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;

export const isCheckoutSessionId = (v: unknown): v is string => typeof v === "string" && SESSION_ID.test(v);

/** The ids a request presented: well-formed, distinct, first MAX_CREDIT_SESSIONS. */
export function parseCreditSessions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (isCheckoutSessionId(x) && !out.includes(x)) out.push(x);
    if (out.length >= MAX_CREDIT_SESSIONS) break;
  }
  return out;
}

export const normalizeCreditEmail = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** What the table stores instead of the bearer id itself. */
export async function sessionHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type StripeCheckoutSession = {
  id?: string;
  payment_status?: string | null;
  customer_email?: string | null;
  metadata?: Record<string, string | undefined> | null;
  line_items?: { data?: Array<{ quantity?: number | null }> } | null;
};

/**
 * The address the verifiers credited, in their order: customer_email, then
 * metadata.customer_email (create-scan-pack-checkout names the customer
 * instead of customer_email when one exists). add_scan_credits lowercases.
 */
export const creditedEmailOf = (s: StripeCheckoutSession): string =>
  normalizeCreditEmail(s.customer_email || s.metadata?.customer_email || "");

/**
 * How many credits the purchase bought: metadata.credits, else the line
 * quantity, else the product's default. Capped as the verifiers cap it.
 */
export function creditsBoughtOf(s: StripeCheckoutSession): number {
  const fromMeta = parseInt(String(s.metadata?.credits ?? ""), 10);
  const fromLine = Number(s.line_items?.data?.[0]?.quantity ?? 0);
  const fallback = s.metadata?.product_type === "career_bundle" ? 75 : 10;
  const n = Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : fromLine > 0 ? fromLine : fallback;
  return Math.max(1, Math.min(MAX_CREDITS_PER_PURCHASE, Math.floor(n)));
}

/** A paid credit purchase with a credited address, or null. */
export function grantFromStripe(s: StripeCheckoutSession | null | undefined): { email: string; productType: string; credits: number } | null {
  if (!s || s.payment_status !== "paid") return null;
  const productType = String(s.metadata?.product_type ?? "");
  if (!CREDIT_PRODUCT_TYPES.has(productType)) return null;
  const email = creditedEmailOf(s);
  if (!email.includes("@")) return null;
  return { email, productType, credits: creditsBoughtOf(s) };
}

type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  select: (cols: string) => Query;
  in: (col: string, vals: string[]) => Query;
};
export type CreditDb = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Result>;
  from: (table: string) => Query;
};

export type ResolveOptions = {
  stripeKey: string;
  fetchImpl?: typeof fetch;
  maxLookups?: number;
};

/** Stripe's REST API directly: the SDK is not worth its weight in a scanner. */
async function retrieveCheckoutSession(id: string, opts: ResolveOptions): Promise<StripeCheckoutSession | null> {
  if (!opts.stripeKey) return null;
  const f = opts.fetchImpl ?? fetch;
  try {
    const r = await f(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${opts.stripeKey}` }, signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return null;
    return (await r.json()) as StripeCheckoutSession;
  } catch {
    return null;
  }
}

export type SessionGrant = { hash: string; email: string };

/**
 * The presented ids that are credit purchases, as {hash, email}, in the order
 * presented. Recorded ones are read from the table. An id not yet recorded is
 * checked with Stripe ONLY if used_stripe_sessions already holds it: every
 * verifier claims a session there when it credits it, so a random or guessed
 * id costs one indexed read and no Stripe call. At most maxLookups go to
 * Stripe per request. Never throws.
 */
export async function resolveCreditSessions(db: CreditDb, ids: string[], opts: ResolveOptions): Promise<SessionGrant[]> {
  const wanted = parseCreditSessions(ids);
  if (wanted.length === 0) return [];
  try {
    const hashes = await Promise.all(wanted.map(sessionHash));
    const byHash = new Map<string, string>();
    const known = await db.from("scan_credit_session_grants").select("session_hash, email").in("session_hash", hashes);
    for (const row of ((known.data ?? []) as Array<{ session_hash: string; email: string }>)) {
      byHash.set(row.session_hash, normalizeCreditEmail(row.email));
    }

    const unknown = wanted.filter((_, i) => !byHash.has(hashes[i]));
    if (unknown.length > 0) {
      const claimed = await db.from("used_stripe_sessions").select("session_id, product_type").in("session_id", unknown);
      const claimRows = (claimed.data ?? []) as Array<{ session_id: string; product_type: string | null }>;
      // A claim with no product named predates 20260827180000; Stripe decides
      // those. A claim naming a non-credit product is not a credit purchase.
      const eligible = claimRows
        .filter((c) => c.product_type == null || CREDIT_PRODUCT_TYPES.has(c.product_type))
        .map((c) => c.session_id)
        .slice(0, opts.maxLookups ?? MAX_STRIPE_LOOKUPS);
      for (const id of eligible) {
        const grant = grantFromStripe(await retrieveCheckoutSession(id, opts));
        if (!grant) continue;
        const hash = hashes[wanted.indexOf(id)];
        const { data: recorded } = await db.rpc("scan_credit_grant_record", {
          p_session_hash: hash,
          p_email: grant.email,
          p_product_type: grant.productType,
          p_credits_bought: grant.credits,
        });
        // true only when the stored row names this same address; a session is
        // never re-pointed at another one.
        if (recorded === true) byHash.set(hash, grant.email);
      }
    }

    const out: SessionGrant[] = [];
    for (const hash of hashes) {
      const email = byHash.get(hash);
      if (email) out.push({ hash, email });
    }
    return out;
  } catch (e) {
    console.warn("[SCAN-CREDITS] resolving purchase sessions failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** One reserved credit: whose pool it came from and, for a purchase, which one. */
export type CreditHold = { email: string; sessionHash: string | null; via: "account" | "purchase" };

/**
 * Reserve one credit for a proven identity: the signed-in account first, then
 * each held purchase in turn. Null when nothing proven has a credit left.
 * Never throws: a failure to reserve is "no credit", which refuses the scan
 * rather than giving it away.
 */
export async function reserveScanCredit(
  db: CreditDb,
  who: { accountEmail: string | null; sessionIds: string[] },
  opts: ResolveOptions,
): Promise<CreditHold | null> {
  const account = normalizeCreditEmail(who.accountEmail ?? "");
  try {
    if (account.includes("@")) {
      const { data } = await db.rpc("scan_credit_redeem", { p_email: account, p_session_hash: null });
      if (data === true) return { email: account, sessionHash: null, via: "account" };
    }
    if (who.sessionIds.length > 0) {
      for (const g of await resolveCreditSessions(db, who.sessionIds, opts)) {
        // The account's own pool was just asked; a purchase under the same
        // address draws on that same pool and would only repeat the answer.
        if (account && g.email === account) continue;
        const { data } = await db.rpc("scan_credit_redeem", { p_email: g.email, p_session_hash: g.hash });
        if (data === true) return { email: g.email, sessionHash: g.hash, via: "purchase" };
      }
    }
  } catch (e) {
    console.warn("[SCAN-CREDITS] reserve failed:", e instanceof Error ? e.message : String(e));
  }
  return null;
}

/**
 * Give a reserved credit back. The SQL refuses to lift a balance above what
 * was ever purchased, so a stray second refund cannot mint a credit.
 */
export async function refundScanCredit(db: CreditDb | null | undefined, hold: CreditHold | null | undefined): Promise<boolean> {
  if (!db || !hold) return false;
  try {
    const { data, error } = await db.rpc("scan_credit_refund", { p_email: hold.email, p_session_hash: hold.sessionHash });
    if (error || data !== true) {
      console.error(`[SCAN-CREDITS] refund of a ${hold.via} credit was not applied`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[SCAN-CREDITS] refund of a ${hold.via} credit failed:`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * What a proven identity can still spend: the account's pool, plus, for each
 * other address among the held purchases, what those purchases have left
 * (never more than that address's pool). Null when the read failed.
 */
export async function scanCreditBalance(
  db: CreditDb,
  who: { accountEmail: string | null; sessionHashes: string[] },
): Promise<number | null> {
  try {
    const account = normalizeCreditEmail(who.accountEmail ?? "");
    const { data, error } = await db.rpc("scan_credit_balance", {
      p_email: account.includes("@") ? account : null,
      p_session_hashes: who.sessionHashes.length > 0 ? who.sessionHashes : null,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/** What the held purchases bought in total (the success page's "N credits added"). Null when unread. */
export async function scanCreditGrantsBought(db: CreditDb, sessionHashes: string[]): Promise<number | null> {
  if (sessionHashes.length === 0) return 0;
  try {
    const { data, error } = await db.rpc("scan_credit_grants_bought", { p_session_hashes: sessionHashes });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}
