// A PRO MEMBER WHO CHANGES THEIR BILLING EMAIL IN STRIPE KEEPS PRO, REACHES
// BILLING, IS SOLD NO SECOND PLAN, AND NOBODY ELSE IS TOLD ABOUT THEIR PLAN
// (sweep S14: M-S14-002, M-S14-006, C-S14-004).
//
// Driven by one member's Stripe events at API version 2025-12-15.clover
// (src/test/fixtures/stripe-pro-billing-email-change-events.json): the first
// purchase, customer.updated with previous_attributes.email (a billing email
// changed in Stripe's portal), and the next renewal declined
// (invoice.payment_failed, customer.subscription.updated to past_due). Each
// event's object becomes the fake Stripe's state, as Stripe's own would be
// once it sent the event, and the shared modules every billing function
// bundles answer from it: _shared/pro.ts (the cache refresh, the webhook's
// by-customer refresh and address follow, the checkout's double-billing
// guard) and _shared/pro-answer.ts (what check-subscription says, which
// customer "Manage billing" opens). The handlers themselves run in vitest:
// src/test/a-pro-member-who-changes-their-billing-email-in-stripe-keeps-pro-the-portal-and-no-second-plan.test.ts.
//
// (Named *_test.ts so vitest never sweeps it; scripts/deno-tests.sh runs it.)
//
// It lives beside check-subscription, not in _shared, because job-board's
// deploy counts every byte of _shared (the upload-tally test).
//
// Run: deno test --config supabase/functions/deno.json --allow-read --allow-env supabase/functions/check-subscription/billing_email_change_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  accountSubscriptionStanding,
  boundCustomersOf,
  checkProByEmail,
  followCustomerEmail,
  refreshCustomerRows,
  subscriptionStandingByEmail,
} from "../_shared/pro.ts";
import { accountAnswer, addressOwnerOf, portalCustomerOf, type PlanRow } from "../_shared/pro-answer.ts";
import { checkoutVerdict } from "../_shared/subscription-standing.ts";

// ── the recorded events, moved to now ───────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Json = any;
const RAW: Json = JSON.parse(Deno.readTextFileSync(new URL("../../../src/test/fixtures/stripe-pro-billing-email-change-events.json", import.meta.url)));
const TIME_KEYS = new Set([
  "created", "start_date", "billing_cycle_anchor", "current_period_start", "current_period_end",
  "next_payment_attempt", "period_start", "period_end", "start", "end", "cancel_at", "canceled_at",
]);
function rebased(v: Json, offset: number): Json {
  if (Array.isArray(v)) return v.map((x) => rebased(x, offset));
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) out[k] = TIME_KEYS.has(k) && typeof x === "number" ? x + offset : rebased(x, offset);
    return out;
  }
  return v;
}
function fixture(): Json {
  return rebased(RAW, Math.floor(Date.now() / 1000) - RAW.recordedAt);
}
const M = RAW.member as { userId: string; signInEmail: string; newBillingEmail: string; customerId: string; subscriptionId: string };
const STRANGER = "00000000-0000-4000-8000-0000000014b2";

// ── a Stripe that answers from what the events said ─────────────────────────

class FakeStripe {
  customers_: Record<string, Json> = {};
  subs: Record<string, Json> = {};
  unreadable = new Set<string>();
  calls: string[] = [];
  customers = {
    list: async ({ email }: { email: string }) => {
      this.calls.push("customers.list");
      return { data: Object.values(this.customers_).filter((c) => !c.deleted && c.email === email), has_more: false };
    },
    retrieve: async (id: string) => {
      this.calls.push("customers.retrieve");
      const c = this.customers_[id];
      if (!c) throw new Error("No such customer");
      return structuredClone(c);
    },
  };
  subscriptions = {
    list: async ({ customer }: { customer: string }) => {
      this.calls.push(`subscriptions.list:${customer}`);
      if (this.unreadable.has(customer)) throw new Error("Stripe is unreachable");
      return { data: Object.values(this.subs).filter((s) => s.customer === customer).map((s) => structuredClone(s)), has_more: false };
    },
  };
  /** What Stripe holds once it has sent this event. */
  apply(event: Json): void {
    const o = event.data.object;
    if (o.object === "customer") this.customers_[o.id] = structuredClone(o);
    if (o.object === "subscription") this.subs[o.id] = structuredClone(o);
  }
}

// ── a database with the cache's primary key ─────────────────────────────────

type Row = Record<string, unknown>;
class FakeDb {
  tables: Record<string, Row[]> = {};
  rows(t: string): Row[] {
    return (this.tables[t] ??= []);
  }
  from(t: string) {
    return new FakeQuery(this, t);
  }
}
class FakeQuery {
  private op: "select" | "update" | "upsert" | "insert" | "delete" = "select";
  private payload: Row | null = null;
  private filters: Array<[string, unknown]> = [];
  private returning = false;
  constructor(private db: FakeDb, private t: string) {}
  select(_c?: string) { this.returning = true; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row) { this.op = "upsert"; this.payload = p; return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push([c, v]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this.run(true); }
  then<A>(ok: (v: { data: unknown; error: unknown }) => A, no?: (e: unknown) => A) { return this.run(false).then(ok, no); }
  private hit(r: Row) { return this.filters.every(([c, v]) => (r[c] ?? null) === (v ?? null)); }
  private async run(one: boolean): Promise<{ data: unknown; error: { code: string; message: string } | null }> {
    await Promise.resolve();
    const rows = this.db.rows(this.t);
    const out = (list: Row[]) => ({ data: one ? (list[0] ? { ...list[0] } : null) : (this.op === "select" || this.returning ? list.map((r) => ({ ...r })) : null), error: null });
    if (this.op === "select") return out(rows.filter((r) => this.hit(r)));
    if (this.op === "upsert" || this.op === "insert") {
      const p = this.payload as Row;
      const had = rows.find((r) => r.email === p.email);
      if (had && this.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
      if (had) Object.assign(had, p);
      else rows.push({ user_id: null, cancel_at_period_end: false, ...p });
      return out([had ?? rows[rows.length - 1]]);
    }
    if (this.op === "update") {
      const hit = rows.filter((r) => this.hit(r));
      const p = this.payload as Row;
      // The address is the primary key: Postgres refuses a second row for it.
      if (typeof p.email === "string" && rows.some((r) => r.email === p.email && !hit.includes(r))) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      for (const r of hit) Object.assign(r, p);
      return out(hit);
    }
    const gone = rows.filter((r) => this.hit(r));
    this.db.tables[this.t] = rows.filter((r) => !this.hit(r));
    return out(gone);
  }
}

/** pro_entitlement_rows (20261008130000): rows bound to the account, or unbound on its own proven address. */
function entitlementRows(db: FakeDb, userId: string, signInEmail: string, proven = false): PlanRow[] {
  return db.rows("pro_subscribers")
    .filter((r) => r.user_id === userId || (proven && r.user_id == null && r.email === signInEmail))
    .map((r) => ({ tier: "pro", status: r.status as string, current_period_end: r.current_period_end as string | null, bound: r.user_id != null }));
}

/** check-subscription's address answer for a Stripe lookup. */
function addressAnswerOf(s: { active: boolean; status: string; currentPeriodEnd: string | null }, ends = false) {
  return { active: s.active, status: s.status, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.active && ends, needsPaymentUpdate: ["past_due", "unpaid", "incomplete", "paused"].includes(s.status) };
}

/** The member, the day after they bought Pro: Stripe and the cache as the purchase left them. */
function boughtPro() {
  const f = fixture();
  const stripe = new FakeStripe();
  const db = new FakeDb();
  const session = f.events["checkout.session.completed"].data.object;
  stripe.customers_[session.customer] = { id: session.customer, object: "customer", email: session.customer_details.email };
  stripe.subs[M.subscriptionId] = structuredClone(f.subscriptionAfterPurchase);
  const periodEnd = new Date(f.subscriptionAfterPurchase.items.data[0].current_period_end * 1000).toISOString();
  db.rows("pro_subscribers").push({
    email: M.signInEmail, stripe_customer_id: M.customerId, status: "active", current_period_end: periodEnd,
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(), user_id: M.userId, cancel_at_period_end: false,
  });
  // deno-lint-ignore no-explicit-any
  return { f, stripe, db, s: stripe as any };
}

/** What stripe-webhook does with the events (its refreshProEntitlement and customer.updated case). */
async function webhookHears(event: Json, stripe: FakeStripe, db: FakeDb) {
  stripe.apply(event);
  // deno-lint-ignore no-explicit-any
  const s = stripe as any;
  const o = event.data.object;
  const customerId = o.object === "customer" ? o.id : o.customer;
  if (event.type === "customer.updated") {
    if (!Object.prototype.hasOwnProperty.call(event.data.previous_attributes ?? {}, "email")) return;
    await followCustomerEmail(db, customerId, o.email);
  }
  const email = event.type === "invoice.payment_failed" ? o.customer_email : stripe.customers_[customerId]?.email;
  if (email) await checkProByEmail(s, db, email);
  await refreshCustomerRows(s, db, customerId);
}

const describesNothing = (body: Record<string, unknown>, who: string) => {
  assertEquals(body.active, false, `${who}: told the plan is active`);
  assert(body.status === undefined || body.status === "inactive", `${who}: told the plan's status ${body.status}`);
  assert(body.currentPeriodEnd == null, `${who}: told the plan's period end`);
  assert(body.cancelAtPeriodEnd !== true, `${who}: told the plan is cancelled at its period end`);
  assert(body.needsPaymentUpdate !== true, `${who}: told the plan's payment failed`);
};

// ── the member keeps Pro ────────────────────────────────────────────────────

Deno.test("a member whose billing email changed in Stripe's portal keeps Pro on the next live check, before the webhook hears of it", async () => {
  const { f, stripe, db, s } = boughtPro();
  stripe.apply(f.events["customer.updated"]);
  const row = db.rows("pro_subscribers")[0];
  const status = await checkProByEmail(s, db, M.signInEmail, { seenUpdatedAt: String(row.updated_at) });
  assertEquals(status.active, true, "the live check lost the plan");
  assertEquals(status.stripeCustomerId, M.customerId);
  assertEquals(status.matchedBy, "customer");
  assertEquals(db.rows("pro_subscribers")[0].stripe_customer_id, M.customerId, "the row's customer was cleared");
  assertEquals(db.rows("pro_subscribers")[0].status, "active");
  const told = accountAnswer({
    address: addressAnswerOf(status),
    owner: addressOwnerOf(M.userId, status.boundUserId, row.user_id),
    rows: entitlementRows(db, M.userId, M.signInEmail),
  });
  assertEquals(told.body.active, true);
  assertEquals(told.body.planTier, "pro");
  assertEquals(told.body.linkPending, undefined);
});

Deno.test("the customer.updated event moves the member's bound row to the new billing email and lowers nothing", async () => {
  const { f, stripe, db, s } = boughtPro();
  await webhookHears(f.events["customer.updated"], stripe, db);
  const rows = db.rows("pro_subscribers");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].email, M.newBillingEmail);
  assertEquals(rows[0].user_id, M.userId, "the binding was dropped in the move");
  assertEquals(rows[0].stripe_customer_id, M.customerId);
  assertEquals(rows[0].status, "active");
  // The member still signs in as the old address: the account's rows carry the plan.
  const status = await checkProByEmail(s, db, M.signInEmail, { seenUpdatedAt: null });
  assertEquals(status.stripeCustomerId, null);
  const told = accountAnswer({ address: addressAnswerOf(status), owner: "unbound", rows: entitlementRows(db, M.userId, M.signInEmail) });
  assertEquals(told.body.active, true);
  assertEquals(told.body.status, "active");
  assert(typeof told.body.currentPeriodEnd === "string", "the member's renewal date was not said");
  assertEquals(await boundCustomersOf(db, M.userId), [M.customerId]);
});

Deno.test("an unbound row is never moved, and a row the new address holds for another account is never taken over", async () => {
  const unbound = boughtPro();
  unbound.db.rows("pro_subscribers")[0].user_id = null;
  const moved = await followCustomerEmail(unbound.db, M.customerId, M.newBillingEmail);
  assertEquals(moved, { moved: 0, left: 0, failed: false });
  assertEquals(unbound.db.rows("pro_subscribers")[0].email, M.signInEmail);

  const taken = boughtPro();
  taken.db.rows("pro_subscribers").push({ email: M.newBillingEmail, stripe_customer_id: null, status: "inactive", current_period_end: null, updated_at: new Date().toISOString(), user_id: STRANGER });
  const left = await followCustomerEmail(taken.db, M.customerId, M.newBillingEmail);
  assertEquals(left.left, 1);
  assertEquals(taken.db.rows("pro_subscribers").find((r) => r.email === M.newBillingEmail)?.user_id, STRANGER);
  assertEquals(taken.db.rows("pro_subscribers").find((r) => r.email === M.signInEmail)?.user_id, M.userId);
});

Deno.test("a row the new address already holds stays, and the member's own row is still refreshed by its customer", async () => {
  const { f, stripe, db } = boughtPro();
  db.rows("pro_subscribers").push({ email: M.newBillingEmail, stripe_customer_id: null, status: "inactive", current_period_end: null, updated_at: new Date().toISOString(), user_id: null });
  await webhookHears(f.events["customer.updated"], stripe, db);
  const at = (e: string) => db.rows("pro_subscribers").find((r) => r.email === e);
  assertEquals(at(M.signInEmail)?.user_id, M.userId);
  assertEquals(at(M.signInEmail)?.stripe_customer_id, M.customerId);
  assertEquals(at(M.signInEmail)?.status, "active");
  // The address refresh wrote the new address's row from Stripe, bound by the plan's own buyer.
  assertEquals(at(M.newBillingEmail)?.stripe_customer_id, M.customerId);
  assertEquals(at(M.newBillingEmail)?.user_id, M.userId);
  assertEquals(entitlementRows(db, M.userId, M.signInEmail).every((r) => r.status === "active"), true);
});

// ── the portal opens ────────────────────────────────────────────────────────

Deno.test("Manage billing opens the member's own customer after the change, with or without the webhook", async () => {
  for (const heard of [false, true]) {
    const { f, stripe, db, s } = boughtPro();
    if (heard) await webhookHears(f.events["customer.updated"], stripe, db);
    else stripe.apply(f.events["customer.updated"]);
    // create-portal-session reads the account's bound customer before the lookup refreshes anything.
    const bound = (await boundCustomersOf(db, M.userId))[0] ?? null;
    const found = await checkProByEmail(s, db, M.signInEmail);
    const choice = portalCustomerOf(found, bound);
    assertEquals(choice.customerId, M.customerId, `webhook heard: ${heard}`);
    assertEquals(choice.viaBinding, true);
  }
});

Deno.test("a plan found only through the row's customer is never opened on a proof of the old mailbox", async () => {
  const { f, stripe, db, s } = boughtPro();
  stripe.apply(f.events["customer.updated"]);
  // Another account on the old address: no rows of its own.
  const found = await checkProByEmail(s, db, M.signInEmail);
  const choice = portalCustomerOf(found, null);
  assertEquals(choice.viaBinding, false);
  assertEquals(choice.mailboxCounts, false);
});

// ── the renewal declined ────────────────────────────────────────────────────

Deno.test("a renewal declined after the change reads as a payment due on every row of the member, never as Go Pro", async () => {
  const { f, stripe, db, s } = boughtPro();
  // The endpoint does not carry customer.updated (the interim set-up): only the decline is heard.
  stripe.apply(f.events["customer.updated"]);
  await webhookHears(f.events["invoice.payment_failed"], stripe, db);
  await webhookHears(f.events["customer.subscription.updated"], stripe, db);
  const own = db.rows("pro_subscribers").filter((r) => r.stripe_customer_id === M.customerId);
  assert(own.length >= 1);
  for (const r of own) assertEquals(r.status, "past_due", `${r.email} still read ${r.status}`);
  const row = db.rows("pro_subscribers").find((r) => r.email === M.signInEmail)!;
  const status = await checkProByEmail(s, db, M.signInEmail, { seenUpdatedAt: String(row.updated_at) });
  const told = accountAnswer({
    address: addressAnswerOf(status),
    owner: addressOwnerOf(M.userId, status.boundUserId, row.user_id),
    rows: entitlementRows(db, M.userId, M.signInEmail),
  });
  assertEquals(told.body.active, false);
  assertEquals(told.body.status, "past_due");
  assertEquals(told.body.needsPaymentUpdate, true);
  assertEquals(told.body.planTier, "pro");
});

Deno.test("after a sign-in email change on the site, the declined plan bound to the account is said, not hidden behind the new address", async () => {
  const { f, stripe, db, s } = boughtPro();
  stripe.apply(f.events["customer.subscription.updated"]);
  await refreshCustomerRows(s, db, M.customerId);
  const status = await checkProByEmail(s, db, "renamed@example.org", { seenUpdatedAt: null });
  assertEquals(status.stripeCustomerId, null);
  const told = accountAnswer({ address: addressAnswerOf(status), owner: "unbound", rows: entitlementRows(db, M.userId, "renamed@example.org") });
  assertEquals(told.body.status, "past_due");
  assertEquals(told.body.needsPaymentUpdate, true);
});

// ── no second plan ──────────────────────────────────────────────────────────

Deno.test("a second checkout is refused while the member's plan is live, and sent to the card while it owes, wherever its billing email now is", async () => {
  const { f, stripe, db, s } = boughtPro();
  stripe.apply(f.events["customer.updated"]);
  // The address alone finds nothing: the guard as it was would have sold a second plan.
  assertEquals(checkoutVerdict(await subscriptionStandingByEmail(s, M.signInEmail), "pro").kind, "proceed");
  const live = checkoutVerdict(await accountSubscriptionStanding(s, db, { id: M.userId, email: M.signInEmail }), "pro");
  assertEquals(live.kind, "already_subscribed");
  stripe.apply(f.events["customer.subscription.updated"]);
  const owing = checkoutVerdict(await accountSubscriptionStanding(s, db, { id: M.userId, email: M.signInEmail }), "pro");
  assertEquals(owing.kind, "needs_payment_update");
});

Deno.test("a first-time buyer is still sold Pro, and a bound customer Stripe cannot read refuses nothing", async () => {
  const stripe = new FakeStripe();
  const db = new FakeDb();
  // deno-lint-ignore no-explicit-any
  const s = stripe as any;
  assertEquals(checkoutVerdict(await accountSubscriptionStanding(s, db, { id: STRANGER, email: "first@example.com" }), "pro").kind, "proceed");
  db.rows("pro_subscribers").push({ email: "old@example.com", stripe_customer_id: "cus_Tunreadable01", status: "canceled", current_period_end: null, updated_at: new Date().toISOString(), user_id: STRANGER });
  stripe.unreadable.add("cus_Tunreadable01");
  const standing = await accountSubscriptionStanding(s, db, { id: STRANGER, email: "first@example.com" });
  assertEquals(checkoutVerdict(standing, "pro").kind, "proceed");
  assertEquals(standing.reuseCustomerId, null, "a new plan is billed to the address's customer, never a bound one");
});

// ── nobody else is told ─────────────────────────────────────────────────────

Deno.test("an unbound address's plan is never described to another account: not its declined payment, end date or period", async () => {
  const f = fixture();
  const periodEnd = new Date(f.subscriptionAfterPurchase.items.data[0].current_period_end * 1000).toISOString();
  const owing = { active: false, status: "past_due", currentPeriodEnd: null, cancelAtPeriodEnd: false, needsPaymentUpdate: true };
  const ending = { active: true, status: "active", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: true, needsPaymentUpdate: false };
  for (const address of [owing, ending]) {
    for (const owner of ["unbound", "other"] as const) {
      describesNothing(accountAnswer({ address, owner, rows: [] }).body, `${owner}, ${address.status}`);
      describesNothing(accountAnswer({ address, owner, rows: [], rowsUnread: true }).body, `${owner}, ${address.status}, rows unread`);
      describesNothing(accountAnswer({ address: { ...address, cached: true }, owner, rows: [] }).body, `${owner}, ${address.status}, cached`);
    }
  }
  // An account that HAS proven the address reads the unbound row as its own and is told.
  const own = accountAnswer({ address: owing, owner: "unbound", rows: [{ tier: "pro", status: "past_due", current_period_end: null, bound: false }] });
  assertEquals(own.body.needsPaymentUpdate, true);
  assertEquals(own.body.status, "past_due");
  // And the account a plan is bound to is told, from the address or its own rows.
  assertEquals(accountAnswer({ address: owing, owner: "caller", rows: [] }).body.status, "past_due");
});

Deno.test("an account on a member's address after the member's billing email moved is told nothing of the member's plan", async () => {
  const { f, stripe, db, s } = boughtPro();
  stripe.apply(f.events["customer.subscription.updated"]);
  stripe.apply(f.events["customer.updated"]);
  const row = db.rows("pro_subscribers")[0];
  const status = await checkProByEmail(s, db, M.signInEmail, { seenUpdatedAt: String(row.updated_at) });
  assertEquals(status.status, "past_due");
  const owner = addressOwnerOf(STRANGER, status.boundUserId, row.user_id);
  assertEquals(owner, "other");
  const told = accountAnswer({ address: addressAnswerOf(status), owner, rows: entitlementRows(db, STRANGER, M.signInEmail) });
  describesNothing(told.body, "a stranger on the member's address");
});
