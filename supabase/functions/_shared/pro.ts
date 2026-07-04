// Shared helpers for Resume Booster Pro ($45/month all-access subscription).
// Stripe is the source of truth; pro_subscribers is a service-role cache so
// hot paths (scan rate limits) can check status without a Stripe round trip.

import Stripe from "https://esm.sh/stripe@18.5.0";

export const PRO_PRICE_CENTS = 4500;
export const PRO_PRODUCT_NAME = "Resume Booster Pro";

export interface ProStatus {
  active: boolean;
  status: string;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * Look up the subscription state for an email directly in Stripe and refresh
 * the pro_subscribers cache. `supabase` must be a service-role client.
 */
export async function checkProByEmail(
  stripe: Stripe,
  supabase: { from: (t: string) => any },
  email: string,
): Promise<ProStatus> {
  const normalized = email.trim().toLowerCase();
  let result: ProStatus = { active: false, status: "inactive", currentPeriodEnd: null, stripeCustomerId: null };

  const customers = await stripe.customers.list({ email: normalized, limit: 5 });
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, status: "all", limit: 10 });
    for (const sub of subs.data) {
      if (ACTIVE_STATUSES.has(sub.status)) {
        result = {
          active: true,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null,
          stripeCustomerId: customer.id,
        };
        break;
      }
      // Keep the most informative non-active status for the cache
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
    // Cache refresh is best-effort; the caller already has the live answer.
  }

  return result;
}

/**
 * Fast cache-only check (no Stripe call) — used on hot paths like the scan
 * rate limiter. Treats a cache row as active only while the paid period has
 * not lapsed, so a canceled/stale row can't grant access forever.
 */
export async function isProCached(
  supabase: { from: (t: string) => any },
  email: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("pro_subscribers")
      .select("status, current_period_end")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (!data || !ACTIVE_STATUSES.has(data.status)) return false;
    if (data.current_period_end && new Date(data.current_period_end).getTime() < Date.now() - 24 * 3600 * 1000) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}
