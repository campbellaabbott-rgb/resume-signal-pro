/**
 * THE MONEY PATH, END TO END, WITH ONLY STRIPE, THE MODEL GATEWAY AND RESEND FAKED.
 *
 * WHY THIS EXISTS (critical-path plan 2026-10-12, CP-I). The platform has
 * never observed a paid delivery end to end, and every delivery test so far
 * answered the internal calls itself: the webhook's fetch to send-product-
 * email got a bare 200, so the mail that is the buyer's only way back was
 * never rendered, never refused, never resent. Here every shipped handler on
 * the path runs for real and calls the others for real:
 *
 *   - the edge functions are the shipped index.ts files (helpers/edge-harness):
 *     stripe-webhook, verify-product-purchase, retry-failed-deliveries,
 *     analyze-resume, send-product-email, send-analysis-email and
 *     recover-purchase;
 *   - a fetch ROUTER sends https://<harness>/functions/v1/<fn> to the loaded
 *     handler of that name, so the webhook's mail is send-product-email's own
 *     answer, and a function nobody loaded is a thrown error, never a quiet 200;
 *   - the database is Postgres (pglite) with the agent and payment stand-in
 *     tables, the LIVE definition of every SQL function the path calls (the
 *     last migration that defines it) and this round's migrations, each with
 *     its self-check;
 *   - exactly three things are fakes: the Stripe module (whose webhook check
 *     is Stripe's real HMAC scheme, so every event is signed), the AI gateway
 *     (it counts model calls) and Resend (the SDK and the REST API both record
 *     every message, and either can be told to refuse).
 *
 * Each scenario asserts per order: model calls, mails, and the final status.
 */
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "../../helpers/agent-db";
import { liveDefinitionOf } from "../../helpers/live-sql";
import { PgSupabase } from "../../helpers/pglite-supabase";
import { loadEdgeHandler, type EdgeHandler } from "../../helpers/edge-harness";
import { STRIPE_WEBHOOKS_REAL_SHAPE, signStripePayload } from "../../helpers/stripe-signature";

/**
 * What the model answers analyze-resume, in the shape its tool schema asks
 * for (keywords is a list of strings there; send-analysis-email renders it as
 * one), with a per-call marker.
 */
export function analysisAnswer(marker: string) {
  return {
    marker,
    industry: "technology",
    experienceLevel: "mid",
    atsScore: { score: 71, breakdown: { keywordMatch: 70, formatting: 72, structure: 71, relevance: 70 }, improvements: [] },
    optimizedBullets: [{ original: "did things", improved: "Shipped things", explanation: "verb" }],
    actionVerbs: ["Shipped"],
    keywords: ["TypeScript", "Kubernetes"],
    redFlags: [],
  };
}

export const SUPABASE_URL = "https://money-path.supabase.co";
export const SERVICE_KEY = "service_money_path_key_0123456789abcdef0123456789";
export const WEBHOOK_SECRET = "whsec_money_path_harness";
export const OWNER = "owner@example.com";

export const ENV: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_SECRET_KEY: "sk_live_money_path",
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: "anon_money_path",
  LOVABLE_API_KEY: "lovable_money_path",
  RESEND_API_KEY: "re_money_path",
  ADMIN_EMAIL: OWNER,
  OWNER_NOTIFY_EMAIL: OWNER,
};

/** The functions on the money path, every one loaded as it ships. */
export const MONEY_PATH_FUNCTIONS = [
  "stripe-webhook",
  "verify-product-purchase",
  "retry-failed-deliveries",
  "analyze-resume",
  "send-product-email",
  "send-analysis-email",
  "recover-purchase",
] as const;

/** A mail Resend accepted, from either door (the SDK or the REST API). */
export type Mail = { via: "sdk" | "rest"; from: string; to: string[]; subject: string; html: string; text?: string };

export type StripeWorld = {
  sessions: Record<string, Record<string, unknown>>;
  subs: Record<string, Record<string, unknown>>;
  customers: Record<string, Record<string, unknown>>;
  charges: Record<string, Record<string, unknown>>;
};

/** The tables the path writes, beyond the agent stand-ins: the columns as the migrations declare them. */
const PAYMENT_STAND_INS = `
  CREATE TABLE public.pro_subscribers (
    email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
    current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.pro_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, credits integer, resume_session_id text, job_title text,
    job_company text, language text, target_roles text, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.user_scan_credits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
    credits_remaining integer NOT NULL DEFAULT 0, total_credits_purchased integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.used_stripe_sessions (
    session_id text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now(), ip_address text, product_type text);
  CREATE TABLE public.product_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL, customer_email text, product_type text NOT NULL, product_name text, amount_cents integer,
    payment_completed_at timestamptz, content_generation_started_at timestamptz, content_generation_completed_at timestamptz,
    email_sent_at timestamptz, email_delivered_at timestamptz, status text NOT NULL DEFAULT 'payment_received',
    generation_success boolean, generation_error text, email_success boolean, email_error text,
    ai_response_valid boolean, ai_parse_error text, generation_duration_ms integer, ai_model_used text, metadata jsonb,
    retry_count integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 8, next_retry_at timestamptz,
    last_retry_error text, transient_failures integer NOT NULL DEFAULT 0,
    -- 20261011144000's lease, as the live database holds it: the live update_delivery_retry names these columns.
    lease_token uuid, lease_until timestamptz);
  CREATE TABLE public.scan_credit_session_grants (
    session_hash text PRIMARY KEY, email text NOT NULL, product_type text NOT NULL DEFAULT '',
    credits_bought integer NOT NULL, credits_used integer NOT NULL DEFAULT 0, claimed_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.purchased_content (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, product_name text, generated_content jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT (now() + interval '365 days'));
  CREATE TABLE public.resume_analyses (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    share_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    resume_text text NOT NULL, analysis_result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '90 days');
  CREATE TABLE public.webhook_events (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    event_type text NOT NULL, event_id text NOT NULL UNIQUE, payload jsonb, processed boolean DEFAULT false,
    processing_error text, processing_time_ms integer);
  CREATE TABLE public.email_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
    email_type text NOT NULL, recipient text NOT NULL, subject text, status text NOT NULL DEFAULT 'pending',
    error_message text, metadata jsonb DEFAULT '{}'::jsonb);
  CREATE TABLE public.temp_resume_storage (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_text text NOT NULL, linkedin_text text,
    job_description_text text, expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    created_at timestamptz DEFAULT now(), writer_net text, writer_wide text);
  CREATE TABLE public.checkout_resume_refs (
    stripe_session_id text PRIMARY KEY, resume_session_id uuid NOT NULL REFERENCES public.temp_resume_storage (session_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.payment_failures (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, payment_intent_id text NOT NULL, amount integer NOT NULL,
    currency text NOT NULL DEFAULT 'usd', failure_code text, failure_message text, customer_email text,
    metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.rate_limits (
    ip_address text NOT NULL, function_name text NOT NULL, request_count int DEFAULT 1, window_start timestamptz DEFAULT now(),
    PRIMARY KEY (ip_address, function_name));
  CREATE TABLE public.mail_door_counts (
    door text NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL DEFAULT now(), hits integer NOT NULL DEFAULT 1,
    PRIMARY KEY (door, bucket));
  CREATE TABLE public.subscription_notices (
    subscription_id text NOT NULL, kind text NOT NULL, email text NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz, provider_message_id text, pending_mail jsonb, PRIMARY KEY (subscription_id, kind));
  CREATE TABLE public.email_send_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id text, template_name text, recipient_email text, status text,
    error_message text, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now(), provider_message_id text);
  CREATE TABLE public.suppressed_emails (email text PRIMARY KEY, reason text, created_at timestamptz NOT NULL DEFAULT now());
  -- What the real agent_passes carries and payment_revoke reads.
  ALTER TABLE public.agent_passes ADD COLUMN activated_via text;
  ALTER TABLE public.agent_passes ADD CONSTRAINT agent_passes_stripe_session_id_key UNIQUE (stripe_session_id);
  ALTER TABLE public.agent_passes ADD CONSTRAINT agent_passes_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);
`;

/** Every SQL function the path calls, as the database holds it. */
const LIVE_FUNCTIONS = [
  "log_webhook_event", "save_purchased_content", "get_purchased_content_by_session", "get_temp_resume",
  "log_email_send", "mail_door_take", "get_analysis_by_share_id", "check_global_rate_limit",
  "delivery_error_is_transient", "update_delivery_retry", "log_delivery_step", "get_failed_deliveries_for_retry",
  "product_delivery_health",
];
const live = (fn: string) => `CREATE OR REPLACE ${liveDefinitionOf(fn).body}\n$$;`;

/** The migrations the path's SQL lives in, applied in order, self-checks included. */
const MIGRATIONS = [
  "20261008130000_a_plan_is_read_by_the_account_that_bought_it_by_one_rule.sql",
  "20261008131000_a_refunded_payment_takes_back_what_it_bought.sql",
  "20261008131500_a_signed_in_account_reads_its_pass_and_never_writes_it.sql",
  "20261008132000_a_closed_pass_gives_back_every_application_it_never_sent.sql",
];

/** This round's migrations that act on the path, when present (absent on a base without them). */
export const ROUND_MIGRATIONS = [
  "20261011140000_a_closed_paid_order_stays_closed.sql",
  "20261011143000_a_paid_order_made_but_never_mailed_is_mailed_from_its_copy.sql",
  "20261011143500_a_paid_order_whose_mail_never_left_counts_as_stuck.sql",
  "20261011144000_a_generation_in_progress_is_leased_and_a_stale_maker_is_refused.sql",
];

const TABLES_TO_CLEAR = [
  "used_stripe_sessions", "product_deliveries", "purchased_content", "resume_analyses", "webhook_events", "email_logs",
  "checkout_resume_refs", "temp_resume_storage", "payment_failures", "rate_limits", "mail_door_counts", "subscription_notices",
  "email_send_log", "suppressed_emails", "payment_revocations", "pro_subscribers", "pro_grants", "scan_credit_session_grants",
  "user_scan_credits", "test_door_hits",
];

const STRIPE_STUB = `
export default class Stripe {
  constructor(key) {
    const w = () => globalThis.__moneyPath.stripe;
    this.webhooks = ${STRIPE_WEBHOOKS_REAL_SHAPE};
    this.checkout = { sessions: {
      retrieve: async (id) => { const s = w().sessions[id]; if (!s) throw new Error("No such checkout.session: " + id); return JSON.parse(JSON.stringify(s)); },
      list: async (q) => ({ data: Object.values(w().sessions).filter((s) => !q || !q.payment_intent || s.payment_intent === q.payment_intent), has_more: false }),
    } };
    this.charges = { retrieve: async (id) => { const c = w().charges[id]; if (!c) throw new Error("No such charge"); return c; } };
    this.invoicePayments = { list: async () => ({ data: [] }) };
    this.invoices = { retrieve: async () => { throw new Error("No such invoice"); }, createPreview: async () => ({ amount_due: 0 }) };
    this.subscriptions = {
      retrieve: async (id) => { const s = w().subs[id]; if (!s) throw new Error("No such subscription"); return s; },
      list: async ({ customer }) => ({ data: Object.values(w().subs).filter((s) => s.customer === customer), has_more: false }),
      update: async (id, p) => Object.assign(w().subs[id], p),
      cancel: async (id) => Object.assign(w().subs[id], { status: "canceled" }),
    };
    this.customers = {
      retrieve: async (id) => w().customers[id] ?? { id, deleted: true },
      list: async ({ email }) => ({ data: Object.values(w().customers).filter((c) => c.email === email), has_more: false }),
    };
  }
}`;

const RESEND_SDK_STUB = `export class Resend { constructor() { this.emails = { send: async (m) => globalThis.__moneyPath.resend("sdk", m) }; } }`;

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.168.0/crypto/mod.ts": "export const crypto = globalThis.crypto;",
  "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
  "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__moneyPath.client; export class SupabaseClient {}",
  "https://esm.sh/resend@2.0.0": RESEND_SDK_STUB,
};

export type MoneyPath = {
  db: PGlite;
  client: PgSupabase;
  stripe: StripeWorld;
  /** Every mail Resend accepted, in order. */
  mails: Mail[];
  /** Mails Resend refused, in order. */
  refused: Mail[];
  /** Return true to make Resend refuse this mail. */
  refuse: { when: (m: Mail) => boolean };
  /** Model calls made through the gateway so far. */
  modelCalls: () => number;
  /** Which of our functions were called, in order (the router's log). */
  routed: string[];
  /** Post a Stripe event, signed as Stripe signs it, and wait for the background work (settle: false leaves it running, for a race). */
  event: (type: string, object: Record<string, unknown>, opts?: { settle?: boolean }) => Promise<{ status: number; json: unknown }>;
  /** Wait for every background task the handlers started (what event and call do on their own). */
  settle: () => Promise<void>;
  /**
   * A stand-in for a function OFF the path, answered by the test (a generator
   * of a product no longer sold, say): the router sends calls to it instead of
   * throwing. Cleared by reset.
   */
  standIn: (fn: string, handler: EdgeHandler) => void;
  /** Call a function as the browser does (no service key), and wait for its background work (settle: false leaves earlier background work running). */
  call: (fn: string, body: unknown, headers?: Record<string, string>, opts?: { settle?: boolean }) => Promise<{ status: number; json: Record<string, unknown> }>;
  /** One run of the retry sweep, as its cron posts it (settle: false leaves earlier background work running). */
  sweep: (opts?: { settle?: boolean }) => Promise<Record<string, unknown>>;
  /** The order's delivery row. */
  order: (sessionId: string) => Promise<Record<string, unknown> | undefined>;
  /** Time passes for an order: its next try is due now. */
  dueNow: (sessionId: string) => Promise<void>;
  /** The orders product_delivery_health counts as stuck (what the heartbeat reads). */
  stuck: () => Promise<number>;
  reset: () => Promise<void>;
};

/** Mails to one address, optionally of one kind (by subject). */
export const mailsTo = (p: MoneyPath, to: string, subject?: RegExp) =>
  p.mails.filter((m) => m.to.map((x) => x.toLowerCase()).includes(to.toLowerCase()) && (!subject || subject.test(m.subject)));

export async function moneyPath(opts: { roundMigrations?: boolean } = {}): Promise<MoneyPath> {
  const g = globalThis as Record<string, unknown>;
  const db = await agentDb({ seed: PAYMENT_STAND_INS });
  for (const m of MIGRATIONS) await db.exec(migration(m));
  await db.exec(LIVE_FUNCTIONS.map(live).join("\n"));
  if (opts.roundMigrations !== false) {
    for (const m of ROUND_MIGRATIONS) {
      let sql: string | null = null;
      try { sql = migration(m); } catch { sql = null; }
      if (sql) await db.exec(sql);
    }
  }
  const client = new PgSupabase(db);
  const stripe: StripeWorld = { sessions: {}, subs: {}, customers: {}, charges: {} };
  const mails: Mail[] = [];
  const refused: Mail[] = [];
  const refuse = { when: (_m: Mail) => false };
  const routed: string[] = [];
  const pending: Promise<unknown>[] = [];
  let models = 0;

  const resend = (via: "sdk" | "rest", raw: Record<string, unknown>) => {
    const m: Mail = {
      via, from: String(raw.from ?? ""), to: (Array.isArray(raw.to) ? raw.to : [raw.to]).map(String),
      subject: String(raw.subject ?? ""), html: String(raw.html ?? ""), ...(raw.text ? { text: String(raw.text) } : {}),
    };
    if (refuse.when(m)) { refused.push(m); return { data: null, error: { message: "resend refused (harness)" } }; }
    mails.push(m);
    return { data: { id: `re_${mails.length}` }, error: null };
  };

  g.__moneyPath = { stripe, client, resend };
  g.Deno = { env: { get: (k: string) => ENV[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };

  const handlers = new Map<string, EdgeHandler>();
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(`${SUPABASE_URL}/functions/v1/`)) {
      const fn = url.slice(`${SUPABASE_URL}/functions/v1/`.length).split(/[?#/]/)[0];
      routed.push(fn);
      const h = handlers.get(fn);
      if (!h) throw new Error(`money path: ${fn} was called and is not on the path (load it, or the call is a defect)`);
      return h(new Request(url, init));
    }
    if (url.startsWith("https://ai.gateway.lovable.dev/")) {
      models++;
      const body = { choices: [{ message: { tool_calls: [{ function: { name: "analysis", arguments: JSON.stringify(analysisAnswer(`model-call-${models}`)) } }] } }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://api.resend.com/emails") {
      const raw = JSON.parse(String(init?.body ?? "{}"));
      const r = resend("rest", raw);
      return r.error
        ? new Response(JSON.stringify({ message: r.error.message }), { status: 422 })
        : new Response(JSON.stringify({ id: r.data!.id }), { status: 200 });
    }
    throw new Error(`money path: unexpected network call to ${url}`);
  };

  for (const fn of MONEY_PATH_FUNCTIONS) handlers.set(fn, await loadEdgeHandler(fn, STUBS));
  const standIns = new Set<string>();

  const settle = async () => {
    for (let i = 0; i < 50 && pending.length; i++) {
      const batch = pending.splice(0);
      await Promise.all(batch);
    }
  };

  const json = async (res: Response) => { const t = await res.text(); try { return JSON.parse(t); } catch { return { raw: t }; } };

  const path: MoneyPath = {
    db, client, stripe, mails, refused, refuse, routed,
    modelCalls: () => models,
    settle,
    standIn: (fn, handler) => { standIns.add(fn); handlers.set(fn, handler); },
    event: async (type, object, opts = {}) => {
      const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, livemode: true, data: { object } });
      const res = await handlers.get("stripe-webhook")!(new Request(`${SUPABASE_URL}/functions/v1/stripe-webhook`, {
        method: "POST", headers: { "content-type": "application/json", "stripe-signature": signStripePayload(body, WEBHOOK_SECRET) }, body,
      }));
      if (opts.settle !== false) await settle();
      return { status: res.status, json: await json(res) };
    },
    call: async (fn, body, headers = {}, opts = {}) => {
      const res = await handlers.get(fn)!(new Request(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.77", apikey: ENV.SUPABASE_ANON_KEY, authorization: `Bearer ${ENV.SUPABASE_ANON_KEY}`, ...headers },
        body: JSON.stringify(body),
      }));
      if (opts.settle !== false) await settle();
      return { status: res.status, json: await json(res) };
    },
    sweep: async (opts = {}) => {
      const res = await handlers.get("retry-failed-deliveries")!(new Request(`${SUPABASE_URL}/functions/v1/retry-failed-deliveries`, {
        method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "10.0.0.1" }, body: "{}",
      }));
      if (opts.settle !== false) await settle();
      return json(res);
    },
    // next_retry_at read as text too: pglite hands 'infinity' back as an Invalid Date.
    order: async (sessionId) => (await db.query<Record<string, unknown>>(
      "SELECT *, next_retry_at::text AS next_retry_text FROM public.product_deliveries WHERE stripe_session_id = $1", [sessionId])).rows[0],
    dueNow: async (sessionId) => {
      await db.query("UPDATE public.product_deliveries SET next_retry_at = now() - interval '1 minute' WHERE stripe_session_id = $1 AND next_retry_at IS NOT NULL AND next_retry_at <> 'infinity'", [sessionId]);
    },
    stuck: async () => Number((await db.query<{ n: string | number | null }>(
      "SELECT COALESCE(sum(stuck), 0) AS n FROM public.product_delivery_health(24)")).rows[0]?.n ?? 0),
    reset: async () => {
      await settle();
      for (const fn of standIns) handlers.delete(fn);
      standIns.clear();
      await db.exec(`TRUNCATE ${TABLES_TO_CLEAR.map((t) => `public.${t}`).join(", ")} CASCADE`);
      for (const k of Object.keys(stripe) as Array<keyof StripeWorld>) stripe[k] = {};
      mails.length = 0;
      refused.length = 0;
      routed.length = 0;
      refuse.when = () => false;
      models = 0;
    },
  };
  return path;
}

/** A paid Checkout session as the checkouts mint it. */
export function paidSession(id: string, metadata: Record<string, string>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid", livemode: true,
    amount_total: 500, currency: "usd", customer: null, customer_email: null,
    customer_details: { email: "buyer@example.com" }, payment_intent: `pi_${id.slice(8)}`, metadata,
    total_details: { amount_discount: 0 }, ...over,
  };
}
