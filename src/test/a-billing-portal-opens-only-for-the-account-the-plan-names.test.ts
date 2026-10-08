// @vitest-environment node
/**
 * A BILLING PORTAL OPENS ONLY FOR THE ACCOUNT THE PLAN NAMES (sweep S8-001).
 *
 * While sign-ups are auto-confirmed, anyone can register a subscriber's
 * address and hold a session for it at once. create-portal-session handed
 * that session the subscriber's Stripe billing portal: card last four,
 * billing address, invoices, and the cancel button. It now opens the portal
 * only for the account the plan's metadata names, or a session that proved
 * the mailbox; anyone else is sent to Stripe's emailed portal login (which
 * proves the mailbox itself), or told how to reach it.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const OWNER_ID = "00000000-0000-4000-8000-0000000000e1";
const STRANGER_ID = "00000000-0000-4000-8000-0000000000e9";
const LOGIN_URL = "https://billing.stripe.com/p/login/test_harness";

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__portalStripe;
    this.customers = { list: async ({ email }) => ({ data: w().customers[email] ?? [], has_more: false }) };
    this.subscriptions = { list: async ({ customer }) => ({ data: w().subs[customer] ?? [], has_more: false }) };
    this.billingPortal = { sessions: { create: async (p) => { w().portals.push(p.customer); return { url: "https://billing.stripe.com/session/" + p.customer }; } } };
  }
}`;

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_test_harness",
};

let handler: EdgeHandler;
let db: FakeDb;
let world: { customers: Record<string, Array<{ id: string }>>; subs: Record<string, unknown[]>; portals: string[] };
const users: Record<string, { id: string; email: string }> = {
  "jwt-owner": { id: OWNER_ID, email: "subscriber@example.com" },
  "jwt-stranger": { id: STRANGER_ID, email: "subscriber@example.com" },
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  // The auth server still auto-confirms: no session proves a mailbox by email.
  g.fetch = async () => new Response(JSON.stringify({ mailer_autoconfirm: true }), { status: 200 });
  handler = await loadEdgeHandler("create-portal-session", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient() { return globalThis.__portalClient; }",
  });
});

beforeEach(() => {
  db = new FakeDb();
  db.unique = { pro_subscribers: ["email"] };
  world = {
    customers: { "subscriber@example.com": [{ id: "cus_victim" }] },
    subs: { cus_victim: [{ id: "sub_1", status: "active", metadata: { user_id: OWNER_ID }, items: { data: [{ price: { unit_amount: 4500 }, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20 }] } }] },
    portals: [],
  };
  delete env.STRIPE_PORTAL_LOGIN_URL;
  const g = globalThis as Record<string, unknown>;
  g.__portalStripe = world;
  g.__portalClient = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (jwt: string) => ({ data: { user: users[jwt] ?? null }, error: users[jwt] ? null : { message: "bad jwt" } }) },
  };
});

const open = async (jwt: string) =>
  (await handler(new Request("https://harness.supabase.co/functions/v1/create-portal-session", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", origin: "https://resumebooster.work" },
    body: "{}",
  }))).json();

describe("create-portal-session", () => {
  it("opens the portal for the account the plan's metadata names", async () => {
    const body = await open("jwt-owner");
    expect(body.url).toBe("https://billing.stripe.com/session/cus_victim");
    expect(world.portals).toEqual(["cus_victim"]);
  });

  it("does not open it for another account that registered the same address", async () => {
    const body = await open("jwt-stranger");
    expect(world.portals, "the victim's portal was created for a stranger").toEqual([]);
    expect(body.url).toBeUndefined();
    expect(body.code).toBe("mailbox_unproven");
    expect(body.error).toMatch(/resumeboostersupp@gmail\.com/);
  });

  it("sends an unproven session to Stripe's emailed login when one is configured, so the subscriber can still cancel", async () => {
    env.STRIPE_PORTAL_LOGIN_URL = LOGIN_URL;
    const body = await open("jwt-stranger");
    expect(body).toEqual({ url: LOGIN_URL, verify: "email" });
    expect(world.portals).toEqual([]);
  });

  it("a configured login URL that is not Stripe's is never handed out", async () => {
    env.STRIPE_PORTAL_LOGIN_URL = "https://evil.example/p/login";
    const body = await open("jwt-stranger");
    expect(body.url).toBeUndefined();
    expect(body.code).toBe("mailbox_unproven");
  });

  it("a plan bought before plans named their buyer is not opened by address alone", async () => {
    (world.subs.cus_victim[0] as { metadata: Record<string, string> }).metadata = {};
    const body = await open("jwt-owner");
    expect(world.portals).toEqual([]);
    expect(body.code).toBe("mailbox_unproven");
  });
});
