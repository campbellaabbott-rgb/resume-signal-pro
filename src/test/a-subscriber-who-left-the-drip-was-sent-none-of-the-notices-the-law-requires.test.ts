// @vitest-environment node
//
// Node, not jsdom: both handlers are bundled with esbuild (helpers/edge-harness).
/**
 * A SUBSCRIBER WHO LEFT THE DRIP WAS SENT NONE OF THE NOTICES THE LAW REQUIRES
 * (wave 3 review of payments-account).
 *
 * WHAT WAS WRONG. The subscription confirmation and the trial reminder (Cal.
 * B&P 17602) and the EU/UK withdrawal acknowledgement go into the
 * transactional queue, and process-email-queue drops every queued mail whose
 * address is in suppressed_emails, whatever the reason. Unsubscribing from the
 * fix-plan drip writes that row with reason 'unsubscribe'. So a visitor who
 * scanned, left the drip and later started the agent trial was charged on day
 * 7 with neither notice sent, while the webhook's ledger said each went once.
 *
 * WHAT HOLDS NOW, with the real webhook and the real queue handler run in
 * turn and only Stripe, the database and the mail providers faked: the
 * confirmation reaches an address that unsubscribed from the drip; a drip mail
 * to the same address is still suppressed; and a bounced or complained address
 * still gets nothing, legal notice or not.
 *
 * Since S11-053 (owner decision 2026-10-11) the webhook sends the notice
 * directly through Resend and never queues it, so the confirmation is read
 * from the Resend call, and the queue is drained for the drip alone.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

const SUBSCRIBER = "subscriber@example.com";
const SERVICE_JWT = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
const ENV: Record<string, string> = {
  STRIPE_WEBHOOK_SECRET: "whsec_harness",
  STRIPE_SECRET_KEY: "sk_test_harness",
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  SUPABASE_ANON_KEY: "anon_harness",
  LOVABLE_API_KEY: "lov",
  RESEND_API_KEY: "re_harness",
};
const NOW = Math.floor(Date.now() / 1000);
const world: { subs: Record<string, Record<string, unknown>> } = { subs: {} };

const STRIPE_STUB = `
export default class Stripe {
  constructor() {
    const w = () => globalThis.__legalWorld;
    this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) };
    this.subscriptions = {
      retrieve: async (id) => w().subs[id],
      list: async ({ customer }) => ({ data: Object.values(w().subs).filter((s) => s.customer === customer), has_more: false }),
    };
    this.customers = {
      retrieve: async (id) => ({ id, email: "${SUBSCRIBER}" }),
      list: async () => ({ data: [{ id: "cus_1", email: "${SUBSCRIBER}" }], has_more: false }),
    };
  }
}`;

let webhook: EdgeHandler;
let queueRun: EdgeHandler;
let db: FakeDb;
let queued: Array<Record<string, unknown>>;
const sent: Array<Record<string, unknown>> = [];
/** What the webhook handed Resend directly. */
const direct: Array<{ to: string[]; subject: string }> = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => ENV[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => undefined); } };
  g.__legalWorld = world;
  g.__legalDb = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  g.__legalSend = async (p: Record<string, unknown>) => { sent.push(p); return { ok: true }; };
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.resend.com/emails") {
      direct.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: `re_${direct.length}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  webhook = await loadEdgeHandler("stripe-webhook", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/stripe@18.5.0": STRIPE_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__legalDb; export class SupabaseClient {}",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
  });
  queueRun = await loadEdgeHandler("process-email-queue", {
    "npm:@lovable.dev/email-js": "export async function sendLovableEmail(p) { return globalThis.__legalSend(p); }",
    "npm:@supabase/supabase-js@2": "export const createClient = () => globalThis.__legalDb;",
  });
}, 180_000);

beforeEach(() => {
  world.subs = {};
  queued = [];
  sent.length = 0;
  direct.length = 0;
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rpcs.enqueue_email_delayed = (a) => { queued.push(a); return { data: queued.length, error: null }; };
  db.rpcs.record_affiliate_conversion = () => ({ data: true, error: null });
  db.rows("email_send_state").push({ id: 1, retry_after_until: null, batch_size: 10, send_delay_ms: 0, auth_email_ttl_minutes: 15, transactional_email_ttl_minutes: 60 });
  db.rpcs.delete_email = () => ({ data: true, error: null });
  db.rpcs.move_to_dlq = () => ({ data: 1, error: null });
});

/** The agent trial's checkout completing: the webhook sends the confirmation (or does not). */
async function startTrial(): Promise<void> {
  world.subs.sub_agent = {
    id: "sub_agent", customer: "cus_1", status: "trialing", trial_end: NOW + 7 * 86_400, cancel_at_period_end: false, cancel_at: null, metadata: {},
    items: { data: [{ price: { unit_amount: 9900, currency: "usd", recurring: { interval: "month" } } }] },
  };
  const res = await webhook(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: "evt_trial", type: "checkout.session.completed", data: { object: {
      id: "cs_test_trial", mode: "subscription", subscription: "sub_agent", customer: "cus_1",
      customer_details: { email: SUBSCRIBER }, payment_status: "no_payment_required", amount_total: 0,
      metadata: { product_type: "apply_agent" },
    } } }),
  }));
  expect(res.status).toBe(200);
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), "stripe-webhook", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  expect(queued, "a legal notice went into the queue").toEqual([]);
}

/** Run the queue once over the given transactional messages; answers what the provider was handed. */
async function drain(messages: Array<Record<string, unknown>>) {
  db.rpcs.read_email_batch = (a) => ({
    data: a.queue_name === "transactional_emails" ? messages.map((message, i) => ({ msg_id: i + 1, read_ct: 1, message })) : [],
    error: null,
  });
  const res = await queueRun(new Request("https://harness.supabase.co/functions/v1/process-email-queue", { method: "POST", headers: { authorization: `Bearer ${SERVICE_JWT}` } }));
  expect(res.status).toBe(200);
  expect(buildIsAtLeast(res.headers.get("x-fn-build"), "process-email-queue", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  return sent.map((p) => p.label);
}

const drip = { message_id: "m-drip", to: SUBSCRIBER, from: "x", sender_domain: "x", subject: "Day 4", html: "h", label: "fix-plan-day-4", queued_at: new Date().toISOString() };

describe("a subscriber who unsubscribed from the drip", () => {
  it("still receives the trial confirmation, while the drip stays suppressed", async () => {
    db.rows("suppressed_emails").push({ email: SUBSCRIBER, reason: "unsubscribe" });
    await startTrial();
    expect(direct.map((m) => m.to), "the confirmation did not reach an address that only left the drip").toEqual([[SUBSCRIBER]]);
    expect(await drain([drip])).toEqual([]);
    const log = db.rows("email_send_log").map((r) => [r.template_name, r.status]);
    expect(log).toContainEqual(["subscription-confirmation", "sent"]);
    expect(log).toContainEqual(["fix-plan-day-4", "suppressed"]);
  });

  it("a bounced or complained address gets nothing, legal notice or not", async () => {
    for (const reason of ["bounce", "complaint"]) {
      db.tables.suppressed_emails = [{ email: SUBSCRIBER, reason }];
      db.tables.subscription_notices = [];
      direct.length = 0;
      await startTrial();
      expect(direct, reason).toEqual([]);
    }
  });

  it("an ordinary mail cannot pass an unsubscribe by calling itself a legal notice under another label", async () => {
    db.rows("suppressed_emails").push({ email: SUBSCRIBER, reason: "unsubscribe" });
    expect(await drain([{ ...drip, legal_notice: true }])).toEqual([]);
  });
});
