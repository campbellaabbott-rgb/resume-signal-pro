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

// Re-exported so a consumer never has to decide which module to trust.
export { ENTITLEMENT_COLUMNS, entitledFromRows, rowIsEntitled };

export const AGENT_PRICE_CENTS = 9900;
export const AGENT_PRODUCT_NAME = "Resume Booster Apply Agent — Morning Queue";

export interface AgentStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
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

export async function checkAgentByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
): Promise<AgentStatus> {
  const normalized = normalizeEmail(email);
  let result: AgentStatus = { active: false, status: "inactive", currentPeriodEnd: null, stripeCustomerId: null };

  const customers = await stripe.customers.list({ email: normalized, limit: 5 });
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
    for (const sub of subs.data) {
      if (!isAgentPriced(sub.items?.data)) continue;
      const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
        ?? (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
      if (ACTIVE_STATUSES.has(sub.status)) {
        result = {
          active: true,
          status: sub.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          stripeCustomerId: customer.id,
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
      await supabase.from("agent_subscribers").upsert({ email: normalized, ...cached });
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
      await supabase.from("agent_subscribers").update(cached)
        .eq("email", normalized).not("stripe_customer_id", "is", null);
    }
  } catch (_) {
    // Cache refresh is best-effort; the caller already has the live answer.
  }

  return result;
}
