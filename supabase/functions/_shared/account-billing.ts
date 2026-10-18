/**
 * THE PLANS AN ACCOUNT PAYS FOR, FOUND BY THE ACCOUNT AND NOT BY ITS CURRENT
 * ADDRESS (S12-053, S12-097; plan CP-048).
 *
 * delete-account looked a subscriber's plans up as Stripe customers holding
 * the account's CURRENT email address. After an email change (applied at once
 * while sign-ups are auto-confirmed) that search found nothing: the delete
 * said success and the $45 plan kept charging a deleted account. And a legacy
 * plan (bought before checkouts stamped metadata.user_id) that the database
 * already binds to the account through a pro_subscribers or agent_subscribers
 * row was refused as "not linked to this account".
 *
 * Plans are now found three ways, and a failure of any one is a failure of
 * the whole read (the caller refuses rather than delete while a plan bills):
 *   1. Stripe customers holding the account's current address;
 *   2. the stripe_customer_id of every pro_subscribers / agent_subscribers row
 *      bound to the account (user_id), whatever address the row carries;
 *   3. a Stripe subscription search for metadata.user_id = the account.
 * Each customer's subscriptions are read in full (every status, every page).
 *
 * classifyPlans then says which the account may cancel: a plan that names the
 * account; an unnamed plan on a customer a bound row names (the proof the
 * billing portal accepts, S11-015); an unnamed plan on the address when the
 * session proved that mailbox. A plan naming another account is never
 * touched; an unnamed, unproven plan already set to end at its period end
 * charges nothing more and does not block the delete.
 *
 * create-portal-session (checkout-catalogue's file) should read the same
 * customers; this module is import-light so it can.
 * Imports only the pure pager, so the Node tests import it directly.
 */
import { listAll } from "./stripe-paging.ts";

/** Statuses Stripe can still charge, or will charge once a card works. */
export const BILLABLE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

export type BillingSub = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  metadata?: Record<string, unknown> | null;
  cancel_at_period_end?: boolean | null;
};

type Page<T> = { data: T[]; has_more: boolean; next_page?: string | null };

/** The slice of the Stripe client this module uses. */
export type BillingStripe = {
  customers: { list: (p: Record<string, unknown>) => Promise<Page<{ id: string }>> };
  subscriptions: {
    list: (p: Record<string, unknown>) => Promise<Page<BillingSub>>;
    search: (p: Record<string, unknown>) => Promise<Page<BillingSub>>;
  };
};

// deno-lint-ignore no-explicit-any
export type BillingDb = { from: (t: string) => any };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account a subscription names in metadata.user_id, or null. */
export function planBuyer(s: BillingSub): string | null {
  const raw = s?.metadata?.user_id;
  return typeof raw === "string" && UUID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

/** A subscription's customer id, expanded or not. */
export function planCustomer(s: BillingSub): string | null {
  const c = s?.customer;
  return typeof c === "string" ? c : c && typeof c.id === "string" ? c.id : null;
}

/** The Stripe customers rows bound to this account name. Throws when a table cannot be read. */
export async function rowBoundCustomers(db: BillingDb, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const table of ["pro_subscribers", "agent_subscribers"]) {
    const { data, error } = await db.from(table).select("stripe_customer_id").eq("user_id", userId);
    if (error) throw new Error(`${table} unreadable: ${String((error as { message?: string }).message ?? error).slice(0, 120)}`);
    for (const r of (data ?? []) as Array<{ stripe_customer_id?: unknown }>) {
      if (typeof r.stripe_customer_id === "string" && r.stripe_customer_id) out.add(r.stripe_customer_id);
    }
  }
  return out;
}

/**
 * Every billable plan reachable from the account: by address, by bound row,
 * and by metadata.user_id. Throws on any failed read.
 */
export async function plansOfAccount(
  stripe: BillingStripe,
  db: BillingDb,
  user: { id: string; email?: string | null },
): Promise<{ plans: BillingSub[]; boundCustomers: Set<string> }> {
  const email = String(user.email ?? "").trim().toLowerCase();
  const customers = new Set<string>();
  if (email.includes("@")) {
    const byAddress = await listAll<{ id: string }>((after) => stripe.customers.list({ email, limit: 100, ...(after ? { starting_after: after } : {}) }));
    for (const c of byAddress) customers.add(c.id);
  }
  const boundCustomers = await rowBoundCustomers(db, user.id);
  for (const c of boundCustomers) customers.add(c);

  const plans = new Map<string, BillingSub>();
  for (const c of customers) {
    const subs = await listAll<BillingSub>((after) => stripe.subscriptions.list({ customer: c, status: "all", limit: 100, ...(after ? { starting_after: after } : {}) }));
    for (const s of subs) if (BILLABLE_STATUSES.has(s.status)) plans.set(s.id, s);
  }
  // Plans that name the account, on any customer and any address.
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await stripe.subscriptions.search({
      query: `metadata['user_id']:'${user.id.toLowerCase()}'`,
      limit: 100,
      ...(page ? { page } : {}),
    });
    for (const s of res.data ?? []) if (BILLABLE_STATUSES.has(s.status)) plans.set(s.id, s);
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  return { plans: [...plans.values()], boundCustomers };
}

/** Which plans this account may cancel, and which block the delete until cancelled elsewhere. */
export function classifyPlans(
  plans: BillingSub[],
  opts: { userId: string; boundCustomers: Set<string>; mailboxProven: boolean },
): { mine: BillingSub[]; blocking: BillingSub[] } {
  const uid = opts.userId.toLowerCase();
  const mine: BillingSub[] = [];
  const blocking: BillingSub[] = [];
  for (const s of plans) {
    const buyer = planBuyer(s);
    if (buyer === uid) { mine.push(s); continue; }
    if (buyer) continue; // another account's plan: never touched
    const customer = planCustomer(s);
    if ((customer && opts.boundCustomers.has(customer)) || opts.mailboxProven) { mine.push(s); continue; }
    if (s.cancel_at_period_end === true) continue; // ends at its period end: charges nothing more
    blocking.push(s);
  }
  return { mine, blocking };
}
