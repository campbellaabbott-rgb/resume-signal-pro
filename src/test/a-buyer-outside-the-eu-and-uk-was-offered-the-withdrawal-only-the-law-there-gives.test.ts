// @vitest-environment node
//
// Node, not jsdom: both handlers are bundled with esbuild (helpers/edge-harness).
// The account page's panel is mounted in
// an-eu-buyer-had-no-way-to-withdraw-from-a-plan-on-screen.test.tsx.
/**
 * A BUYER OUTSIDE THE EU AND THE UK WAS OFFERED THE WITHDRAWAL ONLY THE LAW
 * THERE GIVES (wave 3 review of payments-account).
 *
 * WHAT WAS WRONG. With EU_UK_SALES on, withdraw-subscription refunded and
 * cancelled any account's plan bought in the last 14 days, wherever the buyer
 * was billed, and the confirmation mail told every subscriber they could
 * withdraw. The panel's own copy says the right is for buyers from the EU or
 * the UK, and the owner's rule is no refunds but where the law requires one:
 * a US Pro subscriber on day 10 could take back 20/30 of $45.
 *
 * WHAT HOLDS NOW, against the shipped handlers with Stripe and the database
 * faked: the withdrawal is refused for a plan billed outside the EU, the EEA
 * and the UK, and for one whose country cannot be read; the address on the
 * plan's latest paid invoice decides before the customer's; a preview says
 * whether a plan is eligible and changes nothing; and the confirmation's
 * 14-day paragraph goes only to a buyer billed in those countries.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { inWithdrawalTerritory } from "../../supabase/functions/_shared/withdrawal";

const USER = "00000000-0000-4000-8000-00000000e0e1";
const DAY = 86_400;
const NOW = () => Math.floor(Date.now() / 1000);

const world = {
  customerCountry: null as string | null,
  invoiceCountry: null as string | null,
  subs: [] as Array<Record<string, unknown>>,
  refunds: [] as Array<Record<string, unknown>>,
  cancelled: [] as string[],
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__terrWorld;
    const page = (data) => ({ data, has_more: false });
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.customers = {
      list: async () => page([{ id: "cus_1", address: w().customerCountry ? { country: w().customerCountry } : null }]),
      retrieve: async (id) => ({ id, email: "buyer@example.com" }),
    };
    this.subscriptions = {
      list: async () => page(w().subs),
      retrieve: async (id) => w().subs.find((s) => s.id === id),
      cancel: async (id) => { w().cancelled.push(id); return {}; },
    };
    this.invoices = { list: async ({ subscription }) => page([{
      id: "in_" + subscription, subscription, amount_paid: 4500, currency: "usd",
      period_start: Math.floor(Date.now() / 1000) - 10 * 86400, period_end: Math.floor(Date.now() / 1000) + 20 * 86400,
      customer_address: w().invoiceCountry ? { country: w().invoiceCountry } : null, lines: { data: [] },
    }]) };
    this.invoicePayments = { list: async ({ invoice }) => page([{ payment: { payment_intent: "pi_" + invoice } }]) };
    this.refunds = { list: async () => page([]), create: async (p) => { w().refunds.push(p); return p; } };
  }
}`;

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon",
  STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec", EU_UK_SALES: "on",
};
let db = new FakeDb();
const queued: Array<Record<string, unknown>> = [];
let withdraw: EdgeHandler;
let webhook: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.__terrWorld = world;
  g.__terrDb = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (jwt: string) => jwt === "jwt-user"
      ? { data: { user: { id: USER, email: "buyer@example.com" } }, error: null }
      : { data: { user: null }, error: { message: "bad" } } },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  withdraw = await loadEdgeHandler("withdraw-subscription", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__terrDb;",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  });
  webhook = await loadEdgeHandler("stripe-webhook", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__terrDb; export class SupabaseClient {}",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
  });
}, 180_000);

afterEach(() => {
  Object.assign(world, { customerCountry: null, invoiceCountry: null, subs: [], refunds: [], cancelled: [] });
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  queued.length = 0;
});

const proPlan = () => ({
  id: "sub_pro", customer: "cus_1", status: "active", start_date: NOW() - 10 * DAY, created: NOW() - 10 * DAY, currency: "usd",
  trial_end: null, cancel_at_period_end: false, cancel_at: null, metadata: { user_id: USER },
  items: { data: [{ price: { unit_amount: 4500, currency: "usd", recurring: { interval: "month" } } }] },
});
const call = async (body: Record<string, unknown> = {}) => {
  db.rpcs.enqueue_email_delayed = (a) => { queued.push(a); return { data: 1, error: null }; };
  const res = await withdraw(new Request("https://harness.supabase.co/functions/v1/withdraw-subscription", {
    method: "POST", headers: { authorization: "Bearer jwt-user", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), "withdraw-subscription", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("withdraw-subscription, with the switch on", () => {
  it("refuses a US subscriber's plan on day 10: no refund, no cancel, and says why", async () => {
    world.customerCountry = "US";
    world.invoiceCountry = "US";
    world.subs = [proPlan()];
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ withdrawn: [], reason: "outside_territory" });
    expect(world.refunds).toEqual([]);
    expect(world.cancelled).toEqual([]);
    expect(queued).toEqual([]);
  });

  it("withdraws the same plan billed to a German address", async () => {
    world.customerCountry = "DE";
    world.invoiceCountry = "DE";
    world.subs = [proPlan()];
    const r = await call();
    expect((r.body.withdrawn as unknown[]).length).toBe(1);
    expect(world.cancelled).toEqual(["sub_pro"]);
    expect(world.refunds).toHaveLength(1);
  });

  it("the address the plan was invoiced at decides before the customer's later one", async () => {
    world.customerCountry = "FR";
    world.invoiceCountry = "US";
    world.subs = [proPlan()];
    expect((await call()).body).toEqual({ withdrawn: [], reason: "outside_territory" });
    world.customerCountry = "US";
    world.invoiceCountry = "GB";
    expect(((await call()).body.withdrawn as unknown[]).length).toBe(1);
  });

  it("assumes no right when no country can be read", async () => {
    world.subs = [proPlan()];
    expect((await call()).body).toEqual({ withdrawn: [], reason: "outside_territory" });
    expect(world.cancelled).toEqual([]);
  });

  it("a preview says whether a plan is eligible and changes nothing", async () => {
    world.subs = [proPlan()];
    world.invoiceCountry = "NL";
    expect((await call({ preview: true })).body).toEqual({ eligible: 1 });
    world.invoiceCountry = "US";
    expect((await call({ preview: true })).body).toEqual({ eligible: 0, reason: "outside_territory" });
    expect(world.refunds).toEqual([]);
    expect(world.cancelled).toEqual([]);
  });
});

describe("the confirmation mail's 14-day paragraph", () => {
  const confirm = async (country: string | null) => {
    world.subs = [proPlan()];
    db.rpcs.enqueue_email_delayed = (a) => { queued.push(a); return { data: 1, error: null }; };
    const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
      body: JSON.stringify({ id: `evt_${country}`, type: "checkout.session.completed", data: { object: {
        id: `cs_test_${country}`, mode: "subscription", subscription: "sub_pro", customer: "cus_1",
        customer_details: { email: "buyer@example.com", address: country ? { country } : null },
        payment_status: "paid", amount_total: 4500, metadata: { product_type: "pro_subscription" },
      } } }),
    }));
    expect(res.status).toBe(200);
    const notice = queued.find((q) => (q.payload as { label?: string }).label === "subscription-confirmation");
    expect(notice, "no confirmation queued").toBeTruthy();
    return String((notice!.payload as { text: string }).text);
  };

  it("is in the mail to a buyer billed in Ireland, and not in the mail to one billed in the US", async () => {
    expect(await confirm("IE")).toMatch(/You may withdraw from this contract within 14 days/);
    db = new FakeDb({ used_stripe_sessions: ["session_id"] });
    queued.length = 0;
    expect(await confirm("US")).not.toMatch(/withdraw/i);
  });
});

describe("the territory", () => {
  it("is the EU, the rest of the EEA and the UK, and nothing without a country", () => {
    for (const c of ["DE", "fr", "IE", "GB", "NO", "IS", "LI", "MT"]) expect(inWithdrawalTerritory(c), c).toBe(true);
    for (const c of ["US", "CA", "CH", "AU", "IN", "", null, undefined, "EU", "GBR"]) expect(inWithdrawalTerritory(c), String(c)).toBe(false);
  });
});
