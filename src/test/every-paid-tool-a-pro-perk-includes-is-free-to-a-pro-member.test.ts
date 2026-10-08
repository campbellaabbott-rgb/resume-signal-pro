// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness).
/**
 * EVERY PAID TOOL A PRO PERK INCLUDES IS FREE TO A PRO MEMBER.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L3-04; owner decision
 * 2026-10-04: the Full Analysis IS part of Pro). The Pro card and the Stripe
 * page that takes the $45 both said "Every paid tool included -- Full
 * Analysis, ...". A Pro member who clicked "Get full analysis" went to
 * create-checkout, which had no signed-in path at all, and Stripe charged them
 * $5 for a tool sold to them as included.
 *
 * WHAT HOLDS NOW, against the shipped handlers:
 *   - for EVERY one-time product on sale, the checkout that sells it hands a
 *     signed-in Pro member a grant instead of a Stripe session -- the Full
 *     Analysis through create-checkout, everything else through
 *     create-product-checkout -- because one perk line claims every paid tool;
 *   - the Full Analysis grant is redeemed by analyze-resume once, like a paid
 *     session; a trial, a refunded grant or another product's grant is not.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { analyzeResumeHarness, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { isProductHidden, PRODUCTS, type ProductId } from "@/config/products";
import { PRO_PERKS } from "@/config/pro-perks";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const MEMBER = { id: "00000000-0000-4000-8000-00000000f101", email: "member@example.com" };
const TRIALIST = { id: "00000000-0000-4000-8000-00000000f102", email: "trialist@example.com" };
const soon = () => new Date(Date.now() + 20 * 86400_000).toISOString();
const PLANS: Record<string, unknown[]> = {
  [MEMBER.id]: [{ tier: "pro", status: "active", current_period_end: soon(), bound: true }],
  [TRIALIST.id]: [{ tier: "agent", status: "trialing", current_period_end: soon(), bound: true }],
};
const TOKENS: Record<string, { id: string; email: string }> = { "jwt-member": MEMBER, "jwt-trialist": TRIALIST };

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__perkStripe;
    this.promotionCodes = { list: async () => ({ data: [] }) };
    this.checkout = { sessions: {
      create: async (p) => { w().created.push(p); return { id: "cs_test_perk", url: "https://checkout.stripe.com/c/cs_test_perk", amount_total: 500, currency: "usd", mode: p.mode }; },
      expire: async () => ({}),
    } };
  }
}`;
const SERVER = "export function serve(h) { globalThis.__edgeHandler = h; }";
// create-checkout keeps its client at module level, so the stub hands out a
// client that reads the CURRENT fake on every call.
const CLIENT = "export const getServiceClient = () => ({ from: (t) => globalThis.__perkClient.from(t), rpc: (n, a) => globalThis.__perkClient.rpc(n, a), auth: { getUser: (j) => globalThis.__perkClient.auth.getUser(j) } });";

const handlers: Record<string, EdgeHandler> = {};
let db: FakeDb;
let stripe: { created: Array<Record<string, unknown>> };

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness_key_0123456789abcdef0123456789",
    SUPABASE_ANON_KEY: "anon_harness_key",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  const stubs = {
    "https://deno.land/std@0.190.0/http/server.ts": SERVER,
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient() { return globalThis.__perkClient; }",
    "_shared/supabase-client.ts": CLIENT,
  };
  handlers["create-checkout"] = await loadEdgeHandler("create-checkout", stubs);
  handlers["create-product-checkout"] = await loadEdgeHandler("create-product-checkout", stubs);
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.record_checkout_start = () => ({ data: true, error: null });
  db.rpcs.pro_entitlement_rows = (a) => ({ data: PLANS[String(a.p_user_id)] ?? [], error: null });
  stripe = { created: [] };
  const g = globalThis as Record<string, unknown>;
  g.__perkStripe = stripe;
  g.__perkClient = {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: { getUser: async (jwt: string) => (TOKENS[jwt] ? { data: { user: TOKENS[jwt] }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) },
  };
});

const buy = async (productId: ProductId, bearer: string) => {
  const usesMain = (PRODUCTS[productId] as { useMainCheckout?: boolean }).useMainCheckout === true;
  const fn = usesMain ? "create-checkout" : "create-product-checkout";
  const body = usesMain ? { currency: "usd", tempSessionId: "00000000-0000-4000-8000-0000000000aa" } : { productId };
  const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, "cf-connecting-ip": "198.51.100.61", origin: "https://resumebooster.work" },
    body: JSON.stringify(body),
  }));
  return { fn, status: res.status, json: await res.json() as Record<string, unknown> };
};

const onSale = (Object.keys(PRODUCTS) as ProductId[]).filter((id) => !isProductHidden(id));

describe("the checkout of every paid tool hands a Pro member the tool, not a bill", () => {
  it("PRECONDITION: a Pro perk says every paid tool is included", () => {
    // If this line ever leaves the card, the claim below is no longer made
    // and this file can be narrowed on purpose.
    expect(PRO_PERKS.some((p) => /every paid tool included/i.test(p))).toBe(true);
    expect(onSale.length).toBeGreaterThan(3);
  });

  it.each(onSale)("%s", async (productId) => {
    const r = await buy(productId, "jwt-member");
    expect(r.status, `${r.fn}: ${JSON.stringify(r.json)}`).toBe(200);
    expect(r.json.proIncluded, `${productId} through ${r.fn} sent a Pro member to Stripe`).toBe(true);
    expect(String(r.json.sessionId)).toMatch(/^pro_/);
    expect(stripe.created).toEqual([]);
    expect(db.rows("pro_grants")[0]).toMatchObject({ user_id: MEMBER.id });
  });

  it("the Full Analysis grant lands on the success page that redeems it, naming the product", async () => {
    const r = await buy("fullAnalysis", "jwt-member");
    expect(String(r.json.url)).toMatch(/^https:\/\/resumebooster\.work\/success\?session_id=pro_/);
    expect(db.rows("pro_grants")[0]).toMatchObject({ product_type: "full_analysis", email: MEMBER.email });
  });

  it("a trial, or a stranger, pays the price (a trial mints no consumable)", async () => {
    for (const bearer of ["jwt-trialist", "anon_harness_key"]) {
      const r = await buy("fullAnalysis", bearer);
      expect(r.json.proIncluded, bearer).toBeUndefined();
      expect(String(r.json.url)).toContain("checkout.stripe.com");
    }
    expect(db.rows("pro_grants")).toEqual([]);
  });
});

describe("analyze-resume redeems a Pro member's grant once, like a paid session", () => {
  let h: Harness;
  const grant = (over: Record<string, unknown> = {}) => {
    const id = `${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000001`;
    h.db.rows("pro_grants").push({ id, email: MEMBER.email, user_id: MEMBER.id, product_id: "fullAnalysis", product_type: "full_analysis", consumed_at: null, revoked_at: null, ...over });
    return { id, sessionId: `pro_${id}` };
  };

  beforeAll(async () => { h = await analyzeResumeHarness(); }, 180_000);
  beforeEach(() => {
    h.reset();
    h.db.rpcs.pro_entitlement_rows = (a) => ({ data: PLANS[String(a.p_user_id)] ?? [], error: null });
  });

  it("delivers the analysis, stamps the grant spent, and answers a replay from the redemption", async () => {
    const { id, sessionId } = grant();
    const first = await h.call({ resumeText: RESUME, sessionId });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json.shareId).toBeTruthy();
    expect(h.db.rows("pro_grants").find((g) => g.id === id)?.consumed_at).toBeTruthy();
    const again = await h.call({ resumeText: RESUME, sessionId });
    expect(again.status).toBe(200);
    expect(again.json.alreadyDelivered).toBe(true);
    expect(h.aiCalls()).toBe(1);
  });

  it("a grant whose account is only trialing now, a refunded grant, and another product's grant are refused before any AI spend", async () => {
    for (const over of [{ user_id: TRIALIST.id }, { revoked_at: new Date().toISOString() }, { product_type: "cover_letter" }]) {
      const { sessionId } = grant(over);
      const r = await h.call({ resumeText: RESUME, sessionId });
      expect(r.status, JSON.stringify(over)).toBe(402);
    }
    expect(h.aiCalls()).toBe(0);
  });
});
