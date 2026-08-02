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
      const isAgentSub = (sub.items?.data ?? []).some(
        (it) => (it.price as unknown as { unit_amount?: number } | undefined)?.unit_amount === AGENT_PRICE_CENTS,
      );
      if (!isAgentSub) continue;
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
