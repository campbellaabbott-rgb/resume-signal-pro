// WHAT AN ADDRESS ALREADY HOLDS IN STRIPE, AND WHAT A NEW SUBSCRIPTION
// CHECKOUT MAY DO ABOUT IT.
//
// Pure, no imports: create-subscription-checkout, create-agent-checkout and
// check-subscription share it through _shared/pro.ts, and the tests execute it.
//
// THREE WAYS A SECOND SUBSCRIPTION GOT SOLD (platform sweep 2026-10-04):
//
//   - A card declined at renewal leaves the subscription past_due. Both
//     checkout guards refused only an ACTIVE subscription, so the declined
//     customer was offered "Go Pro" again and a second subscription was
//     created; when Stripe's retry of the first then succeeded they paid twice
//     (and the agent checkout handed them a fresh seven-day trial). A
//     subscription that owes money is fixed by updating the card, never by
//     buying another one.
//   - A $45 Pro subscriber who bought the $99 agent: the agent guard looked
//     only at agent-priced subscriptions, so the Pro plan kept billing beside
//     it ($144 a month for $99 of entitlement), and the portal, which opens
//     on one Stripe customer, showed only the newer plan.
//   - Every subscription checkout created a NEW Stripe customer
//     (customer_email, never customer), which is how one address came to own
//     several customers and a portal that could not see all of them.
//
// The verdict below is the one rule both checkouts apply. It is computed only
// for a SIGNED-IN caller's own address: telling an anonymous request whether
// some address subscribes is exactly the oracle these functions were.

/** A subscription that entitles right now. */
export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/**
 * A subscription that still exists and still bills, but owes money. The way
 * out is the billing portal (update the card), never a second subscription.
 * `paused` is a trial that ended without a payment method on file.
 */
export const OWING_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid", "incomplete", "paused"]);

export function isOwingStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && OWING_SUBSCRIPTION_STATUSES.has(status);
}

/** live 3, owing 2, anything else (canceled, incomplete_expired) 1. */
export function statusRank(status: string | null | undefined): number {
  if (typeof status !== "string") return 0;
  if (LIVE_SUBSCRIPTION_STATUSES.has(status)) return 3;
  if (OWING_SUBSCRIPTION_STATUSES.has(status)) return 2;
  return 1;
}

export type SubscriptionTier = "pro" | "agent";

export interface TierStanding {
  status: string;
  live: boolean;
  owing: boolean;
  /** The customer has already cancelled; it stops billing at the period end. */
  cancelAtPeriodEnd: boolean;
  customerId: string;
}

export interface SubscriptionStanding {
  /** The most significant non-agent-priced subscription (Pro), or null. */
  pro: TierStanding | null;
  /** The most significant agent-priced subscription, or null. */
  agent: TierStanding | null;
  /**
   * The customer a NEW subscription should be billed to: the one that already
   * holds the address's most significant subscription, else the newest
   * customer the address has, else null (Stripe makes one at checkout).
   */
  reuseCustomerId: string | null;
}

export type SubscriptionLike = {
  status: string;
  cancel_at_period_end?: boolean | null;
  items?: { data?: ReadonlyArray<{ price?: unknown }> } | null;
};

export type CustomerSubscriptions = { id: string; subscriptions: ReadonlyArray<SubscriptionLike> };

/**
 * Fold every customer's subscriptions into one standing per tier.
 * `customers` arrive in Stripe's order (newest first); `isAgentPriced` is the
 * agent module's price rule, passed in so this file stays import-free.
 */
export function standingFrom(
  customers: ReadonlyArray<CustomerSubscriptions>,
  isAgentPriced: (items: ReadonlyArray<{ price?: unknown }> | null | undefined) => boolean,
): SubscriptionStanding {
  let pro: TierStanding | null = null;
  let agent: TierStanding | null = null;
  for (const customer of customers) {
    for (const sub of customer.subscriptions) {
      const candidate: TierStanding = {
        status: sub.status,
        live: LIVE_SUBSCRIPTION_STATUSES.has(sub.status),
        owing: OWING_SUBSCRIPTION_STATUSES.has(sub.status),
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        customerId: customer.id,
      };
      if (isAgentPriced(sub.items?.data)) {
        if (!agent || statusRank(candidate.status) > statusRank(agent.status)) agent = candidate;
      } else if (!pro || statusRank(candidate.status) > statusRank(pro.status)) {
        pro = candidate;
      }
    }
  }
  const strongest = [agent, pro]
    .filter((t): t is TierStanding => t !== null)
    .sort((a, b) => statusRank(b.status) - statusRank(a.status))[0];
  return {
    pro,
    agent,
    reuseCustomerId: strongest?.customerId ?? customers[0]?.id ?? null,
  };
}

export type CheckoutVerdict =
  | { kind: "proceed" }
  | { kind: "already_subscribed"; tier: SubscriptionTier }
  | { kind: "needs_payment_update"; tier: SubscriptionTier; status: string }
  | { kind: "switch_from_pro" };

/**
 * May this address start a NEW subscription to `tier`?
 *
 *   Pro checkout:   any live plan (the agent includes Pro) -> already subscribed;
 *                   any plan that owes money -> update the card first.
 *   Agent checkout: a live agent plan -> already subscribed; any plan that owes
 *                   money -> update the card first; a live Pro plan that has
 *                   not been cancelled -> refuse, because the agent would bill
 *                   beside it. A Pro plan already set to cancel at its period
 *                   end does not block: it stops billing on its own.
 */
export function checkoutVerdict(standing: SubscriptionStanding, tier: SubscriptionTier): CheckoutVerdict {
  const { pro, agent } = standing;
  if (tier === "pro") {
    if (agent?.live) return { kind: "already_subscribed", tier: "agent" };
    if (pro?.live) return { kind: "already_subscribed", tier: "pro" };
  } else if (agent?.live) {
    return { kind: "already_subscribed", tier: "agent" };
  }
  if (agent?.owing) return { kind: "needs_payment_update", tier: "agent", status: agent.status };
  if (pro?.owing) return { kind: "needs_payment_update", tier: "pro", status: pro.status };
  if (tier === "agent" && pro?.live && !pro.cancelAtPeriodEnd) return { kind: "switch_from_pro" };
  return { kind: "proceed" };
}

/** The JSON body a checkout answers for a verdict that is not "proceed". */
export function verdictBody(verdict: Exclude<CheckoutVerdict, { kind: "proceed" }>): Record<string, unknown> {
  switch (verdict.kind) {
    case "already_subscribed":
      return { alreadySubscribed: true, tier: verdict.tier };
    case "needs_payment_update":
      return {
        needsPaymentUpdate: true,
        tier: verdict.tier,
        status: verdict.status,
        error: "Your subscription has a payment due. Update your card from Manage subscription instead of starting a new one.",
      };
    case "switch_from_pro":
      return {
        hasProSubscription: true,
        error: "You already have Pro, which the agent includes. Cancel Pro from Manage subscription first (it stays on until its period ends), then start the agent, so you are never billed for both.",
      };
  }
}
