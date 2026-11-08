// @vitest-environment node
/**
 * A PRO MEMBER WHO CHANGES THEIR BILLING EMAIL IN STRIPE KEEPS PRO, OPENS
 * BILLING, IS SOLD NO SECOND PLAN, AND NOBODY ELSE IS TOLD ABOUT THEIR PLAN
 * (sweep S14: M-S14-002, M-S14-006, C-S14-004).
 *
 * WHAT WAS WRONG.
 *   - M-S14-002. The Pro cache keys a plan by address. A member who changed
 *     their billing email in Stripe's customer portal still paid on the same
 *     customer, but the next check-subscription searched Stripe by the old
 *     address, found nothing, and wrote the row {stripe_customer_id: null,
 *     status: "inactive"}: Pro was gone, "Manage billing" answered 404 (the
 *     bound customer it falls back to had just been cleared), and the
 *     checkout's guard, searching the same address, sold a second $45 plan.
 *     stripe-webhook had no customer.updated case at all.
 *   - M-S14-006. After a sign-in email change on the site, a declined renewal
 *     on the plan bound to the account was answered with the NEW address's
 *     "inactive": the page offered "Go Pro", and the checkout sold it.
 *   - C-S14-004. check-subscription spread the address's answer into every
 *     account's: an account signed up on someone's address (sign-ups are
 *     confirmed automatically) read that plan's failed payment, end date and
 *     period. Only a LIVE plan was hidden (D8).
 *
 * WHAT HOLDS NOW, on the shipped handlers with Stripe, the database and the
 * auth server faked, driven by the member's own Stripe events in the shapes
 * Stripe sends (src/test/fixtures/stripe-pro-billing-email-change-events.json;
 * the same events drive supabase/functions/check-subscription/billing_email_change_test.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { STRIPE_WEBHOOKS_REAL_SHAPE, signStripePayload } from "./helpers/stripe-signature";
import { buildIsAtLeast } from "./helpers/fn-build";
import { boundCustomerOfRows, portalCustomerOf } from "../../supabase/functions/_shared/pro-answer";
import RAW from "./fixtures/stripe-pro-billing-email-change-events.json";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const TIME_KEYS = new Set([
  "created", "start_date", "billing_cycle_anchor", "current_period_start", "current_period_end",
  "next_payment_attempt", "period_start", "period_end", "start", "end", "cancel_at", "canceled_at",
]);
const rebased = (v: Json, offset: number): Json =>
  Array.isArray(v) ? v.map((x) => rebased(x, offset))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, TIME_KEYS.has(k) && typeof x === "number" ? x + offset : rebased(x, offset)]))
    : v;
const M = RAW.member;
const STRANGER_ID = "00000000-0000-4000-8000-0000000014b2";
const NEWCOMER_ID = "00000000-0000-4000-8000-0000000014c3";

const SECRET = "whsec_live_harness_h1";
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_live_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com",
};

interface World {
  customers: Record<string, Json>;
  subs: Record<string, Json>;
  unreadable: string[];
  created: Json[];
  portals: Json[];
  touched: string[];
}
let world: World;
const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__h1Stripe;
    const touch = (x) => w().touched.push(x);
    const copy = (x) => JSON.parse(JSON.stringify(x));
    this.webhooks = ${STRIPE_WEBHOOKS_REAL_SHAPE};
    this.customers = {
      list: async ({ email }) => { touch("customers.list"); return { data: Object.values(w().customers).filter((c) => !c.deleted && c.email === email).map(copy), has_more: false }; },
      retrieve: async (id) => { touch("customers.retrieve"); const c = w().customers[id]; if (!c) throw new Error("No such customer: " + id); return copy(c); },
    };
    this.subscriptions = {
      list: async ({ customer }) => {
        touch("subscriptions.list");
        if (w().unreadable.includes(customer)) throw new Error("Stripe is unreachable");
        return { data: Object.values(w().subs).filter((s) => s.customer === customer).map(copy), has_more: false };
      },
      retrieve: async (id) => { const s = w().subs[id]; if (!s) throw new Error("No such subscription"); return copy(s); },
    };
    this.invoices = { list: async () => ({ data: [], has_more: false }), createPreview: async () => ({ amount_due: 0 }) };
    this.promotionCodes = { list: async () => ({ data: [] }) };
    this.checkout = { sessions: {
      create: async (p) => { touch("sessions.create"); w().created.push(p); return { id: "cs_test_h1" + w().created.length, url: "https://checkout.stripe.com/c/cs_test_h1", amount_total: 4500, currency: "usd", mode: p.mode }; },
      retrieve: async () => { throw new Error("No such checkout.session"); },
      list: async () => ({ data: [] }),
      expire: async () => ({}),
    } };
    this.billingPortal = { sessions: { create: async (p) => { touch("portal.create"); w().portals.push(p); return { url: "https://billing.stripe.com/p/session/" + p.customer }; } } };
  }
}`;
const SERVER = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { return new Proxy({}, { get: (_t, p) => globalThis.__h1Client[p] }); } export class SupabaseClient {}";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": SERVER,
  "https://deno.land/std@0.168.0/http/server.ts": SERVER,
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 're_x' }, error: null }) }; } }",
};

const FNS = ["stripe-webhook", "check-subscription", "create-portal-session", "create-subscription-checkout"] as const;
const h: Record<string, EdgeHandler> = {};
let db: FakeDb;
/** Who each token signs in as. */
let users: Record<string, { id: string; email: string }>;
/** Accounts that have proven their address's mailbox (account_mailbox_proven). */
let proven: Set<string>;
const pending: Promise<unknown>[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  for (const fn of FNS) h[fn] = await loadEdgeHandler(fn, STUBS);
}, 240_000);

beforeEach(() => {
  world = { customers: {}, subs: {}, unreadable: [], created: [], portals: [], touched: [] };
  users = {
    "jwt-member": { id: M.userId, email: M.signInEmail },
    "jwt-stranger": { id: STRANGER_ID, email: M.signInEmail },
    "jwt-newcomer": { id: NEWCOMER_ID, email: "first-time@example.com" },
  };
  proven = new Set();
  db = new FakeDb({ pro_subscribers: ["email"], used_stripe_sessions: ["session_id"] });
  db.rpcs = {
    check_rate_limit: () => ({ data: true, error: null }),
    check_global_rate_limit: () => ({ data: true, error: null }),
    record_checkout_start: () => ({ data: true, error: null }),
    log_webhook_event: () => ({ data: null, error: null }),
    mail_door_take: () => ({ data: true, error: null }),
    // 20261008130000: rows bound to the account, or unbound on its own proven address.
    pro_entitlement_rows: (a) => {
      const u = Object.values(users).find((x) => x.id === a.p_user_id);
      const mine = (r: Record<string, unknown>) => r.user_id === a.p_user_id || (proven.has(String(a.p_user_id)) && r.user_id == null && r.email === u?.email);
      return {
        data: [
          ...db.rows("pro_subscribers").filter(mine).map((r) => ({ tier: "pro", status: r.status, current_period_end: r.current_period_end, bound: r.user_id != null })),
          ...db.rows("agent_subscribers").filter(mine).map((r) => ({ tier: "agent", status: r.status, current_period_end: r.current_period_end, bound: r.user_id != null })),
        ],
        error: null,
      };
    },
  };
  const g = globalThis as Record<string, unknown>;
  g.__h1Stripe = world;
  g.__h1Client = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (jwt?: string) => {
        const u = jwt ? users[jwt] : undefined;
        return u ? { data: { user: { ...u } }, error: null } : { data: { user: null }, error: { name: "AuthApiError", status: 403, message: "bad jwt" } };
      },
    },
  };
  // The auth server still confirms sign-ups by itself, so no session proves a mailbox by email.
  g.fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/v1/settings")) return new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 });
    if (url.startsWith("https://ipinfo.io/")) return new Response("{}", { status: 200 });
    if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "re_x" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
});

// ── the member and their events ─────────────────────────────────────────────

let f: Json;
/** The member the day after they bought Pro: Stripe and the cache as the purchase left them. */
function boughtPro(over: { metadata?: Record<string, string>; rowUserId?: string | null } = {}) {
  f = rebased(RAW, Math.floor(Date.now() / 1000) - RAW.recordedAt);
  const session = f.events["checkout.session.completed"].data.object;
  world.customers[session.customer] = { id: session.customer, object: "customer", email: session.customer_details.email };
  world.subs[M.subscriptionId] = { ...f.subscriptionAfterPurchase, ...(over.metadata ? { metadata: over.metadata } : {}) };
  db.rows("pro_subscribers").push({
    email: M.signInEmail, stripe_customer_id: M.customerId, status: "active",
    current_period_end: new Date(f.subscriptionAfterPurchase.items.data[0].current_period_end * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    user_id: over.rowUserId === undefined ? M.userId : over.rowUserId, cancel_at_period_end: false,
  });
}
/** Stripe's own state once it has sent this event. */
function stripeSent(type: string) {
  const o = f.events[type].data.object;
  if (o.object === "customer") world.customers[o.id] = JSON.parse(JSON.stringify(o));
  if (o.object === "subscription") world.subs[o.id] = JSON.parse(JSON.stringify(o));
}
/** Stripe sends this event to stripe-webhook, signed as Stripe signs it. */
async function deliver(type: string) {
  stripeSent(type);
  const body = JSON.stringify(f.events[type]);
  const res = await h["stripe-webhook"](new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signStripePayload(body, SECRET) },
    body,
  }));
  while (pending.length) await pending.shift();
  return res.status;
}
const call = (fn: string, jwt: string, body: Record<string, unknown> = {}) =>
  h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}`, origin: "https://resumebooster.work", "cf-connecting-ip": "198.51.100.14" },
    body: JSON.stringify(fn === "create-subscription-checkout" ? { autoRenewConsent: true, ...body } : body),
  }));
/** The Pro card's read after the portal (fresh: Stripe is asked, not the cache). */
const proCard = async (jwt = "jwt-member") => (await call("check-subscription", jwt, { fresh: true })).json();
const manageBilling = async (jwt = "jwt-member") => {
  const res = await call("create-portal-session", jwt);
  return { status: res.status, body: await res.json() };
};
const goPro = async (jwt = "jwt-member") => (await call("create-subscription-checkout", jwt)).json();

function describesNothing(body: Record<string, unknown>, who: string) {
  expect(body.active, `${who}: told the plan is active`).toBe(false);
  expect(["inactive", undefined], `${who}: told the plan's status`).toContain(body.status);
  expect(body.currentPeriodEnd ?? null, `${who}: told the plan's period end`).toBeNull();
  expect(body.cancelAtPeriodEnd === true, `${who}: told the plan ends`).toBe(false);
  expect(body.needsPaymentUpdate === true, `${who}: told the plan's payment failed`).toBe(false);
}

describe("a Pro member who changes their billing email in Stripe's portal (M-S14-002)", () => {
  it("keeps Pro, opens billing and is sold no second plan, before the webhook hears of the change", async () => {
    boughtPro();
    stripeSent("customer.updated");
    const card = await proCard();
    expect(card, "the member lost Pro").toMatchObject({ active: true, status: "active", planTier: "pro", needsPaymentUpdate: false });
    expect(card.linkPending).toBeUndefined();
    expect(db.rows("pro_subscribers")[0], "the row's customer was cleared").toMatchObject({ email: M.signInEmail, stripe_customer_id: M.customerId, status: "active", user_id: M.userId });

    const billing = await manageBilling();
    expect(billing.status, "Manage billing answered 404").toBe(200);
    expect(world.portals.map((p) => p.customer)).toEqual([M.customerId]);

    const second = await goPro();
    expect(second).toMatchObject({ alreadySubscribed: true, tier: "pro" });
    expect(world.created, "a second plan was sold").toEqual([]);
  });

  it("the customer.updated event moves the member's row to the new address, bound as it was, and the member keeps Pro, billing and one plan", async () => {
    boughtPro();
    expect(await deliver("customer.updated")).toBe(200);
    expect(db.rows("pro_subscribers")).toEqual([
      expect.objectContaining({ email: M.newBillingEmail, stripe_customer_id: M.customerId, status: "active", user_id: M.userId }),
    ]);
    expect(await proCard()).toMatchObject({ active: true, status: "active", planTier: "pro" });
    expect((await manageBilling()).status).toBe(200);
    expect(world.portals.map((p) => p.customer)).toEqual([M.customerId]);
    expect(await goPro()).toMatchObject({ alreadySubscribed: true });
    expect(world.created).toEqual([]);
  });

  it("any other customer change (a new card) moves nothing and asks Stripe nothing", async () => {
    boughtPro();
    const ev = f.events["customer.updated"];
    ev.data.object.email = M.signInEmail;
    ev.data.previous_attributes = { invoice_settings: { default_payment_method: "pm_1SQoldCard01" } };
    world.touched = [];
    expect(await deliver("customer.updated")).toBe(200);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ email: M.signInEmail, user_id: M.userId, status: "active" });
    expect(world.touched).toEqual([]);
  });

  it("a renewal declined after the change says a payment is due, opens billing, and sells nothing", async () => {
    boughtPro();
    stripeSent("customer.updated");
    expect(await deliver("invoice.payment_failed")).toBe(200);
    expect(await deliver("customer.subscription.updated")).toBe(200);
    for (const r of db.rows("pro_subscribers").filter((x) => x.stripe_customer_id === M.customerId)) {
      expect(r.status, `${r.email} still read ${r.status}`).toBe("past_due");
    }
    const card = await proCard();
    expect(card, "a member owing a payment was offered Go Pro").toMatchObject({ active: false, status: "past_due", needsPaymentUpdate: true, planTier: "pro" });
    expect((await manageBilling()).status).toBe(200);
    expect(world.portals.map((p) => p.customer)).toEqual([M.customerId]);
    expect(await goPro()).toMatchObject({ needsPaymentUpdate: true, tier: "pro" });
    expect(world.created).toEqual([]);
  });
});

describe("a member whose sign-in email changed on the site (M-S14-006)", () => {
  it("is shown the declined payment on the plan bound to their account, not Go Pro, and is not sold another", async () => {
    boughtPro();
    users["jwt-member"] = { id: M.userId, email: "renamed@example.org" };
    stripeSent("customer.subscription.updated");
    const card = await proCard();
    expect(card).toMatchObject({ active: false, status: "past_due", needsPaymentUpdate: true, planTier: "pro" });
    expect(await goPro()).toMatchObject({ needsPaymentUpdate: true });
    expect(world.created).toEqual([]);
    expect((await manageBilling()).status).toBe(200);
    expect(world.portals.map((p) => p.customer)).toEqual([M.customerId]);
  });

  it("is shown their live plan's end date when it was cancelled at period end", async () => {
    boughtPro();
    users["jwt-member"] = { id: M.userId, email: "renamed@example.org" };
    world.subs[M.subscriptionId].cancel_at_period_end = true;
    const card = await proCard();
    expect(card).toMatchObject({ active: true, status: "active", cancelAtPeriodEnd: true });
    expect(typeof card.currentPeriodEnd).toBe("string");
  });
});

describe("an address's plan is described only to the account it belongs to (C-S14-004)", () => {
  it("another account on the member's address learns nothing of a declined renewal or a period", async () => {
    boughtPro();
    stripeSent("customer.subscription.updated");
    describesNothing(await proCard("jwt-stranger"), "a stranger, live check");
    describesNothing(await (await call("check-subscription", "jwt-stranger")).json(), "a stranger, cached");
    expect(world.portals).toEqual([]);
  });

  it("nor of a live plan set to end", async () => {
    boughtPro();
    world.subs[M.subscriptionId].cancel_at_period_end = true;
    const told = await proCard("jwt-stranger");
    describesNothing(told, "a stranger");
    expect(told.linkPending).toBe(true);
  });

  it("an unbound plan (bought before plans named their buyer) is described to no account that has not proven the address, and to the one that has", async () => {
    boughtPro({ metadata: {}, rowUserId: null });
    stripeSent("customer.subscription.updated");
    world.subs[M.subscriptionId].metadata = {};
    describesNothing(await proCard("jwt-stranger"), "an unproven account");
    proven.add(STRANGER_ID);
    expect(await proCard("jwt-stranger"), "the account that proved the mailbox owns the unbound plan").toMatchObject({ status: "past_due", needsPaymentUpdate: true });
  });
});

describe("a plan kept by its customer is kept only for the account it is bound to (review of M-S14-002)", () => {
  /** The unbound plan's buyer moved its billing email; the old address is now someone else's, proven. */
  function unboundPlanLeftItsAddress() {
    boughtPro({ metadata: {}, rowUserId: null });
    world.subs[M.subscriptionId].metadata = {};
    stripeSent("customer.updated");
    proven.add(STRANGER_ID);
  }

  it("an unbound plan whose payer moved its billing email is not kept live for whoever proves the old address", async () => {
    unboundPlanLeftItsAddress();
    describesNothing(await proCard("jwt-stranger"), "the account that inherited the old address");
    expect(db.rows("pro_subscribers").find((r) => r.email === M.signInEmail), "the old address's row was kept live by a customer that left it")
      .toMatchObject({ status: "inactive", stripe_customer_id: M.customerId, user_id: null });
    expect(world.portals).toEqual([]);
  });

  it("a subscription event refreshes no unbound row its customer has left, and the payer's new address reads the plan", async () => {
    unboundPlanLeftItsAddress();
    await proCard("jwt-stranger");
    const ev = f.events["customer.subscription.updated"];
    ev.data.object.status = "active";
    ev.data.object.metadata = {};
    expect(await deliver("customer.subscription.updated")).toBe(200);
    expect(db.rows("pro_subscribers").find((r) => r.email === M.signInEmail), "a webhook made the old address's unbound row live again")
      .toMatchObject({ status: "inactive", stripe_customer_id: M.customerId, user_id: null });
    expect(db.rows("pro_subscribers").find((r) => r.email === M.newBillingEmail)).toMatchObject({ status: "active", stripe_customer_id: M.customerId });
    describesNothing(await (await call("check-subscription", "jwt-stranger")).json(), "the old address's account, after the event");
  });

  it("a member with an ended plan on a former address opens billing on the plan that owes, after the Pro card refreshed the ended one", async () => {
    // The ended plan's row comes first, as the newest does once the Pro card has refreshed it.
    world.customers.cus_TformerPlan01 = { id: "cus_TformerPlan01", object: "customer", email: "former@example.org" };
    db.rows("pro_subscribers").push({
      email: "former@example.org", stripe_customer_id: "cus_TformerPlan01", status: "canceled", current_period_end: null,
      updated_at: new Date(Date.now() - 5 * 3600_000).toISOString(), user_id: M.userId, cancel_at_period_end: false,
    });
    boughtPro();
    world.subs.sub_1SQformerPlan01 = {
      ...JSON.parse(JSON.stringify(f.subscriptionAfterPurchase)), id: "sub_1SQformerPlan01", customer: "cus_TformerPlan01", status: "canceled",
    };
    stripeSent("customer.updated");
    stripeSent("customer.subscription.updated");
    expect(await proCard()).toMatchObject({ status: "past_due", needsPaymentUpdate: true });
    expect(db.rows("pro_subscribers").find((r) => r.email === "former@example.org")?.status).toBe("canceled");
    const billing = await manageBilling();
    expect(billing.status).toBe(200);
    expect(world.portals.map((p) => p.customer), "billing opened the ended plan's customer, not the one that owes").toEqual([M.customerId]);
  });

  it("the portal opens the account's own owing plan the lookup reached by its customer before another bound customer", () => {
    const owing = { stripeCustomerId: "cus_Towing01", status: "past_due", matchedBy: "customer" as const };
    expect(portalCustomerOf(owing, "cus_Tended01", true)).toEqual({ customerId: "cus_Towing01", viaBinding: true, mailboxCounts: false });
    // Not the account's own: the binding decides, exactly as before.
    expect(portalCustomerOf(owing, "cus_Tended01", false).customerId).toBe("cus_Tended01");
    expect(portalCustomerOf(owing, null).customerId).toBe("cus_Towing01");
    expect(portalCustomerOf(owing, null).viaBinding).toBe(false);
    // An ended plan reached by its customer never displaces the bound one.
    expect(portalCustomerOf({ ...owing, status: "canceled" }, "cus_Tended01", true).customerId).toBe("cus_Tended01");
  });

  it("an account's bound customer for billing is the live plan's, then the owing plan's, and only then the newest row's", () => {
    const now = Date.now();
    const later = new Date(now + 20 * 86400_000).toISOString();
    expect(boundCustomerOfRows([
      { stripe_customer_id: "cus_Tended01", status: "canceled", current_period_end: null },
      { stripe_customer_id: "cus_Towing01", status: "past_due", current_period_end: null },
    ], now)).toBe("cus_Towing01");
    expect(boundCustomerOfRows([
      { stripe_customer_id: "cus_Towing01", status: "past_due", current_period_end: null },
      { stripe_customer_id: "cus_Tlive01", status: "active", current_period_end: later },
    ], now)).toBe("cus_Tlive01");
    expect(boundCustomerOfRows([
      { stripe_customer_id: "cus_Tnewest01", status: "canceled", current_period_end: null },
      { stripe_customer_id: "cus_Tolder01", status: "canceled", current_period_end: null },
    ], now)).toBe("cus_Tnewest01");
    expect(boundCustomerOfRows([{ stripe_customer_id: null, status: "active" }, { stripe_customer_id: "not-a-customer", status: "active" }], now)).toBeNull();
  });
});

describe("sales and billing work as they did", () => {
  it("a first-time buyer is sold Pro", async () => {
    const body = await goPro("jwt-newcomer");
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(world.created).toHaveLength(1);
  });

  it("a bound customer Stripe cannot read refuses no sale", async () => {
    db.rows("pro_subscribers").push({ email: "old@example.com", stripe_customer_id: "cus_Tunreadable01", status: "canceled", current_period_end: null, updated_at: new Date().toISOString(), user_id: NEWCOMER_ID });
    world.unreadable.push("cus_Tunreadable01");
    expect((await goPro("jwt-newcomer")).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(world.created).toHaveLength(1);
    expect(world.created[0].customer, "a new plan was billed to a bound customer").toBeUndefined();
  });

  it("a member whose address finds their plan opens billing and reads Pro exactly as before", async () => {
    boughtPro();
    expect(await proCard()).toMatchObject({ active: true, status: "active" });
    expect((await manageBilling()).status).toBe(200);
    expect(world.portals.map((p) => p.customer)).toEqual([M.customerId]);
  });

  it("every function this changes answers the 2026-11-10 build", async () => {
    for (const fn of FNS) {
      const res = await h[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(buildIsAtLeast(res.headers.get("x-fn-build"), fn, "2026-11-10", 1), `${fn}: ${res.headers.get("x-fn-build")}`).toBe(true);
    }
  });
});
