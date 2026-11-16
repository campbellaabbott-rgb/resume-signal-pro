// @vitest-environment node
/**
 * A CLOSED ORDER IS NEVER SAID TO BE STILL IN THE MAKING (S14X-111).
 *
 * take_delivery_lease answers NULL for an order that is closed (delivered,
 * refunded, or mailed) and for one another maker holds, and
 * verify-product-purchase read every NULL as "in progress". A buyer whose
 * order was closed with no saved copy was told, for five minutes of asking
 * and on every visit after, that it was still being made and that a mail
 * was coming. take_delivery_lease_status now says why it refused:
 *   - closed and mailed or delivered, no copy kept: closedNoCopy, never
 *     inProgress, and nothing is generated;
 *   - refunded: 402 refunded;
 *   - moved or held by another maker: inProgress, as before;
 *   - the function not there yet (PGRST202): the plain lease, today's answer.
 *
 * And the order row records the currency the payment was taken in (S14X-227).
 *
 * Run against the shipped handler with only its network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, fakeLeaseRpcs, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const RESUME_ID = "11111111-2222-4333-8444-555555555555";
const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const SID = "cs_live_closed_no_copy";

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor() {
    this.checkout = { sessions: { retrieve: async (id) => { const s = globalThis.__closedWorld.sessions[id]; if (!s) throw new Error("No such checkout.session"); return s; } } };
  } }`,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__closedClient; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'x' }, error: null }) }; } }",
};
const env: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness",
};

let verify: EdgeHandler;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });
const world = { sessions: {} as Record<string, unknown> };
const generated: string[] = [];
const steps: Array<Record<string, unknown>> = [];
const leaseStatusCalls: Array<Record<string, unknown>> = [];

const client = {
  from: (t: string) => db.from(t),
  rpc: (name: string, args: Record<string, unknown> = {}) => db.rpc(name, args),
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
};

/** The new function over the fake's rows, with the migration's order of refusals. */
const leaseStatus = (a: Record<string, unknown>) => {
  leaseStatusCalls.push(a);
  const row = db.rows("product_deliveries").find((r) => r.stripe_session_id === a.p_stripe_session_id);
  const refuse = (refusal: string) => ({ data: [{ token: null, refusal }], error: null });
  if (row?.status === "refunded") return refuse("closed_refunded");
  if (row?.status === "delivered") return refuse("closed_delivered");
  if (row?.email_sent_at) return refuse("closed_mailed");
  if (row && row.status !== a.p_seen_status) return refuse("moved");
  if (row && Date.parse(String(row.lease_until ?? "")) > Date.now()) return refuse("leased");
  return { data: [{ token: "lease-status-1", refusal: null }], error: null };
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__closedClient = client;
  g.__closedWorld = world;
  g.fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/functions/v1/generate-")) {
      generated.push(url);
      return new Response(JSON.stringify({ success: true, data: { careerSignalScore: { overall: "Strong" } } }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
}, 180_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  generated.length = 0;
  steps.length = 0;
  leaseStatusCalls.length = 0;
  world.sessions = {
    [SID]: { id: SID, mode: "payment", payment_status: "paid", amount_total: 1500, currency: "inr", customer_email: null,
      customer_details: { email: "buyer@example.com" }, metadata: { product_type: "career_snapshot", product_name: "Career Snapshot" } },
  };
  db.rows("checkout_resume_refs").push({ stripe_session_id: SID, resume_session_id: RESUME_ID });
  db.rpcs = {
    ...fakeLeaseRpcs(db),
    take_delivery_lease_status: leaseStatus,
    get_temp_resume: () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "" }], error: null }),
    get_purchased_content_by_session: () => ({ data: [], error: null }),
    save_purchased_content: () => ({ data: "pc", error: null }),
    check_rate_limit: () => ({ data: true, error: null }),
    log_delivery_step: (a) => { steps.push(a); return { data: "pd-x", error: null }; },
    update_delivery_retry: () => ({ data: true, error: null }),
    mail_door_take: () => ({ data: true, error: null }),
  };
});

/** An order a maker already closed: the claim is written and the row says how it closed. */
const closedOrder = (row: Record<string, unknown>) => {
  db.rows("used_stripe_sessions").push({ session_id: SID, product_type: "career_snapshot" });
  db.rows("product_deliveries").push({ id: "pd-1", stripe_session_id: SID, product_type: "career_snapshot", customer_email: "buyer@example.com", retry_count: 0, max_retries: 8, ...row });
};

const ask = async () => {
  const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5" },
    body: JSON.stringify({ sessionId: SID, generateContent: true }),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("an order closed with no saved copy", () => {
  it("mailed: answered closedNoCopy, never inProgress, and nothing is made", async () => {
    closedOrder({ status: "content_generated", email_sent_at: "2026-11-01T10:00:00Z" });
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ verified: true, closedNoCopy: true, inProgress: false, hasResumeData: false });
    expect(r.body.generatedContent ?? null).toBeNull();
    expect(generated, "the closed order was made again").toEqual([]);
  });

  it("delivered: answered closedNoCopy", async () => {
    closedOrder({ status: "delivered" });
    const r = await ask();
    expect(r.body).toMatchObject({ closedNoCopy: true, inProgress: false });
    expect(generated).toEqual([]);
  });

  it("refunded: a 402 that says refunded", async () => {
    closedOrder({ status: "refunded" });
    const r = await ask();
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ refunded: true, code: "refunded" });
  });
});

describe("an order another maker holds", () => {
  it("whose status moved is still in progress", async () => {
    closedOrder({ status: "generation_failed" });
    db.rpcs.take_delivery_lease_status = () => ({ data: [{ token: null, refusal: "moved" }], error: null });
    const r = await ask();
    expect(r.body).toMatchObject({ inProgress: true });
    expect(r.body.closedNoCopy).toBeUndefined();
  });

  it("whose lease is live is still in progress", async () => {
    closedOrder({ status: "payment_received" });
    db.rpcs.take_delivery_lease_status = () => ({ data: [{ token: null, refusal: "leased" }], error: null });
    const r = await ask();
    expect(r.body).toMatchObject({ inProgress: true });
  });
});

describe("before the migration applies", () => {
  it("the plain lease answers as it does today, and nothing is said about a closed order", async () => {
    closedOrder({ status: "content_generated", email_sent_at: "2026-11-01T10:00:00Z" });
    delete db.rpcs.take_delivery_lease_status;
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ inProgress: true });
    expect(r.body.closedNoCopy).toBeUndefined();
  });

  it("an open order is still leased and made by the plain lease", async () => {
    delete db.rpcs.take_delivery_lease_status;
    const r = await ask();
    expect(r.status).toBe(200);
    expect(generated.length).toBeGreaterThan(0);
  });
});

describe("an open order", () => {
  it("is leased through the new function and made", async () => {
    const r = await ask();
    expect(r.status).toBe(200);
    expect(leaseStatusCalls).toHaveLength(1);
    expect(generated.length).toBeGreaterThan(0);
    expect(r.body.closedNoCopy).toBeUndefined();
  });

  it("records the currency the payment was taken in on its order row (S14X-227)", async () => {
    await ask();
    const paid = steps.find((s) => s.p_step === "payment_received");
    expect((paid?.p_metadata as Record<string, unknown>)?.currency).toBe("inr");
  });
});
