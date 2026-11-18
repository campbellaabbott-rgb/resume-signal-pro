// @vitest-environment node
/**
 * A PRO CHECKOUT LASTS THIRTY MINUTES AND CLOSES THE ACCOUNT'S OLDER OPEN
 * ONE, AND A DELETED ACCOUNT LEAVES NO CHECKOUT OPEN (S14X-076).
 *
 * WHAT WAS WRONG. create-subscription-checkout set no expires_at, so each
 * Pro checkout page stayed payable for Stripe's default day; a second tab or
 * a reload opened another, and paying both sold two plans (the double-billing
 * guard reads plans, and an open page is not one yet). delete-account
 * cancelled the plans and deleted the account while such a page stayed open.
 *
 * WHAT HOLDS NOW, on the shipped handlers:
 *   - a Pro checkout asks Stripe for a page that lasts thirty minutes, and its
 *     checkout_starts row records when it ends;
 *   - before it, every Pro checkout this account started in the last day is
 *     expired (Stripe refuses one already paid or ended; that is ignored);
 *     another account's, an older one, and a Full Analysis page are left;
 *   - delete-account expires every checkout the account started in the last
 *     day, while checkout_buyers still names it, before any plan is cancelled
 *     or the account deleted.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { TERMS_VERSION } from "../../supabase/functions/_shared/checkout-policy";

const BUYER = { id: "00000000-0000-4000-8000-000000076a01", email: "buyer@example.com" };
const OTHER = "00000000-0000-4000-8000-000000076a02";
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;

describe("create-subscription-checkout", () => {
  let h: Record<string, EdgeHandler>;
  let world: W4bWorld;
  let starts: Array<Record<string, unknown>>;
  beforeAll(async () => {
    installDeno();
    h = await loadCheckouts(["create-subscription-checkout"]);
  }, 240_000);
  beforeEach(() => {
    world = freshWorld({ "jwt-buyer": BUYER });
    starts = [];
    world.db.rpcs.record_checkout_start = (a) => { starts.push(a); return { data: true, error: null }; };
  });
  const subscribe = () => post(h["create-subscription-checkout"], "create-subscription-checkout",
    { language: "en", termsVersion: TERMS_VERSION, autoRenewConsent: true }, { bearer: "jwt-buyer" });

  it("asks Stripe for a page that lasts thirty minutes, and the start records when it ends", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await subscribe();
    expect(res.status).toBe(200);
    const expiresAt = world.stripe.created[0].expires_at as number;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * 60);
    expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 30 * 60);
    expect((starts[0].p_metadata as Record<string, unknown>).expiresAt).toBe(new Date(expiresAt * 1000).toISOString());
  });

  it("expires the account's earlier open Pro checkout first, and nobody else's", async () => {
    world.db.rows("checkout_buyers").push(
      { stripe_session_id: "cs_test_mine_open", user_id: BUYER.id, checkout_function: "create-subscription-checkout", created_at: ago(10 * MIN) },
      { stripe_session_id: "cs_test_someone_else", user_id: OTHER, checkout_function: "create-subscription-checkout", created_at: ago(10 * MIN) },
      { stripe_session_id: "cs_test_mine_old", user_id: BUYER.id, checkout_function: "create-subscription-checkout", created_at: ago(2 * 24 * 60 * MIN) },
      { stripe_session_id: "cs_test_mine_analysis", user_id: BUYER.id, checkout_function: "create-checkout", created_at: ago(5 * MIN) },
    );
    expect((await subscribe()).status).toBe(200);
    const expired = world.stripe.touched.filter((t) => t.startsWith("sessions.expire:"));
    expect(expired).toEqual(["sessions.expire:cs_test_mine_open"]);
    expect(world.stripe.touched.indexOf("sessions.expire:cs_test_mine_open")).toBeLessThan(world.stripe.touched.indexOf("sessions.create"));
  });
});

describe("delete-account", () => {
  const SESSION_JWT = (() => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "none" })}.${b64({ sub: BUYER.id, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;
  })();
  const state = { order: [] as string[], refuse: new Set<string>() };
  let handler: EdgeHandler;
  let db: FakeDb;
  beforeAll(async () => {
    const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", STRIPE_SECRET_KEY: "sk_test" };
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
    g.__s076 = state;
    g.__s076Client = () => ({
      from: (t: string) => db.from(t),
      rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
      auth: {
        getUser: async (token: string) => (token === SESSION_JWT ? { data: { user: { id: BUYER.id, email: BUYER.email, identities: [] } }, error: null } : { data: { user: null }, error: { message: "no" } }),
        admin: { deleteUser: async () => { state.order.push("deleteUser"); return { error: null }; } },
      },
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
    });
    handler = await loadEdgeHandler("delete-account", {
      "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
        const s = () => globalThis.__s076;
        this.customers = { list: async () => ({ data: [], has_more: false }) };
        this.subscriptions = { list: async () => ({ data: [], has_more: false }), search: async () => ({ data: [], has_more: false }), cancel: async (id) => { s().order.push("cancel:" + id); return {}; } };
        this.checkout = { sessions: { expire: async (id) => { if (s().refuse.has(id)) throw new Error("not open"); s().order.push("expire:" + id); return {}; } } };
      } }`,
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient(...a) { return globalThis.__s076Client(...a); }",
    });
  }, 120_000);
  beforeEach(() => {
    db = new FakeDb();
    db.rpcs.account_erase_personal_data = () => { state.order.push("erase"); return { data: { keys_revoked: 0 }, error: null }; };
    state.order = [];
    state.refuse = new Set();
  });
  const del = async () => (await handler(new Request("https://harness.supabase.co/functions/v1/delete-account", { method: "POST", headers: { authorization: `Bearer ${SESSION_JWT}` } }))).status;

  it("expires the account's checkouts of the last day before the account goes, and no one else's", async () => {
    db.rows("checkout_buyers").push(
      { stripe_session_id: "cs_live_pro_open", user_id: BUYER.id, checkout_function: "create-subscription-checkout", created_at: ago(20 * MIN) },
      { stripe_session_id: "cs_live_fa_open", user_id: BUYER.id, checkout_function: "create-checkout", created_at: ago(5 * MIN) },
      { stripe_session_id: "cs_live_old", user_id: BUYER.id, checkout_function: "create-checkout", created_at: ago(3 * 24 * 60 * MIN) },
      { stripe_session_id: "cs_live_other", user_id: OTHER, checkout_function: "create-checkout", created_at: ago(5 * MIN) },
    );
    expect(await del()).toBe(200);
    expect(state.order.filter((o) => o.startsWith("expire:")).sort()).toEqual(["expire:cs_live_fa_open", "expire:cs_live_pro_open"]);
    expect(state.order.indexOf("deleteUser")).toBeGreaterThan(Math.max(state.order.indexOf("expire:cs_live_fa_open"), state.order.indexOf("expire:cs_live_pro_open")));
  });

  it("a session Stripe will not expire (already paid or ended) never stops the deletion", async () => {
    db.rows("checkout_buyers").push({ stripe_session_id: "cs_live_paid", user_id: BUYER.id, checkout_function: "create-checkout", created_at: ago(5 * MIN) });
    state.refuse.add("cs_live_paid");
    expect(await del()).toBe(200);
    expect(state.order).toContain("deleteUser");
  });
});
