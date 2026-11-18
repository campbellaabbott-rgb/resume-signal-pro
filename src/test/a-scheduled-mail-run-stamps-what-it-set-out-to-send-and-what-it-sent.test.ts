// @vitest-environment node
/**
 * A SCHEDULED MAIL RUN STAMPS WHAT IT SET OUT TO SEND AND WHAT IT SENT (NB-37,
 * the senders' half; mail-watch's rule R11 reads the stamps).
 *
 * WHAT WAS WRONG. mail-watch counts the rows a mail class writes, so a class
 * that stops trying to send writes none and rings nothing: a claim that
 * starts returning nothing, or a provider refusing every send, left every
 * 14:23 run "succeeding" while subscribers heard nothing for weeks.
 *
 * WHAT HOLDS NOW: each scheduled sender (the saved-search digest, the agent's
 * morning digest, the market pulse) writes job_board_meta
 * mail_run:<class> = { at, due, sent, givenBack, refused } at the end of every
 * run: due is the mails it composed after its own opt-outs and suppressions,
 * refused the ones the provider would not take, givenBack the claims it handed
 * back. Counts and a time only. A stamp that cannot be written never fails
 * the run.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ to: string | string[] }> = [];
const refuse = new Set<string>();
const db = new FakeDb();
const h: Record<"search" | "agent" | "pulse", EdgeHandler> = {} as never;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__nb37Sent = sent;
  g.__nb37Refuse = refuse;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = { admin: { getUserById: async () => ({ data: { user: { email: "seeker@example.com" } }, error: null }) } };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      const jobs = [{ id: "greenhouse:acme:1", company: "Acme", title: "Nurse", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: null }];
      return new Response(JSON.stringify(b.countOnly ? { total: 1, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = {
    ...SELLER_SET_STUB,
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__nb37Sent.push(m); const to = Array.isArray(m.to) ? m.to[0] : m.to; return globalThis.__nb37Refuse.has(to) ? { data: null, error: { message: 'refused' } } : { data: { id: 'em' }, error: null }; } }; } }",
  };
  h.search = await loadEdgeHandler("send-search-digest", stubs);
  h.agent = await loadEdgeHandler("send-agent-digest", stubs);
  h.pulse = await loadEdgeHandler("send-market-pulse", stubs);
}, 90_000);
afterEach(() => { sent.length = 0; refuse.clear(); db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = []; });

const post = (fn: "search" | "agent" | "pulse") => h[fn](new Request(`https://harness.supabase.co/functions/v1/send-${fn === "search" ? "search-digest" : fn === "agent" ? "agent-digest" : "market-pulse"}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));
const stamp = (cls: string) => db.rows("job_board_meta").find((r) => r.k === `mail_run:${cls}`)?.v as Record<string, unknown> | undefined;

function installSearch() {
  let fresh = false;
  db.rpcs.search_digest_claim_batch = () => ({
    data: (fresh = !fresh) ? [{ sd_id: "5e7a0c1d-6666-4666-8666-666666666666", sd_user_id: "u-1", sd_name: "Nurse jobs", sd_params: { q: "nurse" }, sd_prev_sent_at: "2026-11-01T14:23:00.000Z", sd_fit_threshold: 0, sd_cadence: "weekly" }] : [],
    error: null,
  });
  db.rpcs.search_digest_record_sent = () => ({ data: 1, error: null });
  db.rows("user_job_searches").push({ id: "5e7a0c1d-6666-4666-8666-666666666666", digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
}
function installAgent() {
  db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: "u-1", ad_email: "agent@example.com", ad_prev_sent_at: null }], error: null });
  db.rpcs.agent_subscription_rows = () => ({ data: [{ user_id: "u-1", email: "agent@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString(), bound: true }], error: null });
  db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: null, apply_mode: "review", auto_apply_daily_cap: 5 });
  db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
}
function installPulse() {
  db.rpcs.market_pulse_claim_batch = () => ({ data: [{ cl_email: "pulse@example.com", cl_industry: "technology", cl_last_score: null, cl_confirmed_at: "2026-10-01T00:00:00Z", cl_prev_sent_at: null }], error: null });
  db.rpcs.get_user_score_trend = () => ({ data: [], error: null });
  db.rows("market_pulse_subscribers").push({ email: "pulse@example.com", industry: "technology", locale: null });
}

describe("each sender stamps its run", () => {
  it("the saved-search digest: one mail composed and sent", async () => {
    installSearch();
    expect(await (await post("search")).json()).toMatchObject({ ok: true, sent: 1 });
    const v = stamp("search_digest");
    expect(v, "no run stamp").toBeTruthy();
    expect(v).toMatchObject({ due: 1, sent: 1, givenBack: 0, refused: 0 });
    expect(Math.abs(Date.parse(String(v!.at)) - Date.now())).toBeLessThan(60_000);
  });

  it("the saved-search digest: a send the provider refused is due, refused and given back, never sent", async () => {
    installSearch();
    refuse.add("seeker@example.com");
    await post("search");
    expect(stamp("search_digest")).toMatchObject({ due: 1, sent: 0, givenBack: 1, refused: 1 });
  });

  it("the agent's morning digest", async () => {
    installAgent();
    expect(await (await post("agent")).json()).toMatchObject({ ok: true, sent: 1 });
    expect(stamp("agent_digest")).toMatchObject({ due: 1, sent: 1, givenBack: 0, refused: 0 });
  });

  it("the agent's morning digest stamps a run that found nobody due", async () => {
    db.rpcs.agent_digest_claim_batch = () => ({ data: [], error: null });
    await post("agent");
    expect(stamp("agent_digest")).toMatchObject({ due: 0, sent: 0, givenBack: 0, refused: 0 });
  });

  it("the market pulse", async () => {
    installPulse();
    expect(await (await post("pulse")).json()).toMatchObject({ success: true, sent: 1 });
    expect(stamp("market_pulse")).toMatchObject({ due: 1, sent: 1, givenBack: 0, refused: 0 });
  });

  it("the market pulse: a refused send is due, refused and given back", async () => {
    installPulse();
    refuse.add("pulse@example.com");
    await post("pulse");
    expect(stamp("market_pulse")).toMatchObject({ due: 1, sent: 0, givenBack: 1, refused: 1 });
  });

  it("carries counts and a time only: no address, no name", async () => {
    installSearch();
    await post("search");
    const v = stamp("search_digest")!;
    expect(Object.keys(v).sort()).toEqual(["at", "due", "givenBack", "refused", "sent"]);
    expect(JSON.stringify(v)).not.toMatch(/@|Nurse/);
  });
});

describe("a stamp that cannot be written", () => {
  it("never fails the run", async () => {
    installSearch();
    db.faults.push({ table: "job_board_meta", op: "upsert", error: { code: "42501", message: "permission denied" } });
    const res = await post("search");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 1 });
  });
});
