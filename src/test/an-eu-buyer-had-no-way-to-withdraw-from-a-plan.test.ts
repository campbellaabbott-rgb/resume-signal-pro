// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild and the migration runs
// in pglite. The account page's panel is mounted in
// an-eu-buyer-had-no-way-to-withdraw-from-a-plan-on-screen.test.tsx.
/**
 * AN EU BUYER HAD NO WAY TO WITHDRAW FROM A PLAN (owner decision 3,
 * 2026-10-08; commercial-readiness plan item 14).
 *
 * The EU/UK switch built the checkout box and the confirmation's 14-day
 * paragraph, but a withdrawal had nowhere to go but a mailbox, and nothing
 * worked out what was owed back. withdraw-subscription, behind the same
 * switch (off by default):
 *   - off: 404, and Stripe is never called;
 *   - on: a plan this account began in the last 14 days is refunded what was
 *     paid less the days provided, cancelled at once, and the withdrawal is
 *     acknowledged by mail once; a retry refunds nothing twice; a plan past
 *     the period, another account's plan, and a plan naming no account are
 *     left alone.
 *
 * A WITHDRAWAL KEPT THE DAYS PROVIDED FROM A BUYER WHO NEVER ASKED THE PLAN TO
 * START EARLY (wave 3 review). Every refund was cut by the days provided, but
 * art. 14(4)(a)(ii) allows that only when the buyer expressly asked for the
 * service to start inside the period (the checkout's box). Now the days are
 * kept only when the plan, or its checkout session, records that request; a
 * plan without it is refunded in full.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { withdrawalRefundCents, withinWithdrawalPeriod } from "../../supabase/functions/_shared/withdrawal";

const USER = "00000000-0000-4000-8000-00000000e0e1";
const OTHER = "00000000-0000-4000-8000-00000000e0e2";
const DAY = 86_400;
const NOW = () => Math.floor(Date.now() / 1000);

type Sub = { id: string; customer: string; status: string; start_date: number; created: number; currency: string; metadata: Record<string, string>; items: { data: unknown[] } };
type Inv = { id: string; subscription: string; amount_paid: number; currency: string; period_start: number; period_end: number; lines: { data: unknown[] } };
const world = {
  stripeCalls: 0,
  subs: [] as Sub[],
  invoices: [] as Inv[],
  refunds: [] as Array<{ payment_intent: string; amount: number; metadata: Record<string, string>; status: string }>,
  cancelled: [] as string[],
  sessions: [] as Array<{ subscription: string; metadata: Record<string, string> }>,
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__wdWorld;
    const hit = () => { w().stripeCalls++; };
    const page = (data) => ({ data, has_more: false });
    this.customers = { list: async () => { hit(); return page([{ id: "cus_1", address: { country: "DE" } }]); } };
    this.subscriptions = {
      list: async () => { hit(); return page(w().subs); },
      cancel: async (id) => { hit(); w().cancelled.push(id); const s = w().subs.find((x) => x.id === id); if (s) s.status = "canceled"; return s; },
    };
    this.invoices = { list: async ({ subscription }) => { hit(); return page(w().invoices.filter((i) => i.subscription === subscription)); } };
    this.checkout = { sessions: { list: async ({ subscription }) => { hit(); return page(w().sessions.filter((x) => x.subscription === subscription)); } } };
    this.invoicePayments = { list: async ({ invoice }) => { hit(); return page([{ invoice, payment: { type: "payment_intent", payment_intent: "pi_" + invoice } }]); } };
    this.refunds = {
      list: async ({ payment_intent }) => { hit(); return page(w().refunds.filter((r) => r.payment_intent === payment_intent)); },
      create: async (p) => { hit(); const r = { ...p, status: "succeeded" }; w().refunds.push(r); return r; },
    };
  }
}`;

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon", STRIPE_SECRET_KEY: "sk_test",
};
const db = new FakeDb({ subscription_notices: ["subscription_id"] });
const queued: Array<Record<string, unknown>> = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.__wdWorld = world;
  g.__wdDb = Object.assign(db, {
    auth: { getUser: async (jwt: string) => jwt === "jwt-user"
      ? { data: { user: { id: USER, email: "buyer@example.eu" } }, error: null }
      : { data: { user: null }, error: { message: "bad" } } },
  });
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("withdraw-subscription", {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__wdDb;",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  });
  db.rpcs.enqueue_email_delayed = (a) => { queued.push(a); return { data: 1, error: null }; };
}, 180_000);

afterEach(() => {
  delete env.EU_UK_SALES;
  world.stripeCalls = 0; world.subs = []; world.invoices = []; world.refunds = []; world.cancelled = []; world.sessions = [];
  db.tables = {}; queued.length = 0;
});

const call = (jwt = "jwt-user") => handler(new Request("https://harness.supabase.co/functions/v1/withdraw-subscription", {
  method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: "{}",
}));

/** The checkout's service-start request, as create-*-checkout copies it onto the plan. */
const STARTED_EARLY = { service_start_consent: "2026-10-09" };
const sub = (id: string, daysAgo: number, buyer: string | null, status = "active", extra: Record<string, string> = STARTED_EARLY): Sub => ({
  id, customer: "cus_1", status, start_date: NOW() - daysAgo * DAY, created: NOW() - daysAgo * DAY, currency: "eur",
  metadata: buyer ? { user_id: buyer, ...extra } : {}, items: { data: [{ price: { unit_amount: 4500, currency: "eur" } }] },
});
const paid = (subscription: string, daysAgo: number, amount = 4500): Inv => ({
  id: `in_${subscription}`, subscription, amount_paid: amount, currency: "eur",
  period_start: NOW() - daysAgo * DAY, period_end: NOW() - daysAgo * DAY + 30 * DAY, lines: { data: [] },
});

describe("the switch", () => {
  it("answers 404 while EU_UK_SALES is off, and never reaches Stripe", async () => {
    world.subs = [sub("sub_a", 3, USER)];
    const res = await call();
    expect(res.status).toBe(404);
    expect(world.stripeCalls).toBe(0);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "withdraw-subscription", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  });
});

describe("with the switch on", () => {
  it("refunds what was paid less the days provided, cancels the plan, and acknowledges it once", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_a", 3, USER)];
    world.invoices = [paid("sub_a", 3)];
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json() as { withdrawn: Array<{ subscription: string; refunded: number; currency: string }> };
    // Three of thirty days provided: 4500 less 450, give or take the seconds the call took.
    expect(body.withdrawn).toHaveLength(1);
    expect(body.withdrawn[0].refunded).toBeGreaterThanOrEqual(4049);
    expect(body.withdrawn[0].refunded).toBeLessThanOrEqual(4050);
    expect(world.refunds).toEqual([expect.objectContaining({ payment_intent: "pi_in_sub_a", metadata: { withdrawal: "14_day", subscription: "sub_a" } })]);
    expect(world.cancelled).toEqual(["sub_a"]);
    expect(queued).toHaveLength(1);
    const payload = queued[0].payload as { to: string; subject: string; text: string };
    expect(payload.to).toBe("buyer@example.eu");
    expect(payload.text).toMatch(/cancelled and will not charge you again/);
    expect(payload.text).toMatch(/€40\.(49|50)/);
  });

  it("a plan that never recorded the buyer's request to start early is refunded in full", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_a", 3, USER, "active", {})];
    world.invoices = [paid("sub_a", 3)];
    const body = await (await call()).json() as { withdrawn: Array<{ refunded: number }> };
    expect(body.withdrawn[0].refunded, "the days provided were kept without the buyer's request").toBe(4500);
    expect(world.refunds).toEqual([expect.objectContaining({ amount: 4500 })]);
  });

  it("the request is read from the plan's checkout session when the plan itself does not carry it", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_a", 3, USER, "active", {})];
    world.invoices = [paid("sub_a", 3)];
    world.sessions = [{ subscription: "sub_a", metadata: { ...STARTED_EARLY } }];
    const body = await (await call()).json() as { withdrawn: Array<{ refunded: number }> };
    expect(body.withdrawn[0].refunded).toBeGreaterThanOrEqual(4049);
    expect(body.withdrawn[0].refunded).toBeLessThanOrEqual(4050);
  });

  it("a retry after the refund went through and the cancel did not refunds nothing more", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_a", 3, USER)];
    world.invoices = [paid("sub_a", 3)];
    world.refunds = [{ payment_intent: "pi_in_sub_a", amount: 4050, metadata: { withdrawal: "14_day", subscription: "sub_a" }, status: "succeeded" }];
    const res = await call();
    const body = await res.json() as { withdrawn: Array<{ refunded: number }> };
    expect(world.refunds).toHaveLength(1);
    expect(body.withdrawn[0].refunded).toBe(4050);
    expect(world.cancelled).toEqual(["sub_a"]);
    // And once cancelled, the plan is no longer there to withdraw from.
    const again = await (await call()).json() as { withdrawn: unknown[]; reason: string };
    expect(again).toEqual({ withdrawn: [], reason: "none_eligible" });
    expect(queued).toHaveLength(1);
  });

  it("a trial that charged nothing is cancelled with nothing refunded", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_t", 2, USER, "trialing")];
    const body = await (await call()).json() as { withdrawn: Array<{ refunded: number }> };
    expect(body.withdrawn).toEqual([{ subscription: "sub_t", refunded: 0, currency: "eur" }]);
    expect(world.refunds).toEqual([]);
    expect(world.cancelled).toEqual(["sub_t"]);
    expect((queued[0].payload as { text: string }).text).toMatch(/nothing to refund/);
  });

  it("leaves alone a plan past the 14 days, another account's plan, and one that names no account", async () => {
    env.EU_UK_SALES = "on";
    world.subs = [sub("sub_old", 20, USER), sub("sub_other", 2, OTHER), sub("sub_unlinked", 2, null)];
    world.invoices = [paid("sub_old", 20), paid("sub_other", 2), paid("sub_unlinked", 2)];
    const body = await (await call()).json() as { withdrawn: unknown[]; reason: string };
    expect(body).toEqual({ withdrawn: [], reason: "plan_not_linked" });
    expect(world.refunds).toEqual([]);
    expect(world.cancelled).toEqual([]);
  });

  it("refuses a caller with no session", async () => {
    env.EU_UK_SALES = "on";
    expect((await call("nope")).status).toBe(401);
  });
});

describe("the rules", () => {
  it("the period is 14 days from the start, and the refund never charges more than the days provided", () => {
    const start = 1_700_000_000;
    expect(withinWithdrawalPeriod(start, start + 14 * DAY)).toBe(true);
    expect(withinWithdrawalPeriod(start, start + 14 * DAY + 1)).toBe(false);
    expect(withinWithdrawalPeriod(0, start)).toBe(false);
    expect(withdrawalRefundCents(4500, start, start + 30 * DAY, start, true)).toBe(4500);
    expect(withdrawalRefundCents(4500, start, start + 30 * DAY, start + 10 * DAY, true)).toBe(3000);
    expect(withdrawalRefundCents(4500, start, start + 30 * DAY, start + 40 * DAY, true)).toBe(0);
    expect(withdrawalRefundCents(4500, start, start, start, true)).toBe(4500);
    expect(withdrawalRefundCents(1, start, start + 3 * DAY, start + DAY, true)).toBe(1);
    // Without the buyer's request to start early, nothing is kept for the days provided.
    expect(withdrawalRefundCents(4500, start, start + 30 * DAY, start + 10 * DAY, false)).toBe(4500);
  });
});

describe("the ledger (20261009133000) in a real Postgres", () => {
  it("accepts a withdrawal once, still refuses an unknown kind, and runs twice", async () => {
    const pg = new PGlite();
    await pg.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    const dir = resolve(__dirname, "../../supabase/migrations");
    await pg.exec(readFileSync(resolve(dir, "20261009130000_a_subscription_notice_is_sent_once_per_subscription_and_kind.sql"), "utf8"));
    const sql = readFileSync(resolve(dir, "20261009133000_a_withdrawal_is_acknowledged_once_per_subscription.sql"), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    await pg.exec("INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_x', 'withdrawal', 'a@b.co')");
    await expect(pg.exec("INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_x', 'withdrawal', 'a@b.co')")).rejects.toThrow(/duplicate key/);
    await expect(pg.exec("INSERT INTO public.subscription_notices (subscription_id, kind, email) VALUES ('sub_y', 'refund', 'a@b.co')")).rejects.toThrow(/subscription_notices_kind_check/);
    await pg.close();
  }, 60_000);
});
