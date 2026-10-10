// @vitest-environment node
/**
 * A PAID ORDER THAT NEVER ARRIVED REACHED NO INBOX (commercial-readiness
 * 2026-10-08, item 2).
 *
 * WHAT WAS WRONG. scan-heartbeat decided its alert from the platform checks,
 * and only afterwards read product_delivery_health. Its 'undelivered' verdict
 * (a generation that failed, a payment or a generation stranded for two
 * hours) went into the JSON the cron discards, and to nobody else. A buyer
 * could pay, receive nothing, and the owner would hear about it from a
 * chargeback.
 *
 * WHAT HOLDS NOW, running the shipped handler with its network faked: the
 * delivery verdict is read before any alert is decided; an undelivered order
 * mails the owner naming its session, once per order per day; a refused mail
 * leaves the order unannounced so the next run tries again; and the public
 * part of the response carries no buyer address.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, eqs, type Answer, type Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};
type Call = { url: string; body: Record<string, unknown> | null };
const fetched: Call[] = [];
let pending: Promise<unknown>[] = [];
let handler: EdgeHandler;
let resendStatus = 200;
let db: ProxyDb;
let state: Record<string, unknown> | null = null;
let rows: Array<Record<string, unknown>> = [];
let health: Array<Record<string, unknown>> = [];

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    fetched.push({ url: u, body });
    if (u.includes("api.resend.com")) return okJson({ id: "em" }, resendStatus);
    if (u.includes("api.stripe.com")) return okJson({ object: "balance" });
    if (u.includes("ai.gateway.lovable.dev")) return okJson({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
    if (u.includes("/functions/v1/free-keyword-scan")) return okJson({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" } });
    if (u.includes("/functions/v1/job-board")) return okJson(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
    return okJson({});
  };
  handler = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbDb; }",
  });
});

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  resendStatus = 200;
  state = null;
  rows = [
    { id: "pd-stuck", stripe_session_id: "cs_live_a1b2c3stuckorder", product_type: "cover_letter", status: "generating", created_at: ago(180), retry_count: 0, max_retries: 3, customer_email: "buyer@example.com", generation_error: null, last_retry_error: null },
    { id: "pd-fresh", stripe_session_id: "cs_live_freshpayment0001", product_type: "ats_defense", status: "payment_received", created_at: ago(5), retry_count: 0, max_retries: 3, customer_email: "other@example.com", generation_error: null, last_retry_error: null },
  ];
  health = [{ status: "generating", n: 0, exhausted: 0, stuck: 1, last_at: null }, { status: "payment_received", n: 1, exhausted: 0, stuck: 0, last_at: ago(5) }];
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.rpc === "product_delivery_health") return { data: health, error: null };
    if (q.rpc === "email_delivery_health") return { data: [], error: null };
    if (q.rpc === "get_email_health") return { data: [], error: null };
    if (q.table === "product_deliveries") return { data: rows, error: null };
    if (q.table === "job_board_meta" && eqs(q, "k", "undelivered_alert_state")) return { data: state ? { v: state } : null, error: null };
    if (q.table === "job_board_meta" && q.calls.some(([m]) => m === "upsert")) {
      const row = q.calls.find(([m]) => m === "upsert")![1][0] as { k: string; v: Record<string, unknown> };
      if (row.k === "undelivered_alert_state") state = row.v;
      return { data: null, error: null };
    }
    if (q.table === "job_board_meta" && eqs(q, "k", "refresh_progress")) return { data: { updated_at: new Date().toISOString() }, error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbDb = db;
});

afterEach(() => { fetched.length = 0; pending = []; });

const run = async () => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }));
  const j = await res.json();
  await Promise.allSettled(pending);
  pending = [];
  return j;
};
const orderMails = () => fetched.filter((f) => f.url.includes("api.resend.com") && /not delivered/i.test(String(f.body?.subject ?? "")));

describe("an undelivered paid order mails the owner, naming it", () => {
  it("one run with an order stuck for three hours sends one mail that names its session and buyer", async () => {
    const j = await run();
    expect(j.productDelivery.reason).toBe("undelivered");
    const mails = orderMails();
    expect(mails, "the undelivered verdict reached the JSON and no inbox").toHaveLength(1);
    const m = mails[0].body as { to: string[]; html: string; subject: string };
    expect(m.to).toEqual(["owner@example.com"]);
    expect(m.html).toContain("cs_live_a1b2c3stuckorder");
    expect(m.html).toContain("buyer@example.com");
    expect(m.html, "a payment five minutes old is not undelivered").not.toContain("cs_live_freshpayment0001");
  });

  it("the next run inside a day is silent, and a day later the order is mailed again", async () => {
    await run();
    expect(orderMails()).toHaveLength(1);
    fetched.length = 0;
    await run();
    expect(orderMails(), "the same order was mailed on every ten-minute run").toHaveLength(0);
    state = { alerted: { "pd-stuck": ago(25 * 60) } };
    await run();
    expect(orderMails()).toHaveLength(1);
  });

  it("a mail Resend refused leaves the order unannounced, so the next run tries again", async () => {
    resendStatus = 500;
    await run();
    expect(orderMails()).toHaveLength(1);
    expect(state, "a refused alert was stamped as announced").toBeNull();
    resendStatus = 200;
    fetched.length = 0;
    await run();
    expect(orderMails()).toHaveLength(1);
    expect(Object.keys((state as { alerted: Record<string, string> }).alerted)).toEqual(["pd-stuck"]);
  });

  it("the response names the order by product, state, age and a short reference, never the buyer", async () => {
    const j = await run();
    expect(j.undeliveredOrders).toEqual([expect.objectContaining({ ref: "tuckorder".slice(-8), productType: "cover_letter", status: "generating" })]);
    expect(JSON.stringify(j.undeliveredOrders)).not.toMatch(/@/);
  });

  it("a clean delivery read sends nothing and reads no rows", async () => {
    health = [{ status: "delivered", n: 3, exhausted: 0, stuck: 0, last_at: ago(30) }];
    const j = await run();
    expect(j.productDelivery.reason).toBe("clean");
    expect(orderMails()).toHaveLength(0);
    expect(db.on("product_deliveries")).toHaveLength(0);
  });
});
