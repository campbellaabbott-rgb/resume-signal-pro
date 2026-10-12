// @vitest-environment node
/**
 * Sweep S8-076. send-agent-digest was the last agent gate that looked a plan
 * up in agent_subscribers by the mandate's ADDRESS; every other one asks
 * agent_subscription_rows by user id (20261005130000). When the account's
 * address and the subscriber row's differ (an account email change, or a
 * Stripe portal email change that writes a new row), the digest skipped a
 * paying subscriber, or kept mailing a cancelled one until the period ended.
 *
 * Run on the shipped handler with Resend and the database faked.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ to: string | string[] }> = [];
const db = new FakeDb();
let handler: EdgeHandler;
const future = () => new Date(Date.now() + 9e8).toISOString();

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
  g.__agdSent2 = sent;
  g.__fakeSupabase = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("send-agent-digest", {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__agdSent2.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  });
}, 60_000);
afterEach(() => { sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

/** One claimed mandate on `mandateEmail`; the account's plan is `accountPlan`; a row by address is `byAddress`. */
function install(mandateEmail: string, accountPlan: Record<string, unknown> | null, byAddress: Record<string, unknown> | null) {
  db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: "u-1", ad_email: mandateEmail, ad_prev_sent_at: null }], error: null });
  db.rpcs.agent_subscription_rows = (a) => ({
    data: accountPlan && (a.p_user_ids as string[]).includes("u-1") ? [{ user_id: "u-1", ...accountPlan }] : [],
    error: null,
  });
  if (byAddress) db.rows("agent_subscribers").push(byAddress);
  db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: null, apply_mode: "review", auto_apply_daily_cap: 5 });
  db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
}
const run = () => handler(new Request("https://harness.supabase.co/functions/v1/send-agent-digest", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));

describe("the morning shortlist asks for the account's plan", () => {
  it("mails a paying subscriber whose account address is not the address Stripe holds", async () => {
    install("new@example.com",
      { email: "old@example.com", status: "active", current_period_end: future(), bound: true },
      { email: "old@example.com", status: "active", current_period_end: future() });
    await run();
    expect(sent.map((m) => (Array.isArray(m.to) ? m.to[0] : m.to))).toEqual(["new@example.com"]);
  });

  it("stops mailing a cancelled subscriber even while an active row sits on their address", async () => {
    install("sub@example.com",
      { email: "sub@example.com", status: "canceled", current_period_end: future(), bound: true },
      { email: "sub@example.com", status: "active", current_period_end: future() });
    await run();
    expect(sent).toEqual([]);
  });

  it("a failed plan read mails nobody", async () => {
    install("sub@example.com", null, { email: "sub@example.com", status: "active", current_period_end: future() });
    db.rpcs.agent_subscription_rows = () => ({ data: null, error: { code: "57014", message: "timeout" } });
    await run();
    expect(sent).toEqual([]);
  });
});
