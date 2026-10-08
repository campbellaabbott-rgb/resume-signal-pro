// @vitest-environment node
//
// Node, not jsdom: the webhook is bundled with esbuild and its SQL runs in
// pglite.
/**
 * A REFUND OR A DISPUTE LEFT EVERY ENTITLEMENT IN PLACE.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04, L6-18). charge.refunded and
 * charge.dispute.created fell into "Unhandled event"; wave 1 made them mail
 * the owner and change nothing. A refunded $29 pass kept its clock and its
 * applications, a refunded scan pack's credits stayed spendable, a refunded
 * product could be regenerated from its session id, and a refunded plan kept
 * every grant it had minted. Nothing ever wrote agent_passes close_reason
 * 'refunded'.
 *
 * OWNER DECISION 2026-10-04: refunds and disputes revoke. Held here end to
 * end -- the shipped stripe-webhook handler, with Stripe faked, calling the
 * real payment_revoke (20261008131000) in pglite -- and at every function
 * that reads Stripe itself, where Stripe still answers 'paid' after a refund:
 * the two deliverers, the three generators that verify a cs_ session with
 * Stripe rather than the claim (review of this branch: each regenerated a
 * refunded purchase), and the pass page's repair, which granted a pass from
 * a refunded second-pass payment once the first pass closed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { agentDb } from "./helpers/agent-db";
import { PgSupabase } from "./helpers/pglite-supabase";
import { analyzeResumeHarness, fullAnalysisSession, RESUME } from "./helpers/analyze-resume-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const MIG = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const BUYER = "00000000-0000-4000-8000-00000000e101";
const SUBSCRIBER = "00000000-0000-4000-8000-00000000e102";
const SECOND_PASS_BUYER = "00000000-0000-4000-8000-00000000e103";

const STAND_INS = `
  CREATE TABLE public.pro_subscribers (
    email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.pro_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, credits integer, resume_session_id text, job_title text,
    job_company text, language text, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.user_scan_credits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
    credits_remaining integer NOT NULL DEFAULT 0, total_credits_purchased integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.used_stripe_sessions (
    session_id text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now(), ip_address text, product_type text);
  CREATE TABLE public.product_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, product_type text,
    status text NOT NULL DEFAULT 'payment_received', next_retry_at timestamptz, metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.scan_credit_session_grants (
    session_hash text PRIMARY KEY, email text NOT NULL, product_type text NOT NULL DEFAULT '',
    credits_bought integer NOT NULL, credits_used integer NOT NULL DEFAULT 0, claimed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO auth.users (id, email) VALUES ('${BUYER}', 'buyer@example.com'), ('${SUBSCRIBER}', 'sub@example.com'),
    ('${SECOND_PASS_BUYER}', 'second@example.com');
  -- What the real agent_passes carries and agent_pass_grant / agent-pass-status read.
  ALTER TABLE public.agent_passes ADD COLUMN activated_via text;
  ALTER TABLE public.agent_passes ADD CONSTRAINT agent_passes_stripe_session_id_key UNIQUE (stripe_session_id);
  ALTER TABLE public.agent_passes ADD CONSTRAINT agent_passes_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);
`;

type World = {
  sessions: Record<string, Record<string, unknown>>;
  charges: Record<string, Record<string, unknown>>;
  invoices: Record<string, Record<string, unknown>>;
  subs: Record<string, Record<string, unknown>>;
  cancelled: string[];
};

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__refundStripe;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.checkout = { sessions: { list: async ({ payment_intent }) => ({ data: Object.values(w().sessions).filter((s) => s.payment_intent === payment_intent) }) } };
    this.charges = { retrieve: async (id) => { const c = w().charges[id]; if (!c) throw new Error("No such charge"); return c; } };
    this.invoicePayments = { list: async () => ({ data: [] }) };
    this.invoices = { retrieve: async (id) => w().invoices[id] };
    this.subscriptions = {
      retrieve: async (id) => w().subs[id],
      cancel: async (id) => { w().cancelled.push(id); w().subs[id].status = "canceled"; return w().subs[id]; },
    };
    this.customers = { list: async () => ({ data: [], has_more: false }), retrieve: async () => ({ deleted: true }) };
  }
}`;

const ENV: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lovable_harness",
};
/** Deno as these handlers see it; another harness in this file may replace it, so each test restores it. */
const harnessDeno = () => ({
  env: { get: (k: string) => ENV[k] },
  serve: (h: unknown) => { (globalThis as Record<string, unknown>).__edgeHandler = h; },
});

let db: PGlite;
let client: PgSupabase;
let webhook: EdgeHandler;
let passStatus: EdgeHandler;
let world: World;
let aiCalls = 0;

beforeAll(async () => {
  db = await agentDb({ seed: STAND_INS });
  await db.exec(MIG("20261008130000_a_plan_is_read_by_the_account_that_bought_it_by_one_rule.sql"));
  await db.exec(MIG("20261008131000_a_refunded_payment_takes_back_what_it_bought.sql"));
  // The close a refund makes is a close like any other: the settlement runs too.
  await db.exec(MIG("20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql"));
  // The grant the pass page's repair calls, as its only file defines it.
  await db.exec(MIG("20260917110000_agent_pass_grant.sql"));
  client = new PgSupabase(db);
  const g = globalThis as Record<string, unknown>;
  g.Deno = harnessDeno();
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { void Promise.resolve(p).catch(() => undefined); } };
  // Every model call the generators make goes through the gateway: counted, and stopped.
  g.fetch = async (url: unknown) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  g.__refundClient = client;
  webhook = await loadEdgeHandler("stripe-webhook", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__refundClient; export class SupabaseClient {}",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
  });
  // The pass page's function: a client made with the caller's header answers
  // getUser for it; the service client is the pglite database.
  passStatus = await loadEdgeHandler("agent-pass-status", {
    "https://esm.sh/stripe@18.5.0":
      "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => { const s = globalThis.__refundStripe.sessions[id]; if (!s) throw new Error('No such checkout.session'); return s; } } }; } }",
    "https://esm.sh/@supabase/supabase-js@2.45.0": `export function createClient(_u, _k, opts) {
      const c = globalThis.__refundClient;
      const h = opts?.global?.headers?.Authorization;
      if (h === undefined) return c;
      return { auth: { getUser: () => c.auth.getUser(String(h).replace(/^Bearer\\s+/i, "")) } };
    }`,
  });
}, 240_000);

afterAll(async () => { await db?.close(); });

beforeEach(() => {
  world = { sessions: {}, charges: {}, invoices: {}, subs: {}, cancelled: [] };
  (globalThis as Record<string, unknown>).__refundStripe = world;
  client.rpcFaults.clear();
  aiCalls = 0;
  (globalThis as Record<string, unknown>).Deno = harnessDeno();
});

let seq = 0;
const deliver = async (type: string, object: Record<string, unknown>) => {
  const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=harness", "content-type": "application/json" },
    body: JSON.stringify({ id: `evt_${++seq}`, type, data: { object } }),
  }));
  return res.status;
};
const one = async <T = Record<string, unknown>>(sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];

describe("a refund in full takes back a scan pack's unspent credits, once", () => {
  it("claws back what is left of the pack, closes the session to every generator, and does it once", async () => {
    await db.exec(`
      INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased) VALUES ('pack@example.com', 6, 10);
      INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ('cs_pack_1', 'scan_pack');
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, metadata)
        VALUES ('cs_pack_1', 'scan_pack', 'delivered', '{"credits": 10}');`);
    world.sessions.cs_pack_1 = { id: "cs_pack_1", payment_intent: "pi_pack_1", metadata: { product_type: "scan_pack", credits: "10" }, customer_details: { email: "pack@example.com" } };
    const refund = { id: "ch_pack_1", payment_intent: "pi_pack_1", amount: 200, amount_refunded: 200, refunded: true, currency: "usd", created: 1_760_000_000 };

    expect(await deliver("charge.refunded", refund)).toBe(200);
    expect(await one(`SELECT credits_remaining, total_credits_purchased FROM public.user_scan_credits WHERE email = 'pack@example.com'`))
      .toEqual({ credits_remaining: 0, total_credits_purchased: 0 });
    expect((await one<{ product_type: string }>(`SELECT product_type FROM public.used_stripe_sessions WHERE session_id = 'cs_pack_1'`)).product_type).toBe("refunded");
    expect((await one<{ status: string }>(`SELECT status FROM public.product_deliveries WHERE stripe_session_id = 'cs_pack_1'`)).status).toBe("refunded");

    // Stripe redelivers, or the buyer disputes the same payment: nothing twice.
    await db.exec(`UPDATE public.user_scan_credits SET credits_remaining = 2 WHERE email = 'pack@example.com'`);
    expect(await deliver("charge.refunded", refund)).toBe(200);
    expect(await deliver("charge.dispute.created", { id: "dp_pack_1", payment_intent: "pi_pack_1", charge: "ch_pack_1", amount: 200, reason: "fraudulent" })).toBe(200);
    expect((await one<{ credits_remaining: number }>(`SELECT credits_remaining FROM public.user_scan_credits WHERE email = 'pack@example.com'`)).credits_remaining).toBe(2);
  });

  it("a partial refund changes nothing", async () => {
    await db.exec(`INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased) VALUES ('partial@example.com', 9, 10)`);
    world.sessions.cs_partial = { id: "cs_partial", payment_intent: "pi_partial", metadata: { product_type: "scan_pack" }, customer_details: { email: "partial@example.com" } };
    expect(await deliver("charge.refunded", { id: "ch_partial", payment_intent: "pi_partial", amount: 200, amount_refunded: 50, refunded: false, currency: "usd" })).toBe(200);
    expect((await one<{ credits_remaining: number }>(`SELECT credits_remaining FROM public.user_scan_credits WHERE email = 'partial@example.com'`)).credits_remaining).toBe(9);
    expect(await one(`SELECT count(*)::int AS n FROM public.payment_revocations WHERE payment_intent_id = 'pi_partial'`)).toEqual({ n: 0 });
  });

  it("a revocation that cannot be written answers 500, so Stripe redelivers it", async () => {
    world.sessions.cs_fail = { id: "cs_fail", payment_intent: "pi_fail", metadata: { product_type: "cover_letter" }, customer_details: { email: "x@example.com" } };
    client.rpcFaults.set("payment_revoke", { message: "connection reset" });
    expect(await deliver("charge.refunded", { id: "ch_fail", payment_intent: "pi_fail", amount: 400, amount_refunded: 400, refunded: true })).toBe(500);
  });
});

describe("a refunded Agent Pass closes, and nothing more goes out on it", () => {
  it("stops every unsent application, keeps the sent one, writes close_reason 'refunded'", async () => {
    const pass = (await one<{ id: string }>(`
      INSERT INTO public.agent_passes (user_id, stripe_session_id, stripe_payment_intent_id, applications_used, activated_at, expires_at)
      VALUES ('${BUYER}', 'cs_pass_1', 'pi_pass_1', 3, now(), now() + interval '5 hours') RETURNING id`)).id;
    await db.exec(`
      INSERT INTO public.agent_queue (user_id, posting_id, status, pass_id) VALUES
        ('${BUYER}', 'p-queued', 'approved', '${pass}'),
        ('${BUYER}', 'p-ready', 'approved', '${pass}'),
        ('${BUYER}', 'p-sent', 'approved', '${pass}');
      INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id) VALUES ('${BUYER}', 'p-ready', 'ready', '${pass}');
      INSERT INTO public.agent_submissions (user_id, posting_id, status, pass_id, submitted_at, submitted_via)
        VALUES ('${BUYER}', 'p-sent', 'submitted', '${pass}', now(), 'worker');`);
    world.sessions.cs_pass_1 = { id: "cs_pass_1", payment_intent: "pi_pass_1", client_reference_id: BUYER, metadata: { product_type: "agent_pass" }, customer_details: { email: "buyer@example.com" } };

    expect(await deliver("charge.refunded", { id: "ch_pass_1", payment_intent: "pi_pass_1", amount: 2900, amount_refunded: 2900, refunded: true })).toBe(200);

    const p = await one<{ closed: boolean; close_reason: string }>(`SELECT closed_at IS NOT NULL AS closed, close_reason FROM public.agent_passes WHERE id = '${pass}'`);
    expect(p).toEqual({ closed: true, close_reason: "refunded" });
    const subs = (await db.query<{ posting_id: string; status: string }>(`SELECT posting_id, status FROM public.agent_submissions WHERE pass_id = '${pass}' ORDER BY posting_id`)).rows;
    expect(subs).toEqual([{ posting_id: "p-ready", status: "failed" }, { posting_id: "p-sent", status: "submitted" }]);
    const queue = (await db.query<{ posting_id: string; status: string }>(`SELECT posting_id, status FROM public.agent_queue WHERE pass_id = '${pass}' ORDER BY posting_id`)).rows;
    expect(queue).toEqual([
      { posting_id: "p-queued", status: "dismissed" },
      { posting_id: "p-ready", status: "dismissed" },
      { posting_id: "p-sent", status: "approved" },
    ]);
  });

  it("refunding a second pass that was never granted leaves the account's open pass alone", async () => {
    const open = (await one<{ id: string }>(`
      INSERT INTO public.agent_passes (user_id, stripe_session_id, stripe_payment_intent_id, activated_at, expires_at)
      VALUES ('${SUBSCRIBER}', 'cs_first_pass', 'pi_first_pass', now(), now() + interval '5 hours') RETURNING id`)).id;
    world.sessions.cs_second = { id: "cs_second", payment_intent: "pi_second", client_reference_id: SUBSCRIBER, metadata: { product_type: "agent_pass" } };
    expect(await deliver("charge.refunded", { id: "ch_second", payment_intent: "pi_second", amount: 2900, amount_refunded: 2900, refunded: true })).toBe(200);
    expect((await one<{ closed: boolean }>(`SELECT closed_at IS NOT NULL AS closed FROM public.agent_passes WHERE id = '${open}'`)).closed).toBe(false);
  });

  it("the refunded second pass is never granted by the pass page once the first pass has closed", async () => {
    const first = (await one<{ id: string }>(`
      INSERT INTO public.agent_passes (user_id, stripe_session_id, stripe_payment_intent_id, activated_at, expires_at)
      VALUES ('${SECOND_PASS_BUYER}', 'cs_first_e103', 'pi_first_e103', now(), now() + interval '5 hours') RETURNING id`)).id;
    world.sessions.cs_second_e103 = {
      id: "cs_second_e103", payment_intent: "pi_second_e103", payment_status: "paid", mode: "payment", amount_total: 2900,
      client_reference_id: SECOND_PASS_BUYER, metadata: { product_type: "agent_pass" },
    };
    // The owner refunds the payment that opened no pass; the receipt is all it writes.
    expect(await deliver("charge.refunded", { id: "ch_second_e103", payment_intent: "pi_second_e103", amount: 2900, amount_refunded: 2900, refunded: true })).toBe(200);
    // The first pass closes; the buyer reopens the second checkout's success URL.
    await db.exec(`UPDATE public.agent_passes SET closed_at = now(), close_reason = 'session_ended' WHERE id = '${first}'`);
    client.tokens["jwt-e103"] = { id: SECOND_PASS_BUYER, email: "second@example.com" };
    const res = await passStatus(new Request("https://harness.supabase.co/functions/v1/agent-pass-status?session_id=cs_second_e103", {
      headers: { authorization: "Bearer jwt-e103" },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repair?: string; repairTerminal?: boolean; pass: { state: string } };
    expect(await one(`SELECT count(*)::int AS n FROM public.agent_passes WHERE stripe_session_id = 'cs_second_e103'`)).toEqual({ n: 0 });
    expect(body.repair).toBe("payment_revoked");
    expect(body.repairTerminal).toBe(true);
    expect(body.pass.state).toBe("closed");
    expect(client.rpcCalls("agent_pass_grant")).toEqual([]);
  });

  it("the pass page still grants a paid pass the webhook has not reached yet", async () => {
    world.sessions.cs_late_e103 = {
      id: "cs_late_e103", payment_intent: "pi_late_e103", payment_status: "paid", mode: "payment", amount_total: 2900,
      client_reference_id: SECOND_PASS_BUYER, metadata: { product_type: "agent_pass" },
    };
    client.tokens["jwt-e103"] = { id: SECOND_PASS_BUYER, email: "second@example.com" };
    await db.exec(`UPDATE public.agent_passes SET closed_at = now() WHERE user_id = '${SECOND_PASS_BUYER}' AND closed_at IS NULL`);
    const res = await passStatus(new Request("https://harness.supabase.co/functions/v1/agent-pass-status?session_id=cs_late_e103", {
      headers: { authorization: "Bearer jwt-e103" },
    }));
    const body = (await res.json()) as { repair?: string; pass: { state: string } };
    expect(body.repair).toBeUndefined();
    expect(await one(`SELECT count(*)::int AS n FROM public.agent_passes WHERE stripe_session_id = 'cs_late_e103'`)).toEqual({ n: 1 });
  });
});

describe("a disputed subscription payment cancels the plan and takes back what it minted", () => {
  it("revokes the grants minted since the payment, claws back a scan grant's credits, cancels at once", async () => {
    const paidAt = 1_760_100_000;
    await db.exec(`
      INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased) VALUES ('sub@example.com', 10, 10);
      INSERT INTO public.pro_grants (email, user_id, product_id, product_type, credits, consumed_at, created_at) VALUES
        ('sub@example.com', '${SUBSCRIBER}', 'scanPack', 'scan_pack', 10, now(), to_timestamp(${paidAt + 60})),
        ('sub@example.com', '${SUBSCRIBER}', 'coverLetter', 'cover_letter', NULL, NULL, to_timestamp(${paidAt + 120})),
        ('sub@example.com', '${SUBSCRIBER}', 'coverLetter', 'cover_letter', NULL, now(), to_timestamp(${paidAt - 86400 * 40}));`);
    const spent = (await one<{ id: string }>(`SELECT id FROM public.pro_grants WHERE product_type = 'scan_pack'`)).id;
    await db.exec(`INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ('pro_${spent}', 'scan_pack')`);
    world.charges.ch_sub = { id: "ch_sub", payment_intent: "pi_sub", created: paidAt, invoice: "in_sub", billing_details: { email: "sub@example.com" } };
    world.invoices.in_sub = { id: "in_sub", customer: "cus_sub", customer_email: "sub@example.com", parent: { subscription_details: { subscription: "sub_1" } } };
    world.subs.sub_1 = { id: "sub_1", status: "active", metadata: { user_id: SUBSCRIBER }, items: { data: [{ price: { unit_amount: 4500 } }] } };

    expect(await deliver("charge.dispute.created", { id: "dp_sub", payment_intent: "pi_sub", charge: "ch_sub", amount: 4500, reason: "fraudulent" })).toBe(200);

    expect(world.cancelled).toEqual(["sub_1"]);
    const grants = (await db.query<{ product_type: string; revoked: boolean }>(
      `SELECT product_type, revoked_at IS NOT NULL AS revoked FROM public.pro_grants ORDER BY created_at`)).rows;
    expect(grants).toEqual([
      { product_type: "cover_letter", revoked: false },
      { product_type: "scan_pack", revoked: true },
      { product_type: "cover_letter", revoked: true },
    ]);
    expect((await one<{ product_type: string }>(`SELECT product_type FROM public.used_stripe_sessions WHERE session_id = 'pro_${spent}'`)).product_type).toBe("refunded");
    expect((await one<{ credits_remaining: number }>(`SELECT credits_remaining FROM public.user_scan_credits WHERE email = 'sub@example.com'`)).credits_remaining).toBe(0);
    expect(await one(`SELECT reason, subscription_id, grants_revoked FROM public.payment_revocations WHERE payment_intent_id = 'pi_sub'`))
      .toEqual({ reason: "disputed", subscription_id: "sub_1", grants_revoked: 2 });
  });
});

describe("the deliverers that read Stripe themselves refuse a refunded session", () => {
  it("analyze-resume refuses a refunded full analysis before any AI spend", async () => {
    const h = await analyzeResumeHarness();
    h.sessions.set("cs_refunded_analysis", fullAnalysisSession("cs_refunded_analysis"));
    h.db.rows("payment_revocations").push({ payment_intent_id: "pi_x", reason: "refunded", stripe_session_id: "cs_refunded_analysis" });
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_refunded_analysis" });
    expect(r.status).toBe(402);
    expect(h.aiCalls()).toBe(0);
  });

  it("verify-product-purchase refuses a refunded session Stripe still calls paid, and claims and credits nothing", async () => {
    const fake = new FakeDb({ used_stripe_sessions: ["session_id"] });
    fake.rpcs.check_rate_limit = () => ({ data: true, error: null });
    fake.rpcs.add_scan_credits = () => { throw new Error("credited a refunded purchase"); };
    fake.rows("payment_revocations").push({ payment_intent_id: "pi_v", reason: "refunded", stripe_session_id: "cs_refunded_pack" });
    const g = globalThis as Record<string, unknown>;
    g.__verifyDb = fake;
    g.__verifySession = { id: "cs_refunded_pack", payment_status: "paid", mode: "payment", amount_total: 200, metadata: { product_type: "scan_pack", credits: "10" }, customer_details: { email: "pack@example.com" } };
    const verify = await loadEdgeHandler("verify-product-purchase", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/stripe@18.5.0": "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async () => globalThis.__verifySession } }; } }",
      "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__verifyDb;",
    });
    const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.71" },
      body: JSON.stringify({ sessionId: "cs_refunded_pack" }),
    }));
    expect(res.status).toBe(402);
    expect(((await res.json()) as { refunded?: boolean }).refunded).toBe(true);
    expect(fake.rows("used_stripe_sessions")).toEqual([]);
  });

  it("no client role can read the receipts or run the revocation", async () => {
    const acl = await one<{ t: boolean; f: boolean }>(`
      SELECT has_table_privilege('anon', 'public.payment_revocations', 'SELECT') OR has_table_privilege('authenticated', 'public.payment_revocations', 'SELECT') AS t,
             has_function_privilege('anon', 'public.payment_revoke(text,text,text,text,text,text,uuid,integer,text,timestamptz)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.payment_revoke(text,text,text,text,text,text,uuid,integer,text,timestamptz)', 'EXECUTE') AS f`);
    expect(acl).toEqual({ t: false, f: false });
  });
});

describe("the generators that verify a cs_ session with Stripe refuse a refunded one", () => {
  const SERVER = "export function serve(h) { globalThis.__edgeHandler = h; }";
  const CLIENT = "export function createClient() { const db = globalThis.__genDb; return { from: (t) => db.from(t), rpc: (n, a) => db.rpc(n, a), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
  const STUBS: Record<string, string> = {
    "https://deno.land/std@0.190.0/http/server.ts": SERVER,
    "https://deno.land/std@0.168.0/http/server.ts": SERVER,
    "https://esm.sh/stripe@18.5.0":
      "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => { const s = globalThis.__genSessions[id]; if (!s) throw new Error('No such checkout.session'); return s; } } }; } }",
    "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
    "https://esm.sh/@supabase/supabase-js@2": CLIENT,
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__genDb;",
  };
  const RESUME_TEXT = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);

  /** Stripe calls the session paid; the webhook wrote the receipt and rewrote the claim. */
  function refundedWorld(sessionId: string, productType: string): FakeDb {
    const fake = new FakeDb({ used_stripe_sessions: ["session_id"] });
    fake.rpcs.check_rate_limit = () => ({ data: true, error: null });
    fake.rows("used_stripe_sessions").push({ session_id: sessionId, product_type: "refunded" });
    fake.rows("payment_revocations").push({ payment_intent_id: `pi_${sessionId}`, reason: "refunded", stripe_session_id: sessionId });
    const g = globalThis as Record<string, unknown>;
    g.__genDb = fake;
    g.__genSessions = {
      [sessionId]: { id: sessionId, payment_status: "paid", mode: "payment", amount_total: 2900, metadata: { product_type: productType }, customer_details: { email: "buyer@example.com" } },
    };
    return fake;
  }
  const post = (handler: EdgeHandler, fn: string, body: Record<string, unknown>) =>
    handler(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.72" },
      body: JSON.stringify(body),
    }));

  it("generate-freelance-boost answers 402 before any model call", async () => {
    refundedWorld("cs_refunded_boost", "freelance_boost");
    const h = await loadEdgeHandler("generate-freelance-boost", STUBS);
    const res = await post(h, "generate-freelance-boost", {
      sessionId: "cs_refunded_boost", targetRole: "Product designer",
      projects: [{ clientType: "Startup", problem: "No design system", deliverable: "A component library", toolsSkills: "Figma", outcome: "Shipped", duration: "3 months" }],
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { refunded?: boolean }).refunded).toBe(true);
    expect(aiCalls).toBe(0);
  });

  it("generate-ats-defense answers 402 and does not read the rewritten claim as proof", async () => {
    refundedWorld("cs_refunded_ats_defense", "ats_defense");
    const h = await loadEdgeHandler("generate-ats-defense", STUBS);
    const res = await post(h, "generate-ats-defense", { sessionId: "cs_refunded_ats_defense", resumeText: RESUME_TEXT, jobDescription: "Senior engineer, payments." });
    expect(res.status).toBe(402);
    expect(aiCalls).toBe(0);
  });

  it("generate-apply-package answers 402 to a refunded kit with no plan behind it", async () => {
    refundedWorld("cs_refunded_kit", "apply_assistant");
    const h = await loadEdgeHandler("generate-apply-package", STUBS);
    const res = await post(h, "generate-apply-package", {
      sessionId: "cs_refunded_kit", resumeText: RESUME_TEXT,
      jobPostingText: "We are hiring a senior engineer to own our checkout and fulfilment services end to end.",
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { refunded?: boolean }).refunded).toBe(true);
    expect(aiCalls).toBe(0);
  });
});
