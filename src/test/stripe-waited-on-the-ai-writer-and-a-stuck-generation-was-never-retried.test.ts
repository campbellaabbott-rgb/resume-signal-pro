// @vitest-environment node
/**
 * STRIPE WAITED ON THE AI WRITER, AND A STUCK GENERATION WAS NEVER RETRIED
 * (commercial-readiness 2026-10-08, item 2).
 *
 * WHAT WAS WRONG.
 *   - stripe-webhook awaited the product's generation (up to ~90 s) before it
 *     answered checkout.session.completed. Stripe wants its 2xx within
 *     seconds and redelivers on a timeout.
 *   - get_failed_deliveries_for_retry never selected a 'generating' row, so
 *     a generation whose isolate died stayed 'generating' for ever: counted
 *     as stuck by the monitor, retried by nobody.
 *
 * WHAT HOLDS NOW: the shipped webhook answers while its generator is still
 * working and finishes the delivery afterwards; the shipped selector (in a
 * real Postgres) picks a 'generating' row only once its generation began
 * fifteen minutes ago; the shipped sweeper regenerates such a row, and
 * records a repeat failure as generation_failed.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler, fakeLeaseRpcs } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const RESUME_ID = "11111111-2222-4333-8444-555555555555";
const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.webhooks = { constructEventAsync: async (b) => JSON.parse(b) }; this.customers = { list: async () => ({ data: [] }) }; this.subscriptions = { list: async () => ({ data: [] }) }; } }",
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__deliveryClient; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'x' }, error: null }) }; } }",
};
const env: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness", STRIPE_SECRET_KEY: "sk_test_harness", SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness",
};

let webhook: EdgeHandler;
let sweeper: EdgeHandler;
const pending: Promise<unknown>[] = [];
const db = new FakeDb({ used_stripe_sessions: ["session_id"], purchased_content: ["stripe_session_id"] });
const fetches: Array<{ url: string; body: unknown }> = [];
let releaseGenerator: () => void = () => undefined;
let generatorGate: Promise<void> = Promise.resolve();
let generatorStatus = 200;

const client = {
  from: (t: string) => db.from(t),
  rpc: (name: string, args: Record<string, unknown> = {}) => db.rpc(name, args),
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.__deliveryClient = client;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/functions/v1/send-product-email")) return new Response("{}", { status: 200 });
    if (url.includes("/functions/v1/generate-")) {
      await generatorGate;
      return new Response(JSON.stringify(generatorStatus === 200 ? { success: true, data: { coverLetter: "Dear team" } } : { error: "model down" }), { status: generatorStatus });
    }
    return new Response("{}", { status: 200 });
  };
  webhook = await loadEdgeHandler("stripe-webhook", STUBS);
  sweeper = await loadEdgeHandler("retry-failed-deliveries", STUBS);
}, 120_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  fetches.length = 0;
  pending.length = 0;
  generatorStatus = 200;
  generatorGate = Promise.resolve();
  db.rpcs = {
    // The lease a maker takes before it generates (20261011144000).
    ...fakeLeaseRpcs(db),
    log_webhook_event: () => ({ data: null, error: null }),
    get_temp_resume: () => ({ data: [{ resume_text: "A".repeat(400), job_description_text: "Senior engineer posting" }], error: null }),
    save_purchased_content: (a) => { db.rows("purchased_content").push({ stripe_session_id: a.p_stripe_session_id, generated_content: a.p_generated_content }); return { data: "pc", error: null }; },
    update_delivery_retry: (a) => {
      const row = db.rows("product_deliveries").find((r) => r.id === a.p_id);
      if (row) Object.assign(row, { status: a.p_status, last_retry_error: a.p_error });
      return { data: true, error: null };
    },
    get_purchased_content_by_session: () => ({ data: [], error: null }),
    check_rate_limit: () => ({ data: true, error: null }),
    agent_prepare_now: () => ({ data: false, error: null }),
  };
});

const settle = async () => { while (pending.length) await pending.shift(); };
const rowOf = (id: string) => db.rows("product_deliveries").find((r) => r.stripe_session_id === id);

describe("stripe-webhook answers Stripe before the product is generated", () => {
  it("a sale whose generator is still working is acknowledged at once, then delivered when it finishes", async () => {
    const id = "cs_live_slow_writer";
    db.rows("checkout_resume_refs").push({ stripe_session_id: id, resume_session_id: RESUME_ID });
    generatorGate = new Promise<void>((r) => { releaseGenerator = r; });
    const answered = webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
      body: JSON.stringify({ id: "evt_slow", type: "checkout.session.completed", data: { object: {
        id, mode: "payment", payment_status: "paid", amount_total: 400, currency: "usd",
        customer_details: { email: "buyer@example.com" }, metadata: { product_type: "cover_letter", product_name: "Cover Letter" },
      } } }),
    }));
    const raced = await Promise.race([answered.then((r) => r.status), new Promise((r) => setTimeout(() => r("still waiting"), 1500))]);
    expect(raced, "the webhook held Stripe's answer until the AI writer returned").toBe(200);
    expect(rowOf(id)?.status, "the row is not marked as generating before the answer").toBe("generating");
    expect(db.rows("used_stripe_sessions").map((r) => r.session_id), "the session was not claimed before the answer").toContain(id);

    releaseGenerator();
    await settle();
    expect(db.rows("purchased_content").find((r) => r.stripe_session_id === id), "the background finish saved nothing").toBeTruthy();
    expect(fetches.some((f) => f.url.includes("send-product-email"))).toBe(true);
    expect(rowOf(id)?.status).toBe("delivered");
  });
});

describe("the retry sweep finishes a generation nobody finished", () => {
  const sweep = async () => (await sweeper(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } }))).json();
  const stuck = () => {
    db.rows("product_deliveries").push({ id: "pd-stuck", stripe_session_id: "cs_live_stuck_gen", product_type: "cover_letter", status: "generating", customer_email: "b@example.com", retry_count: 0, max_retries: 3, metadata: { resume_session_id: RESUME_ID } });
    db.rpcs.get_failed_deliveries_for_retry = () => ({ data: db.rows("product_deliveries").filter((r) => r.status === "generating"), error: null });
  };

  it("a stuck 'generating' row is generated, saved and mailed", async () => {
    stuck();
    await sweep();
    expect(db.rows("purchased_content").find((r) => r.stripe_session_id === "cs_live_stuck_gen"), "the sweep left the stuck row as it found it").toBeTruthy();
    expect(db.rows("product_deliveries").find((r) => r.id === "pd-stuck")?.status).toBe("delivered");
  });

  it("a stuck row that fails again is recorded as a failed generation, not as still generating", async () => {
    stuck();
    generatorStatus = 503;
    await sweep();
    expect(db.rows("product_deliveries").find((r) => r.id === "pd-stuck")?.status).toBe("generation_failed");
  });
});

const MIG = resolve(__dirname, "../../supabase/migrations");
const SELECTOR_SQL = readFileSync(resolve(MIG, "20261009140000_a_paid_order_stuck_mid_generation_is_retried_after_fifteen_minutes.sql"), "utf8");
const DELIVERIES = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.product_deliveries (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL,
    customer_email text,
    product_type text NOT NULL,
    product_name text,
    content_generation_started_at timestamptz,
    status text NOT NULL DEFAULT 'payment_received',
    metadata jsonb,
    retry_count integer NOT NULL DEFAULT 0,
    max_retries integer NOT NULL DEFAULT 3,
    next_retry_at timestamptz
  );`;

describe("20261009140000: the selector picks a generation nobody finished, after fifteen minutes", () => {
  it("selects a generating row that began 16 minutes ago, not one that began 5 minutes ago, and keeps every older rule", async () => {
    const db = new PGlite();
    await db.exec(DELIVERIES);
    await db.exec(SELECTOR_SQL);
    await db.exec(SELECTOR_SQL); // safe to re-run
    await db.exec(`
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, content_generation_started_at) VALUES
        ('gen_old', 'cover_letter', 'generating', now() - interval '20 minutes', now() - interval '16 minutes'),
        ('gen_fresh', 'cover_letter', 'generating', now() - interval '20 minutes', now() - interval '5 minutes'),
        ('gen_unstamped_old', 'cover_letter', 'generating', now() - interval '30 minutes', NULL),
        ('pay_fresh', 'cover_letter', 'payment_received', now() - interval '2 minutes', NULL),
        ('pay_old', 'cover_letter', 'payment_received', now() - interval '11 minutes', NULL);
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, next_retry_at) VALUES
        ('analysis', 'full_analysis', 'payment_received', now() - interval '3 hours', 'infinity');
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, content_generation_started_at, retry_count) VALUES
        ('gen_spent', 'cover_letter', 'generating', now() - interval '3 hours', now() - interval '3 hours', 3);
    `);
    // The sweep that handles stuck generations asks for them (S11-146).
    const { rows } = await db.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(20, true)");
    expect(rows.map((r) => r.stripe_session_id).sort()).toEqual(["gen_old", "gen_unstamped_old", "pay_old"]);
    // A caller that does not ask (the live sweep) is handed none.
    const live = await db.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(20)");
    expect(live.rows.map((r) => r.stripe_session_id).sort()).toEqual(["pay_old"]);
    const acl = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
      `SELECT has_function_privilege('anon', 'public.get_failed_deliveries_for_retry(integer,boolean)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.get_failed_deliveries_for_retry(integer,boolean)', 'EXECUTE') AS auth,
              has_function_privilege('service_role', 'public.get_failed_deliveries_for_retry(integer,boolean)', 'EXECUTE') AS svc`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });
});
