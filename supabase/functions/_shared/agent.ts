import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  ACTIVE_SUBSCRIBER_STATUSES,
  ENTITLEMENT_COLUMNS,
  entitledFromRows,
  normalizeEmail,
  rowIsEntitled,
} from "./agent-entitlement.ts";
import { listAll } from "./stripe-paging.ts";
export { ENTITLEMENT_COLUMNS, entitledFromRows, rowIsEntitled };
export const AGENT_PRICE_CENTS = 9900;
export const AGENT_PRODUCT_NAME = "Resume Booster Apply Agent — Morning Queue";
export interface AgentStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}
const ACTIVE_STATUSES = ACTIVE_SUBSCRIBER_STATUSES;
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
        };
        break;
      }
      if (result.status === "inactive") {
        result = { active: false, status: sub.status, currentPeriodEnd: null, stripeCustomerId: customer.id };
      }
    }
    if (result.active) break;
  }
  if (!result.active) {
    try {
      const { data: manual } = await supabase
        .from("agent_subscribers")
        .select(ENTITLEMENT_COLUMNS)
        .eq("email", normalized)
        .is("stripe_customer_id", null)
        .maybeSingle();
      if (rowIsEntitled(manual)) {
        return {
          active: true,
          status: "comped",
          currentPeriodEnd: (manual as { current_period_end?: string | null })?.current_period_end ?? null,
          stripeCustomerId: null,
        };
      }
    } catch (_) {
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
      await supabase.from("agent_subscribers").upsert({ email: normalized, ...cached });
    } else {
      const { stripe_customer_id: _keepWhateverStripeIdIsThere, ...cachedDowngrade } = cached;
      await supabase.from("agent_subscribers").update(cachedDowngrade)
        .eq("email", normalized).not("stripe_customer_id", "is", null);
    }
  } catch (_) {
  }
  return result;
}