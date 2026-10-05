// @vitest-environment node
/**
 * A SUBSCRIPTION IS SOLD, AND REPORTED, ONLY TO ITS SIGNED-IN OWNER.
 *
 * WHAT WAS WRONG (2026-10-04 completeness review; platform sweep L3-01,
 * L6-05, L6-06, L6-28).
 *   - check-subscription, create-subscription-checkout and
 *     create-agent-checkout answered, for ANY address in the request body,
 *     whether that address paid us -- and spent unmetered Stripe calls (and
 *     a cache row) on every guess.
 *   - The checkouts refused a second plan only when the first was ACTIVE: a
 *     past_due plan was sold another (and the agent a fresh trial), and a Pro
 *     subscriber was sold the agent beside Pro.
 *   - check-subscription served a cached "inactive" row for an hour, so a
 *     buyer who had just paid read as not subscribed.
 *
 * AND FROM THE REVIEW OF THAT FIX (2026-10-05).
 *   - With no row created for a non-subscriber, every page view by a
 *     signed-in one was a fresh Stripe lookup; a signed-in caller who sent
 *     any cs_... string skipped the per-address allowance altogether.
 *   - create-product-checkout's signed-out "sign in to use your Pro plan"
 *     answer started reading the agent table too, so it told a stranger
 *     about $99 plans and comped agent accounts that nothing else reveals.
 *
 * WHAT THIS HOLDS, against the shipped handlers with only Stripe, the
 * database and the auth server faked (helpers/edge-harness).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

type Sub = { id: string; status: string; cancel_at_period_end?: boolean; items: { data: Array<{ price: { unit_amount: number }; current_period_end?: number }> } };

const PRO = 4500;
const AGENT = 9900;
const sub = (status: string, cents: number, extra: Partial<Sub> = {}): Sub => ({
  id: `sub_${status}_${cents}`,
  status,
  items: { data: [{ price: { unit_amount: cents }, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20 }] },
  ...extra,
});

interface StripeWorld {
  customers: Record<string, Array<{ id: string }>>;
  subs: Record<string, Sub[]>;
  sessions: Record<string, Record<string, unknown>>;
  calls: string[];
  created: Array<Record<string, unknown>>;
  /** Runs inside customers.list: what lands in the database mid-lookup. */
  onCustomersList?: (email: string) => void;
}

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__stripe;
    this.customers = { list: async ({ email }) => { w().calls.push("customers.list"); w().onCustomersList?.(email); return { data: w().customers[email] ?? [], has_more: false }; } };
    this.subscriptions = { list: async ({ customer }) => { w().calls.push("subscriptions.list"); return { data: w().subs[customer] ?? [], has_more: false }; } };
    this.checkout = { sessions: {
      create: async (p) => { w().calls.push("sessions.create"); w().created.push(p); return { id: "cs_test_new", url: "https://checkout.stripe.com/c/cs_test_new", amount_total: 0, currency: "usd", mode: p.mode, payment_status: "unpaid" }; },
      retrieve: async (id) => { w().calls.push("sessions.retrieve"); const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; },
    } };
  }
}`;

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient() { return globalThis.__subClient; }",
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
};
const TOKENS: Record<string, string> = { "jwt-owner": "owner@example.com", "jwt-other": "other@example.com" };

const handlers: Record<string, EdgeHandler> = {};
let db: FakeDb;
let stripe: StripeWorld;
let rateAllowed: boolean | null;
let rateCalls: number;
let authCalls: string[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  for (const fn of ["check-subscription", "create-subscription-checkout", "create-agent-checkout", "create-product-checkout"]) {
    handlers[fn] = await loadEdgeHandler(fn, STUBS);
  }
}, 120_000);

beforeEach(() => {
  db = new FakeDb();
  rateAllowed = true;
  rateCalls = 0;
  authCalls = [];
  db.rpcs.check_rate_limit = () => { rateCalls++; return { data: rateAllowed, error: null }; };
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  db.unique = { pro_subscribers: ["email"] };
  stripe = { customers: {}, subs: {}, sessions: {}, calls: [], created: [] };
  const g = globalThis as Record<string, unknown>;
  g.__stripe = stripe;
  g.__subClient = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async (jwt: string) => {
        authCalls.push(jwt);
        const email = TOKENS[jwt];
        return email ? { data: { user: { email } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } };
      },
    },
  };
});

const post = (fn: string, body: Record<string, unknown>, bearer?: string) =>
  handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "198.51.100.7",
      authorization: `Bearer ${bearer ?? env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  }));

describe("check-subscription answers only about the caller", () => {
  it("tells an anonymous request nothing about the address it names, and spends nothing finding out", async () => {
    stripe.customers["victim@example.com"] = [{ id: "cus_victim" }];
    stripe.subs.cus_victim = [sub("active", PRO)];
    const res = await post("check-subscription", { email: "victim@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ active: false, status: "sign_in_required" });
    expect(stripe.calls, "a stranger's guess spent Stripe calls").toEqual([]);
    expect(db.writes, "a stranger's guess wrote a cache row").toEqual([]);
    expect(authCalls, "the publishable key is not a user and costs no auth round trip").toEqual([]);
  });

  it("answers the signed-in caller about THEIR address, whatever the body names", async () => {
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("active", PRO)];
    stripe.customers["victim@example.com"] = [{ id: "cus_victim" }];
    stripe.subs.cus_victim = [];
    const res = await post("check-subscription", { email: "victim@example.com" }, "jwt-owner");
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(stripe.calls).toEqual(["customers.list", "subscriptions.list"]);
  });

  it("a held, completed subscription checkout proves its address; an unknown id proves nothing", async () => {
    stripe.sessions.cs_test_held = { id: "cs_test_held", mode: "subscription", status: "complete", customer_details: { email: "Buyer@Example.com" } };
    stripe.customers["buyer@example.com"] = [{ id: "cus_buyer" }];
    stripe.subs.cus_buyer = [sub("active", PRO)];
    expect((await (await post("check-subscription", { sessionId: "cs_test_held" })).json()).active).toBe(true);
    const unknown = await (await post("check-subscription", { sessionId: "cs_test_nope_0000" })).json();
    expect(unknown).toEqual({ active: false, status: "sign_in_required" });
  });

  it("a cached NOT-live row is trusted for minutes, not an hour (a buyer who just paid is not told Go Pro)", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "inactive", current_period_end: null, updated_at: tenMinutesAgo });
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("active", PRO)];
    const body = await (await post("check-subscription", {}, "jwt-owner")).json();
    expect(body.active, "a ten-minute-old 'inactive' row was served over a live plan").toBe(true);

    stripe.calls = [];
    db.rows("pro_subscribers").splice(0, 1, { email: "owner@example.com", status: "active", current_period_end: null, updated_at: tenMinutesAgo });
    const cached = await (await post("check-subscription", {}, "jwt-owner")).json();
    expect(cached).toMatchObject({ active: true, cached: true });
    expect(stripe.calls, "a fresh live row should be served from the cache").toEqual([]);
  });

  it("says a plan that owes money needs a card, and over its live-check allowance serves the last answer marked stale", async () => {
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "past_due", current_period_end: null, updated_at: old });
    rateAllowed = false;
    const body = await (await post("check-subscription", {}, "jwt-owner")).json();
    expect(body).toMatchObject({ active: false, status: "past_due", needsPaymentUpdate: true, stale: true });
    expect(stripe.calls).toEqual([]);
  });
});

describe("check-subscription remembers 'not subscribed' for a signed-in caller (2026-10-05 review)", () => {
  it("five page views by a signed-in non-subscriber cost one Stripe lookup, not five", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await post("check-subscription", {}, "jwt-owner");
      expect(res.status).toBe(200);
      expect((await res.json()).active).toBe(false);
    }
    expect(stripe.calls.filter((c) => c === "customers.list"), "every view went to Stripe").toHaveLength(1);
    expect(rateCalls, "the allowance was spent on views the cache answered").toBe(1);
    expect(db.rows("pro_subscribers")).toEqual([expect.objectContaining({ email: "owner@example.com", status: "inactive", stripe_customer_id: null })]);
  });

  it("after five minutes the address is looked up again, so a purchase the webhook missed still shows", async () => {
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "inactive", stripe_customer_id: null, current_period_end: null, updated_at: new Date(Date.now() - 6 * 60_000).toISOString() });
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("active", PRO)];
    expect((await (await post("check-subscription", {}, "jwt-owner")).json()).active).toBe(true);
  });

  it("never writes 'not subscribed' over a row the webhook wrote during the lookup", async () => {
    stripe.onCustomersList = (email) => {
      db.rows("pro_subscribers").push({ email, status: "active", stripe_customer_id: "cus_new", current_period_end: null, updated_at: new Date().toISOString() });
    };
    await post("check-subscription", {}, "jwt-owner");
    expect(db.rows("pro_subscribers")).toEqual([expect.objectContaining({ email: "owner@example.com", status: "active", stripe_customer_id: "cus_new" })]);
  });

  it("nor downgrades a row the webhook rewrote during the lookup", async () => {
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "inactive", stripe_customer_id: null, current_period_end: null, updated_at: new Date(Date.now() - 6 * 60_000).toISOString() });
    stripe.onCustomersList = (email) => {
      Object.assign(db.rows("pro_subscribers").find((r) => r.email === email)!, { status: "active", stripe_customer_id: "cus_new", updated_at: new Date().toISOString() });
    };
    await post("check-subscription", {}, "jwt-owner");
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "active", stripe_customer_id: "cus_new" });
  });

  it("but a stale row Stripe no longer backs is still downgraded, and served from then on", async () => {
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "active", stripe_customer_id: "cus_gone", current_period_end: null, updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
    expect((await (await post("check-subscription", {}, "jwt-owner")).json()).active).toBe(false);
    expect(db.rows("pro_subscribers")[0]).toMatchObject({ status: "inactive", stripe_customer_id: null });
    expect(Date.now() - new Date(String(db.rows("pro_subscribers")[0].updated_at)).getTime()).toBeLessThan(60_000);
  });

  it("an anonymous caller still writes nothing and costs nothing", async () => {
    await post("check-subscription", { email: "owner@example.com" });
    expect(db.writes).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  it("a signed-in caller holding the checkout they just completed is told the live answer, not a not-live row", async () => {
    db.rows("pro_subscribers").push({ email: "owner@example.com", status: "inactive", stripe_customer_id: null, current_period_end: null, updated_at: new Date(Date.now() - 60_000).toISOString() });
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("active", PRO)];
    const body = await (await post("check-subscription", { sessionId: "cs_test_just_paid" }, "jwt-owner")).json();
    expect(body.active).toBe(true);
    expect(rateCalls, "the live check was not counted").toBe(1);
  });

  it("a session id in the body is not a way past the allowance", async () => {
    rateAllowed = false;
    const res = await post("check-subscription", { sessionId: "cs_test_invented_0000" }, "jwt-owner");
    expect(res.status).toBe(429);
    expect(stripe.calls, "an invented session id bought a Stripe lookup over the allowance").toEqual([]);
  });
});

describe("create-product-checkout tells a signed-out caller no more than it did before the wave (2026-10-05 review)", () => {
  const buy = async (email: string, bearer?: string) =>
    (await post("create-product-checkout", { productId: "coverLetter", email }, bearer)).json();

  it("a comped or $99 agent account looks like any stranger to a signed-out caller", async () => {
    db.rows("agent_subscribers").push({ email: "comped@example.com", status: "active", current_period_end: null, stripe_customer_id: null });
    const comped = await buy("comped@example.com");
    const stranger = await buy("nobody@example.com");
    expect(comped.proRequiresSignIn, "the agent table answered a stranger").toBeUndefined();
    expect(Object.keys(comped).sort()).toEqual(Object.keys(stranger).sort());
    expect(comped.url).toBe("https://checkout.stripe.com/c/cs_test_new");
  });

  it("the Pro answer it already gave is kept until the owner decides (a signed-out subscriber is not charged)", async () => {
    db.rows("pro_subscribers").push({ email: "pro@example.com", status: "active", current_period_end: null });
    expect(await buy("pro@example.com")).toEqual({ proRequiresSignIn: true });
    expect(stripe.calls).not.toContain("sessions.create");
  });

  it("signed in, the agent plan's owner gets the included tool without Stripe", async () => {
    db.rows("agent_subscribers").push({ email: "owner@example.com", status: "active", current_period_end: null, stripe_customer_id: null });
    const body = await buy("someone-else@example.com", "jwt-owner");
    expect(body.proIncluded).toBe(true);
    expect(db.rows("pro_grants")[0]).toMatchObject({ email: "owner@example.com", product_id: "coverLetter" });
    expect(stripe.calls).not.toContain("sessions.create");
  });
});

describe("the subscription checkouts sell only to a signed-in account, and never a second plan", () => {
  for (const fn of ["create-subscription-checkout", "create-agent-checkout"]) {
    it(`${fn}: an anonymous request is a 401 that names no status and makes no Stripe call`, async () => {
      stripe.customers["victim@example.com"] = [{ id: "cus_victim" }];
      stripe.subs.cus_victim = [sub("active", AGENT)];
      const res = await post(fn, { email: "victim@example.com" });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.signInRequired).toBe(true);
      expect(body.alreadySubscribed).toBeUndefined();
      expect(stripe.calls).toEqual([]);
    });

    it(`${fn}: a plan that owes money is sent to the card, not sold another`, async () => {
      stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
      stripe.subs.cus_owner = [sub("canceled", PRO), sub("past_due", fn === "create-agent-checkout" ? AGENT : PRO)];
      const body = await (await post(fn, {}, "jwt-owner")).json();
      expect(body.needsPaymentUpdate).toBe(true);
      expect(body.url).toBeUndefined();
      expect(stripe.calls).not.toContain("sessions.create");
    });

    it(`${fn}: over the per-address allowance is a 429 before anything else`, async () => {
      rateAllowed = false;
      const res = await post(fn, {}, "jwt-owner");
      expect(res.status).toBe(429);
      expect(stripe.calls).toEqual([]);
    });

    it(`${fn}: a new plan is billed to the customer the address already has`, async () => {
      stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
      stripe.subs.cus_owner = [sub("canceled", PRO)];
      const body = await (await post(fn, {}, "jwt-owner")).json();
      expect(body.url).toBe("https://checkout.stripe.com/c/cs_test_new");
      expect(stripe.created[0]).toMatchObject({ customer: "cus_owner", mode: "subscription" });
      expect(stripe.created[0].customer_email).toBeUndefined();
    });
  }

  it("the Pro checkout calls a live agent plan subscribed (the agent includes Pro)", async () => {
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("trialing", AGENT)];
    const body = await (await post("create-subscription-checkout", {}, "jwt-owner")).json();
    expect(body).toMatchObject({ alreadySubscribed: true, tier: "agent" });
  });

  it("the agent checkout refuses beside a live Pro plan, and proceeds once Pro is set to cancel", async () => {
    stripe.customers["owner@example.com"] = [{ id: "cus_owner" }];
    stripe.subs.cus_owner = [sub("active", PRO)];
    const refused = await (await post("create-agent-checkout", {}, "jwt-owner")).json();
    expect(refused.hasProSubscription).toBe(true);
    expect(stripe.calls).not.toContain("sessions.create");

    stripe.subs.cus_owner = [sub("active", PRO, { cancel_at_period_end: true })];
    const allowed = await (await post("create-agent-checkout", {}, "jwt-owner")).json();
    expect(allowed.url).toBeTruthy();
  });

  it("the agent checkout honours a comped account before asking Stripe", async () => {
    db.rows("agent_subscribers").push({ email: "owner@example.com", status: "active", current_period_end: null, stripe_customer_id: null });
    const body = await (await post("create-agent-checkout", {}, "jwt-owner")).json();
    expect(body).toMatchObject({ alreadySubscribed: true, tier: "agent" });
    expect(stripe.calls).toEqual([]);
  });

  it("a token the auth server refuses is anonymous, never a fallback to the body address", async () => {
    const res = await post("create-subscription-checkout", { email: "owner@example.com" }, "jwt-forged");
    expect(res.status).toBe(401);
    expect(stripe.calls).toEqual([]);
  });

  it("every response of the four carries its build", async () => {
    for (const fn of Object.keys(handlers)) {
      const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      expect(res.headers.get("x-fn-build")).toMatch(new RegExp(`^${fn}\\.2026-10-05\\.\\d+$`));
    }
  });
});
