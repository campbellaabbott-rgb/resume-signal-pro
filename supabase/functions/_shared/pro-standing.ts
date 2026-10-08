/**
 * ONE ANSWER TO "IS THIS ACCOUNT PRO", FOR EVERY CALLER.
 *
 * WHY THIS FILE EXISTS (platform sweep 2026-10-04, L6-08 and L6-29). Five
 * functions each kept their own rule: generate-apply-package counted only
 * `active` with no grace (so a trialing Agent subscriber the Account page
 * called a Pro member got 402 on batch prep), the product checkouts and the
 * purchase verifier read the Pro cache only (so a comped agent account was
 * sent to Stripe for a tool its plan includes), the scanner read the Pro
 * cache only, and every one of them asked by ADDRESS -- which a password
 * sign-up can claim, because sign-ups are confirmed automatically.
 *
 * THE RULE, decided once (owner decision 2026-10-04):
 *   - The rows are the ACCOUNT's: pro_entitlement_rows (20261008130000)
 *     answers both caches by user id -- a row bound to the account, or an
 *     unbound one on its own address only when it has proven that mailbox.
 *   - A row is LIVE while its status is active or trialing and its period
 *     ended no more than a day ago (Stripe's renewal webhook and this read are
 *     not synchronous; briefly trusting a lapsed row beats locking out a
 *     paying one). One grace, for every caller.
 *   - LIVE unlocks the plan's ongoing features: unlimited scans, batch
 *     application prep, the status the Account page shows.
 *   - A TRIAL BUYS NO CONSUMABLES. Only a live row that is not a trial may
 *     mint a scan-credit grant or a free paid one-off product (a pro_ grant,
 *     the Full Analysis). A trial that is cancelled before its first payment
 *     paid for nothing, so it may keep nothing.
 *
 * Import-free, like agent-entitlement.ts: the Deno functions get it through
 * _shared/pro.ts, and the Node test suite imports it directly.
 */

/** Statuses that make a row live (within the grace below). */
export const PRO_LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/** The live statuses that may mint a consumable. A trial is live but is not one of them. */
export const PRO_CONSUMABLE_STATUSES: ReadonlySet<string> = new Set(["active"]);

/** How long past current_period_end a row still counts. One day, for every caller. */
export const PRO_GRACE_MS = 24 * 3600 * 1000;

/** The one database read: both caches, by account (20261008130000). */
export const PRO_ENTITLEMENT_RPC = "pro_entitlement_rows";

export type ProRow = {
  tier?: string | null;
  status?: string | null;
  current_period_end?: string | Date | null;
  bound?: boolean | null;
};

export interface ProStanding {
  /** The plan's ongoing features are unlocked (a live row, trial included). */
  pro: boolean;
  /** Live only through a trial: ongoing features yes, consumables no. */
  trialing: boolean;
  /** May mint a consumable (a scan-credit grant, a free paid one-off product). */
  consumables: boolean;
  /** The status of the row the answer rests on: a live paid one, else a live trial, else the first row read. */
  status: string | null;
  /**
   * False when the rows could not be read. Every flag above is then false:
   * a caller that mints fails closed, and a caller that only DISPLAYS a
   * status may fall back to what it already knew.
   */
  known: boolean;
}

export const NOT_PRO: ProStanding = Object.freeze({ pro: false, trialing: false, consumables: false, status: null, known: true });
const UNKNOWN: ProStanding = Object.freeze({ pro: false, trialing: false, consumables: false, status: null, known: false });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Live: a live status, and a period that ended no more than PRO_GRACE_MS ago (or none recorded). */
export function proRowIsLive(row: ProRow | null | undefined, now: number = Date.now()): boolean {
  if (!row || !PRO_LIVE_STATUSES.has(String(row.status ?? ""))) return false;
  const end = row.current_period_end;
  if (end === null || end === undefined || end === "") return true;
  const t = end instanceof Date ? end.getTime() : Date.parse(String(end));
  // An unparseable date is not evidence of a running plan.
  if (!Number.isFinite(t)) return false;
  return t >= now - PRO_GRACE_MS;
}

/** The standing these rows give, by the rule above. Anything that is not an array of rows is no rows. */
export function proStandingFrom(rows: unknown, now: number = Date.now()): ProStanding {
  const list: ProRow[] = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") as ProRow[] : [];
  const live = list.filter((r) => proRowIsLive(r, now));
  const paid = live.find((r) => PRO_CONSUMABLE_STATUSES.has(String(r.status ?? "")));
  if (paid) return { pro: true, trialing: false, consumables: true, status: String(paid.status), known: true };
  if (live.length) return { pro: true, trialing: true, consumables: false, status: String(live[0].status), known: true };
  return { ...NOT_PRO, status: list.length && list[0].status ? String(list[0].status) : null };
}

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => any };
// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

/**
 * THE question every gate asks: what does this VERIFIED account hold? `userId`
 * must come from a token the auth server accepted (getUser), never from a
 * body. A read that fails answers known: false (and nothing unlocked).
 */
export async function accountProStanding(db: RpcClient, userId: unknown, now: number = Date.now()): Promise<ProStanding> {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return NOT_PRO;
  try {
    const { data, error } = await db.rpc(PRO_ENTITLEMENT_RPC, { p_user_id: userId });
    if (error) return UNKNOWN;
    return proStandingFrom(data, now);
  } catch {
    return UNKNOWN;
  }
}

export type ProGrantLike = {
  user_id?: string | null;
  revoked_at?: string | Date | null;
} | null | undefined;

export type GrantRefusal = { status: 402 | 503; error: string };

/**
 * MAY THIS UNSPENT PRO GRANT BE REDEEMED NOW? Asked by every redeemer
 * (verify-product-purchase, generate-freelance-boost, analyze-resume) before
 * it delivers. null when it may; otherwise the status and the reason.
 *
 *   - revoked: a refunded or disputed subscription payment took it back.
 *   - no account on it: minted before grants named their account
 *     (20261008130000). Its address is not proof of anything, so it is
 *     refused and the member mints a new one, which takes one click.
 *   - the minting ACCOUNT no longer holds a plan that may mint consumables
 *     (lapsed, or only a trial). A grant survives its 402: nothing is spent.
 *   - the plan could not be read: 503, retry.
 */
export async function proGrantRefusal(db: RpcClient, grant: ProGrantLike, now: number = Date.now()): Promise<GrantRefusal | null> {
  if (!grant) return { status: 402, error: "Invalid session" };
  if (grant.revoked_at) {
    return { status: 402, error: "This was withdrawn because the subscription payment behind it was refunded." };
  }
  if (typeof grant.user_id !== "string" || !UUID_RE.test(grant.user_id)) {
    return { status: 402, error: "This link was made before an update. Open the tool again while signed in and it will be included." };
  }
  const standing = await accountProStanding(db, grant.user_id, now);
  if (!standing.known) return { status: 503, error: "We couldn't check your plan just now. Please try again in a minute." };
  if (!standing.consumables) return { status: 402, error: "Subscription is not active" };
  return null;
}

/**
 * The same rule over the PRO CACHE ROW FOR AN ADDRESS, for the two callers
 * that have no account to ask and MINT NOTHING on the answer:
 * create-product-checkout's signed-out "sign in to use your plan" note, and
 * check-subscription's answer to a buyer holding the checkout they just
 * completed. It never unlocks anything by itself.
 */
export async function addressProStanding(db: TableClient, email: unknown, now: number = Date.now()): Promise<ProStanding> {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized.includes("@")) return NOT_PRO;
  try {
    const { data, error } = await db
      .from("pro_subscribers")
      .select("status, current_period_end")
      .eq("email", normalized)
      .maybeSingle();
    if (error) return UNKNOWN;
    return proStandingFrom(data ? [{ tier: "pro", ...data }] : [], now);
  } catch {
    return UNKNOWN;
  }
}
