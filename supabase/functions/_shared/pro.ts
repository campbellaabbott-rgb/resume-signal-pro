



import Stripe from "https://esm.sh/stripe@18.5.0";
import { listAll } from "./stripe-paging.ts";

export const PRO_PRICE_CENTS = 4500;
export const PRO_PRODUCT_NAME = "Resume Booster Pro";

export interface ProStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);





export async function checkProByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
): Promise<ProStatus> {
  const normalized = email.trim().toLowerCase();
  let result: ProStatus = { active: false, status: "inactive", currentPeriodEnd: null, stripeCustomerId: null };

  
  
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
    await supabase.from("pro_subscribers").upsert({
      email: normalized,
      stripe_customer_id: result.stripeCustomerId,
      status: result.active ? result.status : result.status || "inactive",
      current_period_end: result.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {
    
  }

  return result;
}






export async function isProCached(
  supabase: { from: (t: string) => any },
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();

  const activeIn = async (table: string): Promise<boolean> => {
    const { data } = await supabase
      .from(table)
      .select("status, current_period_end")
      .eq("email", normalized)
      .maybeSingle();
    if (!data || !ACTIVE_STATUSES.has(data.status)) return false;
    
    
    
    if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now() - 24 * 3600 * 1000) {
      return false;
    }
    return true;
  };

  try {
    if (await activeIn("pro_subscribers")) return true;

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    return await activeIn("agent_subscribers");
  } catch (_) {
    return false;
  }
}
