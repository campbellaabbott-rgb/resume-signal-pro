// Shared helpers for Resume Booster Pro ($45/month all-access subscription).
// Stripe is the source of truth; pro_subscribers is a service-role cache so
// hot paths (scan rate limits) can check status without a Stripe round trip.
//
// WHO IS PRO is decided in exactly one place, re-exported here so every caller
// imports it from this file: accountProStanding / proStandingFrom in
// ./pro-standing.ts (both caches, by the verified account, one trialing rule,
// one grace rule -- platform sweep L6-08 / L6-29). The address reader that
// used to live here (isProCached) is gone on purpose: it was how five callers
// came to hold five rules, and it trusted an address a sign-up can claim.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { listAll } from "./stripe-paging.ts";
import { isAgentPriced, subscriptionBuyer } from "./agent.ts";

export {
  accountProStanding,
  addressProStanding,
  NOT_PRO,
  PRO_CONSUMABLE_STATUSES,
  PRO_ENTITLEMENT_RPC,
  PRO_GRACE_MS,
  PRO_LIVE_STATUSES,
  proGrantRefusal,
  proRowIsLive,
  proStandingFrom,
  type GrantRefusal,
  type ProGrantLike,
  type ProRow,
  type ProStanding,
} from "./pro-standing.ts";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  standingFrom,
  statusRank,
  type SubscriptionStanding,
  type TierStanding,
} from "./subscription-standing.ts";
import { significantSubscription, subscriptionEnds } from "./pro-cancel.ts";

export const PRO_PRICE_CENTS = 4500;
export const PRO_PRODUCT_NAME = "Resume Booster Pro";

export interface ProStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  /**
   * The account that bought the subscription the answer rests on: the user id
   * the signed-in subscription checkouts stamp on
   * subscription_data.metadata.user_id. null for a plan bought before the
   * stamp (or made in the Stripe dashboard without one).
   */
  boundUserId?: string | null;
  /** "address": Stripe lists the customer for the address. "customer": it lists none, and this is the customer the address's row names (S14). */
  matchedBy?: "address" | "customer";
}

/** One customer's plan, read by its id. */
export type CustomerPlan = ProStatus & { matchedBy: "customer"; cancelAtPeriodEnd: boolean };

const ACTIVE_STATUSES = LIVE_SUBSCRIPTION_STATUSES;
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Stripe customer id, as a cache row stores it. */
export function isStripeCustomerId(v: unknown): v is string {
  return typeof v === "string" && /^cus_[A-Za-z0-9]+$/.test(v);
}

type CustomerWithSubs = { id: string; subscriptions: Stripe.Subscription[] };

/** Stripe API 2025+ moved current_period_end onto the items: whichever is populated. */
function periodEndOf(sub: Stripe.Subscription): number | undefined {
  return (sub as unknown as { current_period_end?: number }).current_period_end
    ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
}

/** Every subscription one customer holds, in any status. Paged, not truncated (stripe-paging.ts). */
function subscriptionsOf(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  return listAll<Stripe.Subscription>((startingAfter) => stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  }));
}

/** Every customer the address has in Stripe, each with every subscription it holds. Paged. */
async function customersWithSubscriptions(stripe: Stripe, normalized: string): Promise<CustomerWithSubs[]> {
  // Paged, not truncated — see _shared/stripe-paging.ts. limit: 100 keeps the
  // common case at one round trip.
  const customers = await listAll<Stripe.Customer>((startingAfter) => stripe.customers.list({
    email: normalized,
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  }));
  const out: CustomerWithSubs[] = [];
  for (const customer of customers) {
    out.push({ id: customer.id, subscriptions: await subscriptionsOf(stripe, customer.id) });
  }
  return out;
}

/**
 * What this address holds, per tier, in ONE pass over Stripe — for the two
 * subscription checkouts' double-billing guard. Call it only for a signed-in
 * caller's own address (see _shared/subscription-standing.ts).
 */
export async function subscriptionStandingByEmail(stripe: Stripe, email: string): Promise<SubscriptionStanding> {
  return standingFrom(await customersWithSubscriptions(stripe, email.trim().toLowerCase()), isAgentPriced);
}

type TableClient = Parameters<typeof checkProByEmail>[1];

// S14 (M-S14-002, M-S14-006): a plan is also kept by the CUSTOMER its row
// names, since Stripe finds a customer only by its current email. Cases:
// src/test/a-pro-member-who-changes-their-billing-email-in-stripe-keeps-pro-the-portal-and-no-second-plan.test.ts.

/** The customers this account's own bound Pro or agent rows name, newest first (at most 5); a failed read names none. */
export async function boundCustomersOf(db: TableClient, userId: string): Promise<string[]> {
  if (!USER_ID_RE.test(userId)) return [];
  const out: string[] = [];
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    try {
      const { data, error } = await db.from(table).select("stripe_customer_id, updated_at")
        .eq("user_id", userId).order("updated_at", { ascending: false }).limit(10);
      if (error || !Array.isArray(data)) continue;
      for (const row of data as Array<{ stripe_customer_id?: unknown }>) {
        if (isStripeCustomerId(row.stripe_customer_id) && !out.includes(row.stripe_customer_id)) out.push(row.stripe_customer_id);
      }
    } catch (_) { /* unread names none */ }
  }
  return out.slice(0, 5);
}

function stronger(a: TierStanding | null, b: TierStanding | null): TierStanding | null {
  if (!a || !b) return a ?? b;
  return statusRank(b.status) > statusRank(a.status) ? b : a;
}

/** The double-billing guard over the account: the address's standing plus its bound customers' plans. Billing (reuseCustomerId) stays the address's; an unreadable customer refuses nothing. */
export async function accountSubscriptionStanding(
  stripe: Stripe,
  db: TableClient,
  buyer: { id: string; email: string },
): Promise<SubscriptionStanding> {
  const customers = await customersWithSubscriptions(stripe, buyer.email.trim().toLowerCase());
  const address = standingFrom(customers, isAgentPriced);
  const listed = new Set(customers.map((c) => c.id));
  const own: CustomerWithSubs[] = [];
  for (const id of await boundCustomersOf(db, buyer.id)) {
    if (listed.has(id)) continue;
    listed.add(id);
    try {
      own.push({ id, subscriptions: await subscriptionsOf(stripe, id) });
    } catch (_) { /* skipped */ }
  }
  if (!own.length) return address;
  const bound = standingFrom(own, isAgentPriced);
  return {
    pro: stronger(address.pro, bound.pro),
    agent: stronger(address.agent, bound.agent),
    reuseCustomerId: address.reuseCustomerId,
    hadTrialOrAgent: address.hadTrialOrAgent || bound.hadTrialOrAgent,
  };
}

function customerPlanOf(customerId: string, sub: Stripe.Subscription | null, none = "inactive"): CustomerPlan {
  const live = !!sub && ACTIVE_STATUSES.has(sub.status);
  const periodEnd = sub ? periodEndOf(sub) : undefined;
  return {
    active: live,
    status: sub?.status ?? none,
    currentPeriodEnd: live && periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    stripeCustomerId: customerId,
    boundUserId: sub ? subscriptionBuyer(sub) : null,
    matchedBy: "customer",
    cancelAtPeriodEnd: live && !!sub && subscriptionEnds(sub),
  };
}

/** One customer's plan, read by id: its most significant subscription; "canceled" once the customer is deleted; null when Stripe could not be read. */
export async function customerPlan(stripe: Stripe, customerId: string): Promise<CustomerPlan | null> {
  if (!isStripeCustomerId(customerId)) return null;
  try {
    return customerPlanOf(customerId, significantSubscription(await subscriptionsOf(stripe, customerId)));
  } catch (_) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if ((customer as { deleted?: boolean }).deleted) return customerPlanOf(customerId, null, "canceled");
    } catch (_) { /* unread */ }
    return null;
  }
}

/** A customer's plan onto the rows naming it, each only as it was read (updated_at). Never clears the customer. */
async function writeCustomerPlan(db: TableClient, plan: CustomerPlan, rows: ReadonlyArray<{ email: string; updated_at: string }>): Promise<number> {
  let written = 0;
  for (const row of rows) {
    try {
      const { data, error } = await db.from("pro_subscribers")
        .update({
          status: plan.status || "inactive",
          current_period_end: plan.currentPeriodEnd,
          updated_at: new Date().toISOString(),
          ...(plan.boundUserId ? { user_id: plan.boundUserId } : {}),
        })
        .eq("email", row.email).eq("stripe_customer_id", plan.stripeCustomerId).eq("updated_at", row.updated_at)
        .select("email");
      if (error || !Array.isArray(data) || data.length === 0) continue;
      written++;
      // Its own write, so a database without the column still takes the status.
      await db.from("pro_subscribers").update({ cancel_at_period_end: plan.cancelAtPeriodEnd })
        .eq("email", row.email).eq("stripe_customer_id", plan.stripeCustomerId);
    } catch (_) { /* best-effort, like the rest of the cache */ }
  }
  return written;
}

/**
 * Whether a row may be kept by its customer, wherever its address now is: it
 * is bound to an account, or the plan names its buyer (the write binds it).
 * An unbound row is handed by pro_entitlement_rows to whoever proves its
 * mailbox, so a customer that left the address must not keep it live for
 * them (review of M-S14-002): it is left to its address, as before S14.
 */
function followedByCustomer(row: { user_id?: unknown }, plan: CustomerPlan): boolean {
  return (typeof row.user_id === "string" && row.user_id !== "") || !!plan.boundUserId;
}

/** Every Pro row that names this customer and is bound to an account (or that its plan's buyer binds), refreshed from Stripe by its id, whatever address the row is kept under. */
export async function refreshCustomerRows(stripe: Stripe, db: TableClient, customerId: string): Promise<{ rows: number; plan: CustomerPlan | null }> {
  if (!isStripeCustomerId(customerId)) return { rows: 0, plan: null };
  let rows: Array<{ email: string; updated_at: string; user_id: unknown }>;
  try {
    const { data, error } = await db.from("pro_subscribers").select("email, updated_at, user_id").eq("stripe_customer_id", customerId);
    if (error || !Array.isArray(data) || !data.length) return { rows: 0, plan: null };
    rows = (data as Array<{ email?: unknown; updated_at?: unknown; user_id?: unknown }>)
      .filter((r) => typeof r.email === "string" && r.email)
      .map((r) => ({ email: r.email as string, updated_at: String(r.updated_at), user_id: r.user_id ?? null }));
  } catch (_) {
    return { rows: 0, plan: null };
  }
  const plan = await customerPlan(stripe, customerId);
  if (!plan) return { rows: 0, plan: null };
  return { rows: await writeCustomerPlan(db, plan, rows.filter((r) => followedByCustomer(r, plan))), plan };
}

export interface FollowedAddress { moved: number; left: number; failed: boolean }

/** customer.updated: rows bound to ONE account move to the new email when it has no row; others stay (still refreshed by customer). Unbound rows never move. */
export async function followCustomerEmail(db: TableClient, customerId: string, newEmail: string | null | undefined): Promise<FollowedAddress> {
  const out: FollowedAddress = { moved: 0, left: 0, failed: false };
  const to = typeof newEmail === "string" ? newEmail.trim().toLowerCase() : "";
  if (!isStripeCustomerId(customerId) || !to.includes("@")) return out;
  let rows: Array<{ email?: unknown; user_id?: unknown }>;
  try {
    const { data, error } = await db.from("pro_subscribers").select("email, user_id").eq("stripe_customer_id", customerId);
    if (error) return { ...out, failed: true };
    rows = Array.isArray(data) ? data : [];
  } catch (_) {
    return { ...out, failed: true };
  }
  const bound = rows.filter((r) => typeof r.user_id === "string" && r.user_id && typeof r.email === "string" && r.email !== to);
  const owners = new Set(bound.map((r) => String(r.user_id)));
  if (owners.size !== 1) return { ...out, left: bound.length };
  for (const row of bound) {
    try {
      const { data: target, error: readError } = await db.from("pro_subscribers").select("email").eq("email", to).maybeSingle();
      if (readError) { out.failed = true; continue; }
      if (target) { out.left++; continue; }
      // The address is the primary key: a row written there meanwhile refuses the move (23505).
      const { data, error } = await db.from("pro_subscribers").update({ email: to })
        .eq("email", row.email).eq("stripe_customer_id", customerId).eq("user_id", row.user_id).select("email");
      if (error) out.failed = true;
      else if (Array.isArray(data) && data.length) out.moved++;
    } catch (_) {
      out.failed = true;
    }
  }
  return out;
}

export interface ProRefreshOptions {
  /**
   * For a caller that read the cache row before asking Stripe
   * (check-subscription): the updated_at it saw, or null for no row. Given,
   * the downgrade applies only to THAT row -- one the webhook wrote while
   * Stripe was being asked is newer evidence than this lookup, and was being
   * overwritten with "inactive" (2026-10-05 review) -- and null means there is
   * nothing to downgrade. Omitted, the row as it reads now. A row naming a
   * Stripe customer is refreshed by that customer instead (S14).
   */
  seenUpdatedAt?: string | null;
}

/**
 * Look up the subscription state for an email directly in Stripe and refresh
 * the pro_subscribers cache. `supabase` must be a service-role client.
 *
 * The answer is the MOST SIGNIFICANT subscription the address holds: a live
 * one, else one that owes money (past_due, unpaid...), else whatever ended.
 * It used to keep the first non-live status it met, so a past_due plan could
 * read as "canceled" because a canceled one was listed first, and the card
 * that should have said "update your card" said "Go Pro".
 *
 * NO ROW IS CREATED FOR AN ADDRESS STRIPE HAS NO SUBSCRIPTION FOR. The upsert
 * used to run whatever the answer, so the checkout's own pre-check wrote an
 * "inactive" row for every first-time buyer minutes before they paid, and
 * check-subscription served that row as the truth for an hour after they had
 * (platform sweep L6-28). An existing row is still downgraded (see
 * ProRefreshOptions); a missing one stays missing until the webhook writes it
 * when the payment lands.
 *
 * A ROW BOUND TO AN ACCOUNT IS NEVER CLEARED BECAUSE THE ADDRESS FOUND
 * NOTHING (S14, M-S14-002): it is refreshed by the customer it names, and the
 * answer is that customer's plan (matchedBy "customer"). So is an unbound
 * row whose plan names its buyer: the write binds it to that account. Any
 * other unbound row (one pro_entitlement_rows hands to whoever proves the
 * address) whose customer has left the address is downgraded as it was read,
 * the customer kept on it, and so is a row naming no customer.
 */
export async function checkProByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
  opts: ProRefreshOptions = {},
): Promise<ProStatus> {
  const normalized = email.trim().toLowerCase();
  let result: ProStatus = { active: false, status: "inactive", currentPeriodEnd: null, stripeCustomerId: null };

  for (const customer of await customersWithSubscriptions(stripe, normalized)) {
    for (const sub of customer.subscriptions) {
      if (statusRank(sub.status) <= statusRank(result.stripeCustomerId ? result.status : null)) continue;
      const periodEnd = periodEndOf(sub);
      const live = ACTIVE_STATUSES.has(sub.status);
      result = {
        active: live,
        status: sub.status,
        currentPeriodEnd: live && periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        stripeCustomerId: customer.id,
        boundUserId: subscriptionBuyer(sub),
        matchedBy: "address",
      };
    }
    if (result.active) break;
  }

  const cached = {
    stripe_customer_id: result.stripeCustomerId,
    status: result.status || "inactive",
    current_period_end: result.currentPeriodEnd,
    updated_at: new Date().toISOString(),
  };
  if (result.stripeCustomerId) {
    try {
      // AND WHOSE IT IS (20261008130000): a plan that carries its buyer's user
      // id binds the row to that account, which is how every gate reads it
      // (pro_entitlement_rows). The id is never cleared here: an unstamped
      // plan leaves whatever binding the row already has.
      await supabase.from("pro_subscribers").upsert({
        email: normalized,
        ...cached,
        ...(result.boundUserId ? { user_id: result.boundUserId } : {}),
      });
    } catch (_) {
      // Cache refresh is best-effort; the caller already has the live answer.
    }
    return result;
  }

  // No subscription anywhere in Stripe for this address. No row was seen:
  // nothing to refresh or downgrade, and none is created.
  if (opts.seenUpdatedAt === null) return result;
  let row: { stripe_customer_id?: unknown; updated_at?: unknown; user_id?: unknown } | null;
  try {
    const { data, error } = await supabase.from("pro_subscribers").select("stripe_customer_id, updated_at, user_id").eq("email", normalized).maybeSingle();
    if (error) return result;
    row = data ?? null;
  } catch (_) {
    return result;
  }
  if (!row) return result;
  const seen = String(row.updated_at);
  // The caller read another row: one written while Stripe was being asked is
  // newer evidence than this lookup.
  if (typeof opts.seenUpdatedAt === "string" && seen !== opts.seenUpdatedAt) return result;
  if (isStripeCustomerId(row.stripe_customer_id)) {
    const plan = await customerPlan(stripe, row.stripe_customer_id);
    if (!plan) return result;
    if (followedByCustomer(row, plan)) {
      await writeCustomerPlan(supabase, plan, [{ email: normalized, updated_at: seen }]);
      return plan;
    }
  }
  try {
    // A row naming no customer, or an unbound one whose customer has left
    // this address: downgraded, as read, never created. The customer it
    // names is kept, so the row is still found if the address comes back.
    await supabase.from("pro_subscribers").update({
      ...(isStripeCustomerId(row.stripe_customer_id) ? {} : { stripe_customer_id: null }),
      status: cached.status,
      current_period_end: cached.current_period_end,
      updated_at: cached.updated_at,
    }).eq("email", normalized).eq("updated_at", seen);
  } catch (_) {
    // Cache refresh is best-effort; the caller already has the live answer.
  }
  return result;
}
