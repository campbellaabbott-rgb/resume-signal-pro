// Shared helpers for the Apply Agent ($99/month Morning Queue subscription).
// Mirrors _shared/pro.ts: Stripe is the source of truth; agent_subscribers is
// the service-role cache the nightly runner trusts. Unlike the Pro check
// (any active subscription qualifies), the agent check is PRICE-SPECIFIC —
// a $45 Pro sub must not unlock the $99 agent. The converse is deliberate:
// an agent subscriber passes the generic Pro check too, so $99 includes Pro.

import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  ACTIVE_SUBSCRIBER_STATUSES,
  ENTITLEMENT_COLUMNS,
  entitledFromRows,
  normalizeEmail,
  rowIsEntitled,
} from "./agent-entitlement.ts";
import { listAll } from "./stripe-paging.ts";

// Re-exported so a consumer never has to decide which module to trust.
export { ENTITLEMENT_COLUMNS, entitledFromRows, rowIsEntitled };

export const AGENT_PRICE_CENTS = 9900;

/**
 * The free trial a FIRST-TIME agent subscriber gets, in days. Mirrored by
 * src/config/products.ts SUBSCRIPTIONS.agent.trialDays (pricing-truth reads
 * this declaration), and offered only once per customer (create-agent-checkout).
 */
export const AGENT_TRIAL_DAYS = 7;
export const AGENT_PRODUCT_NAME = "Resume Booster Apply Agent — Morning Queue";

export interface AgentStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  /**
   * The account the live subscription was bought by: the user id
   * create-agent-checkout stamps on `subscription_data.metadata.user_id`
   * from the VERIFIED session. null on a plan bought before that stamp, or on
   * anything not live.
   */
  boundUserId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The buyer's user id a subscription carries, when it is a well-formed one. */
export function subscriptionBuyer(sub: { metadata?: unknown } | null | undefined): string | null {
  const raw = (sub?.metadata as Record<string, unknown> | null | undefined)?.user_id;
  return typeof raw === "string" && UUID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

// One list, shared with every consumer. A second copy here is how the four
// readers of agent_subscribers drifted apart in the first place.
const ACTIVE_STATUSES = ACTIVE_SUBSCRIBER_STATUSES;

/**
 * Does this subscription (or invoice) bill the agent's price?
 *
 * ENTITLEMENT MATCHES ON AMOUNT, NOT ON A PRICE ID, and that is worth knowing
 * before you touch pricing: create-agent-checkout builds an inline `price_data`
 * rather than referencing a stored Price, so there is no ID to match on.
 * Consequence: ANY $99.00 subscription on this Stripe account reads as the
 * agent, and changing AGENT_PRICE_CENTS silently de-entitles every existing
 * subscriber at once. Kept as one exported function so the webhook and the
 * entitlement reader cannot drift into disagreeing about what "an agent
 * subscription" is — a second copy of that rule is how the four readers of
 * agent_subscribers diverged the first time.
 *
 * `it` is annotated explicitly because `items.data` widens to an implicit any
 * under Deno's stricter check: `deno check` failed with TS7006 on every
 * function importing this file, while `tsc` — which does not cover
 * supabase/functions — stayed green.
 */
export function isAgentPriced(
  items: ReadonlyArray<{ price?: unknown }> | null | undefined,
): boolean {
  return (items ?? []).some(
    (it: { price?: unknown }) => (it.price as { unit_amount?: number } | undefined)?.unit_amount === AGENT_PRICE_CENTS,
  );
}

/**
 * The manual grant (a comp, an internal test account, support making someone
 * whole) for this address, when one is live: a row Stripe does not own
 * (`stripe_customer_id IS NULL`) that rowIsEntitled accepts. null otherwise,
 * and null on a failed lookup -- a lookup error must never upgrade anyone.
 * The same read checkAgentByEmail makes below, for the subscription
 * checkouts, which must not sell a plan to an account that already holds one
 * by hand (they no longer call checkAgentByEmail, whose Stripe pass the
 * standing read in _shared/pro.ts now makes once for both tiers).
 */
export async function manualAgentGrant(
  supabase: { from: (t: string) => any },
  email: string,
): Promise<{ current_period_end?: string | null } | null> {
  try {
    const { data: manual } = await supabase
      .from("agent_subscribers")
      .select(ENTITLEMENT_COLUMNS)
      .eq("email", normalizeEmail(email))
      .is("stripe_customer_id", null)
      .maybeSingle();
    return rowIsEntitled(manual) ? (manual as { current_period_end?: string | null }) : null;
  } catch (_) {
    return null;
  }
}

/**
 * HAS THIS ACCOUNT EVER HELD A STRIPE-BILLED AGENT PLAN? One of the three keys
 * of the one-trial rule (the account's id, its address, the Stripe customer:
 * the last two are read from Stripe in standingFrom). A row in
 * agent_subscribers with a Stripe customer exists only for an address that
 * held an agent-priced subscription; it is bound to the buyer's account by
 * user_id. A failed read answers TRUE: when we cannot tell, no trial is
 * offered, and the checkout page shows the first charge plainly.
 */
export async function agentPlanEverHeld(
  supabase: { from: (t: string) => any },
  userId: string,
  email: string,
): Promise<boolean> {
  try {
    const byAccount = await supabase.from("agent_subscribers").select("email")
      .eq("user_id", userId).not("stripe_customer_id", "is", null).limit(1);
    const byAddress = await supabase.from("agent_subscribers").select("email")
      .eq("email", normalizeEmail(email)).not("stripe_customer_id", "is", null).limit(1);
    if (byAccount.error || byAddress.error) return true;
    return (byAccount.data?.length ?? 0) > 0 || (byAddress.data?.length ?? 0) > 0;
  } catch (_) {
    return true;
  }
}

export async function checkAgentByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
): Promise<AgentStatus> {
  const normalized = normalizeEmail(email);
  let result: AgentStatus = { active: false, status: "inactive", currentPeriodEnd: null, stripeCustomerId: null };

  // Paged, not truncated — see _shared/stripe-paging.ts. limit: 100 keeps the
  // common case at one round trip.
  const customers = await listAll<Stripe.Customer>((startingAfter) => stripe.customers.list({
    email: normalized,
    limit: 100,
    ...(startingAfter ? { starting_after: startingAfter } : {}),
  }));
  for (const customer of customers) {
    const subs = await listAll<Stripe.Subscription>((startingAfter) => stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    }));
    for (const sub of subs) {
      if (!isAgentPriced(sub.items?.data)) continue;
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
        ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
      if (ACTIVE_STATUSES.has(sub.status)) {
        result = {
          active: true,
          status: sub.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          stripeCustomerId: customer.id,
          boundUserId: subscriptionBuyer(sub),
        };
        break;
      }
      if (result.status === "inactive") {
        result = { active: false, status: sub.status, currentPeriodEnd: null, stripeCustomerId: customer.id };
      }
    }
    if (result.active) break;
  }

  // A MANUAL GRANT IS A REAL ENTITLEMENT, and this read has to honour it.
  //
  // THE BUG, found live 2026-08-02. Two paths answer "is this person entitled",
  // and they consulted different sources. agent-runner, apply-agent and
  // apply-broker read the agent_subscribers table — which is where a comp,
  // an internal test account, or support making someone whole actually lives.
  // This function asked STRIPE. So a comped account was entitled everywhere
  // except the one place it mattered: MorningQueuePanel disables its Resume
  // button on `agentActive === false`, and Resume is what sets
  // agent_mandates.active. The person could not switch their own agent on, and
  // nothing said why — the button was simply grey.
  //
  // ONLY rows Stripe does not own. `stripe_customer_id IS NULL` is precisely
  // what distinguishes a deliberate grant from a cached Stripe answer. Without
  // that filter this would resurrect every lapsed subscriber whose cached row
  // still said active, which is the opposite mistake and a far worse one.
  if (!result.active) {
    try {
      const { data: manual } = await supabase
        .from("agent_subscribers")
        .select(ENTITLEMENT_COLUMNS)
        .eq("email", normalized)
        .is("stripe_customer_id", null)
        .maybeSingle();
      if (rowIsEntitled(manual)) {
        // Returned BEFORE the cache write below: there is nothing to refresh,
        // and writing would only risk overwriting the grant we just honoured.
        return {
          active: true,
          status: "comped",
          currentPeriodEnd: (manual as { current_period_end?: string | null })?.current_period_end ?? null,
          stripeCustomerId: null,
        };
      }
    } catch (_) {
      // A failed lookup must not upgrade anyone. Fall through to the Stripe
      // answer, which is already `inactive`.
    }
  }

  const cached = {
    stripe_customer_id: result.stripeCustomerId,
    status: result.active ? result.status : result.status || "inactive",
    current_period_end: result.currentPeriodEnd,
    updated_at: new Date().toISOString(),
  };

  try {
    if (result.stripeCustomerId) {
      // Stripe knows this address — cache the answer, active or lapsed.
      //
      // AND WHOSE IT IS (register 1.07). A live plan that carries its buyer's
      // user id binds the row to that account: every gate reads the row
      // through agent_subscription_rows by user id, and an unbound row answers
      // only an account that has proven the mailbox. The id is never cleared
      // here — a lapsed answer, or a plan bought before the stamp existed,
      // leaves whatever binding the row has.
      await supabase.from("agent_subscribers").upsert({
        email: normalized,
        ...cached,
        ...(result.boundUserId ? { user_id: result.boundUserId } : {}),
      });
    } else {
      // Stripe has never seen it. UPDATE, not upsert: an existing row must
      // still be downgraded (a customer deleted outright must not stay
      // entitled), but an address with no Stripe presence must not have a row
      // CREATED for it.
      //
      // This endpoint is unauthenticated and takes the email from the request
      // body, so an upsert here let anyone mint an agent_subscribers row for
      // any address they liked. That was worth nothing while every consumer
      // checked `status`, and worth a free apply-agent subscription for the two
      // consumers that only checked whether the row existed. Both halves are
      // now fixed; this is the half that stops the row appearing at all.
      //
      // AND IT ONLY TOUCHES ROWS STRIPE OWNS. A row with a null
      // stripe_customer_id was not created by this function — it is a manual
      // grant (a comp, an internal test account, support making someone whole).
      // Stripe has no opinion about those, and "Stripe has never heard of this
      // address" is not evidence that a deliberate grant should be revoked.
      //
      // Without this the downgrade was a trap: grant an account by hand, load
      // the Account page once, and the grant silently evaporates — with the
      // symptom appearing later and somewhere else entirely, as the agent
      // quietly doing nothing.
      // AND IT MUST NOT NULL OUT THE COLUMN IT FILTERS ON. `cached` carries
      // stripe_customer_id: result.stripeCustomerId, which is null on this
      // branch — so the downgrade rewrote a Stripe-owned row into one that
      // looks exactly like a manual grant, and the `.not(... is null)` guard
      // above then skipped it forever. The row was left inactive, so nobody was
      // wrongly entitled, but it became immune to every later correction and
      // indistinguishable from a comp.
      //
      // Reachable without any of the pagination story: line 71's
      // `if (!isAgentPriced(...)) continue` leaves stripeCustomerId null
      // whenever an address's Customers hold only non-agent-priced
      // subscriptions, and the deleted-Customer case lands in the same branch.
      const { stripe_customer_id: _keepWhateverStripeIdIsThere, ...cachedDowngrade } = cached;
      await supabase.from("agent_subscribers").update(cachedDowngrade)
        .eq("email", normalized).not("stripe_customer_id", "is", null);
    }
  } catch (_) {
    // Cache refresh is best-effort; the caller already has the live answer.
  }

  return result;
}
