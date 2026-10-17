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
} from "./subscription-standing.ts";

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
        boundUserId: subscriptionBuyer(sub),
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
      // AND WHOSE IT IS (20261008130000): a plan that carries its buyer's user
      // id binds the row to that account, which is how every gate reads it
      // (pro_entitlement_rows). The id is never cleared here: an unstamped
      // plan leaves whatever binding the row already has.
      await supabase.from("pro_subscribers").upsert({
        email: normalized,
        ...cached,
        ...(result.boundUserId ? { user_id: result.boundUserId } : {}),
      });
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
