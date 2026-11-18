// @vitest-environment node
/**
 * A BILLING PORTAL OPENS FOR AN ADDRESS ITS ACCOUNT PROVED BY CODE (S14X-229).
 *
 * create-portal-session asked only the SESSION whether it proved the
 * mailbox (provenMailbox: a Google or Apple sign-in, or confirmation once it
 * is really on). A password account that proved its address with an emailed
 * code (R1's account_mailbox_proofs row) was refused its own unbound plan's
 * portal, while delete-account, get-account-data and account-order accepted
 * that proof. It now asks the account (accountProvenEmail), as they do. The
 * binding gate is unchanged: a plan found only through a row's customer
 * still needs the binding, and a stranger on the same address with no proof
 * row is still refused.
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

const legacy = () => { (world.subs.cus_victim[0] as { metadata: Record<string, string> }).metadata = {}; };

describe("an account whose address is proven by a code (S14X-229)", () => {
  it("a password account whose only proof is its account_mailbox_proofs row gets its unbound plan's portal", async () => {
    legacy();
    db.rows("account_mailbox_proofs").push({ id: "proof-1", user_id: OWNER_ID, email: "subscriber@example.com" });
    const body = await open("jwt-owner");
    expect(body.url).toBe("https://billing.stripe.com/session/cus_victim");
    expect(world.portals).toEqual(["cus_victim"]);
  });

  it("another account's proof row is not this account's: the stranger is still refused", async () => {
    legacy();
    db.rows("account_mailbox_proofs").push({ id: "proof-1", user_id: OWNER_ID, email: "subscriber@example.com" });
    const body = await open("jwt-stranger");
    expect(world.portals).toEqual([]);
    expect(body.code).toBe("mailbox_unproven");
  });

  it("a proof of another address proves nothing here", async () => {
    legacy();
    db.rows("account_mailbox_proofs").push({ id: "proof-2", user_id: OWNER_ID, email: "old-address@example.com" });
    const body = await open("jwt-owner");
    expect(world.portals).toEqual([]);
    expect(body.code).toBe("mailbox_unproven");
  });
});
