// @vitest-environment node
/**
 * THE SAVED-SEARCH DIGEST CLAIMED FOUR HUNDRED AND LOST EVERY WINDOW IT NEVER
 * REACHED (S8-052).
 *
 * WHAT WAS WRONG. search_digest_claim_batch stamps every row it returns. The
 * digest claimed 400 at once and then worked them one by one, 1-2.5 s each,
 * with no clock: the isolate dies near 150 s, and every claimed row it never
 * reached kept the new stamp -- its window gone, and its first-match mail
 * (which needs a NULL stamp) gone for good. The pulse (200) and the agent
 * digest (500) loops had no clock either.
 *
 * WHAT HOLDS NOW, running the shipped handlers with a clock that moves 30 s
 * per search: the digest claims 25 at a time, starts nothing after 100 s, and
 * hands every claimed-but-unstarted row back with its old stamp; rows it
 * never claimed are untouched. The pulse and agent loops hand back what the
 * clock left.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const db = new FakeDb();
const claims: number[] = [];
const sent: unknown[] = [];
let search: EdgeHandler;
let pulse: EdgeHandler;
let agent: EdgeHandler;
const realNow = Date.now;
let offset = 0;
const tick = () => { offset += 30_000; };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__clockSent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async () => { tick(); return { data: { user: { email: "seeker@example.com" } }, error: null }; } },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      return new Response(JSON.stringify(b.countOnly ? { total: 0, newSince: b.newSince } : { jobs: [], newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__clockSent.push(m); return { data: { id: 'em' }, error: null }; } }; } }",
  };
  search = await loadEdgeHandler("send-search-digest", stubs);
  pulse = await loadEdgeHandler("send-market-pulse", stubs);
  agent = await loadEdgeHandler("send-agent-digest", stubs);
  Date.now = () => realNow() + offset;
}, 60_000);

afterAll(() => { Date.now = realNow; });
afterEach(() => { offset = 0; claims.length = 0; sent.length = 0; db.tables = {}; db.writes = []; db.rpcs = {}; });

const post = (h: EdgeHandler, fn: string) => h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));
const NOW_STAMP = "2026-10-09T14:23:00.000Z";
const prevOf = (i: number) => `2026-10-0${1 + (i % 5)}T14:23:00.000Z`;

describe("the saved-search digest has a clock", () => {
  it("claims 25 at a time, starts nothing after 100 s, and hands back every claimed row it did not start", async () => {
    // 60 due searches; the claim stamps what it returns, as the SQL does.
    const pool = Array.from({ length: 60 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, prev: prevOf(i) }));
    for (const p of pool) db.rows("user_job_searches").push({ id: p.id, digest_last_sent_at: p.prev, digest_opt_in: true });
    db.rpcs.search_digest_claim_batch = (a) => {
      claims.push(Number(a.p_limit));
      const take = pool.splice(0, Number(a.p_limit));
      for (const t of take) db.rows("user_job_searches").find((r) => r.id === t.id)!.digest_last_sent_at = NOW_STAMP;
      return { data: take.map((t) => ({ sd_id: t.id, sd_user_id: "u", sd_name: "n", sd_params: { q: "nurse" }, sd_prev_sent_at: t.prev, sd_fit_threshold: 0, sd_cadence: "daily" })), error: null };
    };
    const body = await (await post(search, "send-search-digest")).json();
    expect(Math.max(...claims), "the run claimed more than it could work").toBeLessThanOrEqual(25);
    expect(body).toMatchObject({ considered: 25, handedBack: 21 });
    const rows = db.rows("user_job_searches");
    // Four searches ran (nothing new: their stamp is the window's end); 21
    // claimed and not started are back to their old stamp; 35 never claimed.
    expect(rows.filter((r) => r.digest_last_sent_at === NOW_STAMP), "a claimed row the run never reached lost its window").toHaveLength(4);
    rows.forEach((r, i) => { if (r.digest_last_sent_at !== NOW_STAMP) expect(r.digest_last_sent_at).toBe(prevOf(i)); });
    expect(pool).toHaveLength(35);
  });
});

describe("the pulse and the agent digest hand back what the clock left", () => {
  it("the pulse: subscribers past 100 s keep their month", async () => {
    const due = Array.from({ length: 10 }, (_, i) => ({ cl_email: `s${i}@example.com`, cl_industry: "technology", cl_last_score: null, cl_confirmed_at: "2026-10-01T00:00:00Z", cl_prev_sent_at: prevOf(i) }));
    for (const d of due) db.rows("market_pulse_subscribers").push({ email: d.cl_email, last_sent_at: NOW_STAMP });
    db.rpcs.market_pulse_claim_batch = () => ({ data: due, error: null });
    db.rpcs.get_user_score_trend = () => { tick(); return { data: [], error: null }; };
    const body = await (await post(pulse, "send-market-pulse")).json();
    expect(body).toMatchObject({ sent: 4, handedBack: 6 });
    const back = db.rows("market_pulse_subscribers").filter((r) => r.last_sent_at !== NOW_STAMP);
    expect(back.map((r) => r.email)).toEqual(due.slice(4).map((d) => d.cl_email));
  });

  it("the agent digest: mandates past 100 s keep their cursor", async () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ ad_user_id: `u-${i}`, ad_email: `m${i}@example.com`, ad_prev_sent_at: prevOf(i) }));
    db.rpcs.agent_digest_claim_batch = () => ({ data: list, error: null });
    for (const l of list) db.rows("agent_mandates").push({ user_id: l.ad_user_id, email_last_sent_at: NOW_STAMP, apply_mode: "review", auto_apply_daily_cap: 5 });
    // Each mandate's queue read moves the clock 30 s.
    const realFrom = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => { if (t === "agent_queue") tick(); return realFrom(t); };
    for (const l of list) {
      db.rows("agent_subscribers").push({ email: l.ad_email, status: "active", current_period_end: new Date(realNow() + 9e8).toISOString() });
      db.rows("agent_queue").push({ user_id: l.ad_user_id, status: "ready", posting_id: `p-${l.ad_user_id}`, title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date(realNow()).toISOString() });
    }
    try {
      const body = await (await post(agent, "send-agent-digest")).json();
      expect(body.handedBack, "the agent loop ran past its clock").toBeGreaterThan(0);
      const back = db.rows("agent_mandates").filter((r) => r.email_last_sent_at !== NOW_STAMP);
      expect(back).toHaveLength(body.handedBack);
      for (const b of back) expect(b.email_last_sent_at).toBe(prevOf(Number(String(b.user_id).slice(2))));
    } finally {
      (db as unknown as { from: unknown }).from = realFrom;
    }
  });
});
