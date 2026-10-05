// Shared helpers for Resume Booster Pro ($45/month all-access subscription).
// Stripe is the source of truth; pro_subscribers is a service-role cache so
// hot paths (scan rate limits) can check status without a Stripe round trip.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { listAll } from "./stripe-paging.ts";
import { isAgentPriced } from "./agent.ts";
import {
  LIVE_SUBSCRIPTION_STATUSES,
  standingFrom,
  statusRank,
  type SubscriptionStanding,
} from "./subscription-standing.ts";

export const PRO_PRICE_CENTS = 4500;
export const PRO_PRODUCT_NAME = "Resume Booster Pro";

export interface ProStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

const ACTIVE_STATUSES = LIVE_SUBSCRIPTION_STATUSES;

type CustomerWithSubs = { id: string; subscriptions: Stripe.Subscription[] };

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
    const subscriptions = await listAll<Stripe.Subscription>((startingAfter) => stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }));
    out.push({ id: customer.id, subscriptions });
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

export interface ProRefreshOptions {
  /**
   * For a caller that read the cache row before asking Stripe
   * (check-subscription): the updated_at it saw, or null for no row. Given,
   * the downgrade applies only to THAT row -- one the webhook wrote while
   * Stripe was being asked is newer evidence than this lookup, and was being
   * overwritten with "inactive" (2026-10-05 review) -- and null means there is
   * nothing to downgrade. Omitted, the row is downgraded whatever it holds,
   * as before.
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
      // Stripe API 2025+ moved current_period_end from the subscription to
      // its items — read whichever is populated.
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
        ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
      const live = ACTIVE_STATUSES.has(sub.status);
      result = {
        active: live,
        status: sub.status,
        currentPeriodEnd: live && periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        stripeCustomerId: customer.id,
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
  try {
    if (result.stripeCustomerId) {
      await supabase.from("pro_subscribers").upsert({ email: normalized, ...cached });
    } else if (opts.seenUpdatedAt !== null) {
      // No subscription anywhere in Stripe for this address: downgrade a row
      // that exists (the one the caller saw, when it says), never create one.
      let downgrade = supabase.from("pro_subscribers").update(cached).eq("email", normalized);
      if (typeof opts.seenUpdatedAt === "string") downgrade = downgrade.eq("updated_at", opts.seenUpdatedAt);
      await downgrade;
    }
  } catch (_) {
    // Cache refresh is best-effort; the caller already has the live answer.
  }

  return result;
}

export interface ProCacheRule {
  /** Statuses that count. Default: active and trialing. */
  statuses?: ReadonlySet<string>;
  /** How long past current_period_end a row still counts. Default: a day. */
  graceMs?: number;
  /**
   * Which caches are read. Default: both, Pro then the agent tier (which
   * includes Pro). Narrowed only where the answer reaches someone who has not
   * proved who they are, so that answer reveals no more than it used to.
   */
  tables?: ReadonlyArray<"pro_subscribers" | "agent_subscribers">;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Fast cache-only check (no Stripe call) — used on hot paths like the scan
 * rate limiter, and by every function that mints or honours a Pro grant.
 * Treats a cache row as active only while the paid period has not lapsed, so
 * a canceled/stale row can't grant access forever.
 *
 * `rule` exists so a caller with a stricter rule (generate-apply-package
 * counts only `active`, with no grace) reads BOTH tables through this one
 * function instead of keeping another copy that reads only one. Which
 * statuses should count everywhere is an open owner decision (platform sweep
 * L6-08 / L6-29); the default is what the other callers already applied.
 */
export async function isProCached(
  supabase: { from: (t: string) => any },
  email: string,
  rule: ProCacheRule = {},
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const statuses = rule.statuses ?? ACTIVE_STATUSES;
  const graceMs = rule.graceMs ?? DAY_MS;
  const tables = rule.tables ?? ["pro_subscribers", "agent_subscribers"];

  const activeIn = async (table: string): Promise<boolean> => {
    const { data } = await supabase
      .from(table)
      .select("status, current_period_end")
      .eq("email", normalized)
      .maybeSingle();
    if (!data || !statuses.has(data.status)) return false;
    // A day of grace by default: Stripe's renewal webhook and this read are
    // not synchronous, and briefly locking a paying subscriber out of what
    // they just paid for is worse than briefly trusting a lapsed one.
    if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now() - graceMs) {
      return false;
    }
    return true;
  };

  try {
    if (tables.includes("pro_subscribers") && await activeIn("pro_subscribers")) return true;
    if (!tables.includes("agent_subscribers")) return false;

    // THE AGENT TIER INCLUDES PRO. It costs more ($99 vs $45) and is a superset
    // by definition — nobody pays the higher price for less.
    //
    // This was NOT true until now, and the failure was silent in the worst
    // direction: nothing writes pro_subscribers on an agent purchase, and this
    // function only read that table, so a $99 subscriber was refused Pro
    // features they had paid for. Meanwhile checkProByEmail — which lists
    // Stripe subscriptions without filtering by price — said they WERE Pro. The
    // two checks disagreed depending on which path a feature happened to call.
    //
    // Resolved by reading the agent table here rather than by writing a
    // pro_subscribers row at purchase time. Two rows describing one entitlement
    // is two things to keep in sync, and they drift on exactly the edges that
    // matter — cancellation, refund, card failure. One subscription, one row,
    // read from both places.
    return await activeIn("agent_subscribers");
  } catch (_) {
    return false;
  }
}
