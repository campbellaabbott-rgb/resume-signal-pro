// Shared helpers for the Apply Agent ($99/month Morning Queue subscription).
// Mirrors _shared/pro.ts: Stripe is the source of truth; agent_subscribers is
// the service-role cache the nightly runner trusts. Unlike the Pro check
// (any active subscription qualifies), the agent check is PRICE-SPECIFIC —
// a $45 Pro sub must not unlock the $99 agent. The converse is deliberate:
// an agent subscriber passes the generic Pro check too, so $99 includes Pro.

import Stripe from "https://esm.sh/stripe@18.5.0";

export const AGENT_PRICE_CENTS = 9900;
export const AGENT_PRODUCT_NAME = "Resume Booster Apply Agent — Morning Queue";

export interface AgentStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export async function checkAgentByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
): Promise<AgentStatus> {
  const normalized = email.trim().toLowerCase();
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

  try {
    await supabase.from("agent_subscribers").upsert({
      email: normalized,
      stripe_customer_id: result.stripeCustomerId,
      status: result.active ? result.status : result.status || "inactive",
      current_period_end: result.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {
    // Cache refresh is best-effort; the caller already has the live answer.
  }

  return result;
}
