// A PLAN THAT BEGAN WITH A TRIAL MINTS NOTHING UNTIL ITS FIRST REAL PAYMENT
// (S12-098, wave 4 round 2, checkout-catalogue).
//
// At a trial's end Stripe moves the subscription from trialing to active and
// only then finalises and charges the first invoice, about an hour later.
// Through that hour the cache reads "active", so the one rule
// (pro-standing.ts) let the account mint consumables (a Pro grant, the Full
// Analysis), and if the card then declined the grants already redeemed were
// kept. The checkouts that mint now ask Stripe first: a live subscription
// that had a trial counts only once an invoice with money in it is paid.
// A subscription with no trial, or a comped plan with no Stripe customer, is
// unaffected.
//
// Pure apart from the clients it is handed; the decision itself
// (planPaidFrom) is a plain function the tests run on Stripe-shaped objects.

type SubLike = { id: string; status: string; trial_end?: number | null; trial_start?: number | null };
type InvoiceLike = { amount_paid?: number | null; status?: string | null };

/** Has this live subscription been paid for with money (or never had a trial)? */
export function subscriptionPaid(sub: SubLike, paidInvoices: readonly InvoiceLike[]): boolean {
  const hadTrial = (typeof sub.trial_end === "number" && sub.trial_end > 0) || (typeof sub.trial_start === "number" && sub.trial_start > 0);
  if (!hadTrial) return true;
  return paidInvoices.some((i) => (i.status ?? "paid") === "paid" && typeof i.amount_paid === "number" && i.amount_paid > 0);
}

export type PlanPaid = "paid" | "unpaid" | "unknown";

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };
type StripeLike = {
  subscriptions: { list: (p: Record<string, unknown>) => Promise<{ data: SubLike[] }> };
  invoices: { list: (p: Record<string, unknown>) => Promise<{ data: InvoiceLike[] }> };
};

/** The Stripe customers the account's bound cache rows name. */
async function boundCustomers(db: TableClient, userId: string): Promise<string[] | null> {
  const out = new Set<string>();
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    try {
      const { data, error } = await db.from(table).select("stripe_customer_id").eq("user_id", userId);
      if (error) return null;
      for (const r of Array.isArray(data) ? data : []) {
        if (typeof r?.stripe_customer_id === "string" && r.stripe_customer_id.startsWith("cus_")) out.add(r.stripe_customer_id);
      }
    } catch (_) {
      return null;
    }
  }
  return [...out];
}

/**
 * May the account's live plan mint a consumable now? "paid" when some live
 * subscription is paid for (or there is no Stripe customer to ask: a comped
 * plan), "unpaid" when every live subscription is a converted trial whose
 * first real invoice is not paid yet, "unknown" when a read failed.
 */
export async function planPaid(stripe: StripeLike, db: TableClient, userId: string): Promise<PlanPaid> {
  const customers = await boundCustomers(db, userId);
  if (customers === null) return "unknown";
  if (customers.length === 0) return "paid";
  try {
    let sawLive = false;
    for (const customer of customers) {
      const subs = (await stripe.subscriptions.list({ customer, status: "active", limit: 10 })).data ?? [];
      for (const sub of subs) {
        sawLive = true;
        const hadTrial = (typeof sub.trial_end === "number" && sub.trial_end > 0) || (typeof sub.trial_start === "number" && sub.trial_start > 0);
        if (!hadTrial) return "paid";
        const invoices = (await stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 10 })).data ?? [];
        if (subscriptionPaid(sub, invoices)) return "paid";
      }
    }
    // No live subscription on the bound customers: the cache's live row is a
    // comped grant or a race with the webhook; the cache already said live.
    return sawLive ? "unpaid" : "paid";
  } catch (_) {
    return "unknown";
  }
}

/** The answer a minting checkout gives an "unpaid" plan: buy it, or wait for the payment. */
export const UNPAID_PLAN_NOTE = "Your plan's first payment hasn't gone through yet, so included tools unlock once it has.";
