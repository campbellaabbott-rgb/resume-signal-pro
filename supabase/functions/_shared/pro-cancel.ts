// A PLAN CANCELLED IN THE PORTAL READS "ENDS", NOT "RENEWS" (S12-076; wave 4
// round 2, checkout-catalogue).
//
// Stripe's billing portal cancels a plan at the end of its period: the
// subscription stays live (active) until then with cancel_at_period_end set,
// or a cancel_at date. The Pro card read only the status and the period end,
// so after a cancel it still said "Renews <date>", and the subscriber
// cancelled again or disputed the next charge they thought was coming.
//
// check-subscription asks this module beside checkProByEmail (_shared/pro.ts,
// left unchanged so the functions that bundle it keep their builds). The
// Stripe client it hands checkProByEmail keeps the subscriptions Stripe
// listed for each customer, so the flag is read from the same answer, with
// no second Stripe call: whether the subscription the plan rests on is set
// to end. The flag is written to pro_subscribers.cancel_at_period_end
// (20261011150000), which the cached answer reads. A database without the
// column yet is written nothing.

import { LIVE_SUBSCRIPTION_STATUSES, statusRank } from "./subscription-standing.ts";

type Sub = { status: string; cancel_at_period_end?: boolean | null; cancel_at?: number | null };

/** Is this subscription set to end (cancelled at its period end, or a cancel date)? */
export function subscriptionEnds(sub: { cancel_at_period_end?: boolean | null; cancel_at?: number | null }): boolean {
  return sub.cancel_at_period_end === true || (typeof sub.cancel_at === "number" && sub.cancel_at > 0);
}

/**
 * The subscription checkProByEmail's answer rests on, among one customer's:
 * the first with the most significant status (the same comparison it makes).
 */
export function significantSubscription<S extends Sub>(subs: readonly S[]): S | null {
  let best: S | null = null;
  for (const sub of subs) {
    if (statusRank(sub.status) <= statusRank(best ? best.status : null)) continue;
    best = sub;
  }
  return best;
}

type Lister = (...args: unknown[]) => Promise<{ data?: unknown }>;

/**
 * The same Stripe client, except that every page its subscriptions.list
 * answers is also kept, by the customer it was asked for. Built by
 * prototype, not copied: every other member is the original's.
 */
export function recordingSubscriptions<S extends { subscriptions: unknown }>(stripe: S): { stripe: S; seen: Map<string, Sub[]> } {
  const seen = new Map<string, Sub[]>();
  const original = stripe.subscriptions as { list: Lister };
  const list: Lister = async (...args) => {
    const page = await original.list(...args);
    const customer = (args[0] as { customer?: unknown } | undefined)?.customer;
    const data = (page as { data?: unknown })?.data;
    if (typeof customer === "string" && Array.isArray(data)) seen.set(customer, [...(seen.get(customer) ?? []), ...(data as Sub[])]);
    return page;
  };
  const subscriptions = Object.create(original as object, { list: { value: list } });
  return { stripe: Object.create(stripe as object, { subscriptions: { value: subscriptions } }) as S, seen };
}

/**
 * Whether the live plan of this customer is set to end, from the pages
 * recordingSubscriptions kept. false for no live plan; null when nothing was
 * listed for the customer (the caller keeps what it had).
 */
export function cancelFlagFrom(seen: ReadonlyMap<string, readonly Sub[]>, customerId: string | null | undefined): boolean | null {
  if (typeof customerId !== "string" || !seen.has(customerId)) return null;
  const sub = significantSubscription(seen.get(customerId) ?? []);
  return !!sub && LIVE_SUBSCRIPTION_STATUSES.has(sub.status) && subscriptionEnds(sub);
}

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

/** Write the flag onto the address's cache row, if there is one. Never throws. */
export async function cacheCancelFlag(db: TableClient, email: string, ends: boolean): Promise<void> {
  try {
    await db.from("pro_subscribers").update({ cancel_at_period_end: ends }).eq("email", email.trim().toLowerCase());
  } catch (_) {
    // Best-effort, like the rest of the cache: the caller already has the live answer.
  }
}
