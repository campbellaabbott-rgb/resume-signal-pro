// @vitest-environment node
/**
 * A DIGEST NEVER MAILS AN ADDRESS IT COULD NOT CHECK AGAINST THE DO-NOT-MAIL
 * LIST (S14X-062).
 *
 * WHAT WAS WRONG. send-search-digest and send-agent-digest read the whole of
 * suppressed_emails in one request with no range and the error thrown away.
 * PostgREST answers at most 1,000 rows, so once the list grew past that, an
 * unsubscribed, bounced or complaining address on row 1,001 was mailed; and a
 * read that failed became an empty list, so every suppressed address was
 * mailed that run.
 *
 * WHAT HOLDS NOW, on the shipped handlers with the database and Resend faked:
 * each recipient is looked up by its own address once it is known. A hit keeps
 * the claim's stamps (the address is not mailed, and is looked at a cadence
 * later); a read that failed gives the claim back, so the window is retried,
 * and is counted as suppressionUnread, never read as "nobody is suppressed".
 * Both counts are in the run's answer.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { SELLER_SET_STUB } from "./helpers/seller-set";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const sent: Array<{ to: string | string[]; subject: string }> = [];
const db = new FakeDb();
let search: EdgeHandler;
let agent: EdgeHandler;

/** PostgREST's max-rows: an unfiltered read of suppressed_emails answers its first 1,000 rows. */
function capUnfilteredSuppressionReads() {
  const realFrom = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = realFrom(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (t !== "suppressed_emails") return q;
    let filtered = false;
    const eq = q.eq.bind(q);
    q.eq = (...a: unknown[]) => { filtered = true; return eq(...a); };
    const then = q.then.bind(q);
    q.then = (ok?: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
      then((r: { data: unknown; error: unknown }) => {
        const capped = !filtered && Array.isArray(r.data) ? { ...r, data: r.data.slice(0, 1000) } : r;
        return ok ? ok(capped) : capped;
      }, no);
    return q;
  };
}

/** A thousand other addresses fill the first page of the list. */
function fillTheFirstThousand() {
  for (let i = 0; i < 1000; i++) db.rows("suppressed_emails").push({ email: `other-${i}@example.com`, reason: "unsubscribe" });
}

const PREV = "2026-11-01T14:23:00.000Z";
const SID = "5e7a0c1d-2222-4222-8222-222222222222";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__s062Sent = sent;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async () => ({ data: { user: { email: "Stopped@Example.com" } }, error: null }) },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      const jobs = [{ id: "greenhouse:acme:1", company: "Acme", title: "Nurse", location: "Leeds", applyUrl: "https://acme.example/1", postedAt: null }];
      return new Response(JSON.stringify(b.countOnly ? { total: 1, newSince: b.newSince } : { jobs, newSince: b.newSince }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const resend = "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__s062Sent.push(m); return { data: { id: 'em' }, error: null }; } }; } }";
  const supa = "export const createClient = () => globalThis.__fakeSupabase;";
  search = await loadEdgeHandler("send-search-digest", { "https://esm.sh/@supabase/supabase-js@2": supa, "https://esm.sh/resend@2.0.0": resend });
  agent = await loadEdgeHandler("send-agent-digest", { ...SELLER_SET_STUB, "https://esm.sh/@supabase/supabase-js@2": supa, "https://esm.sh/resend@2.0.0": resend });
}, 60_000);

afterEach(() => {
  sent.length = 0;
  db.tables = {}; db.writes = []; db.rpcs = {}; db.faults = [];
  delete (db as unknown as { from?: unknown }).from;
});

const post = (h: EdgeHandler, fn: string) => h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: JSON.stringify({ action: "send" }),
}));

function installSearch() {
  let fresh = false;
  db.rpcs.search_digest_claim_batch = () => ({
    data: (fresh = !fresh) ? [{ sd_id: SID, sd_user_id: "u-1", sd_name: "Nurse jobs", sd_params: { q: "nurse" }, sd_prev_sent_at: PREV, sd_fit_threshold: 0, sd_cadence: "weekly" }] : [],
    error: null,
  });
  db.rpcs.search_digest_record_sent = () => ({ data: 1, error: null });
  db.rows("user_job_searches").push({ id: SID, digest_last_sent_at: "2026-11-08T14:23:00.000Z", digest_opt_in: true });
}
const searchStamp = () => db.rows("user_job_searches")[0].digest_last_sent_at;

function installAgent() {
  db.rpcs.agent_digest_claim_batch = () => ({ data: [{ ad_user_id: "u-1", ad_email: "Stopped@Example.com", ad_prev_sent_at: PREV }], error: null });
  db.rpcs.agent_subscription_rows = () => ({ data: [{ user_id: "u-1", email: "stopped@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString(), bound: true }], error: null });
  db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: "2026-11-08T06:40:00.000Z", apply_mode: "review", auto_apply_daily_cap: 5 });
  db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: new Date().toISOString() });
}
const agentStamp = () => db.rows("agent_mandates")[0].email_last_sent_at;

describe("the saved-search digest", () => {
  it("does not mail an address on row 1,001 of the do-not-mail list, and keeps the claim's stamps", async () => {
    installSearch();
    fillTheFirstThousand();
    db.rows("suppressed_emails").push({ email: "stopped@example.com", reason: "unsubscribe" });
    capUnfilteredSuppressionReads();
    const body = await (await post(search, "send-search-digest")).json();
    expect(sent, "a suppressed address past the first 1,000 rows was mailed").toEqual([]);
    expect(body).toMatchObject({ sent: 0, suppressed: 1, suppressionUnread: 0 });
    expect(searchStamp(), "the claim's stamp stays, as for any suppressed owner").toBe("2026-11-08T14:23:00.000Z");
  });

  it("a do-not-mail read that failed mails nobody and gives the claim back", async () => {
    installSearch();
    db.faults.push({ table: "suppressed_emails", op: "select", error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const body = await (await post(search, "send-search-digest")).json();
    expect(sent, "a failed read was taken to mean nobody is suppressed").toEqual([]);
    expect(body).toMatchObject({ sent: 0, suppressionUnread: 1 });
    expect(searchStamp(), "the window is retried next run").toBe(PREV);
  });

  it("an address on no list is still mailed", async () => {
    installSearch();
    fillTheFirstThousand();
    const body = await (await post(search, "send-search-digest")).json();
    expect(sent.map((m) => m.to)).toEqual(["stopped@example.com"]);
    expect(body).toMatchObject({ sent: 1, suppressed: 0, suppressionUnread: 0 });
  });
});

describe("the agent's morning digest", () => {
  it("does not mail an entitled mandate's address on row 1,001 of the do-not-mail list, and keeps the claim's stamps", async () => {
    installAgent();
    fillTheFirstThousand();
    db.rows("suppressed_emails").push({ email: "stopped@example.com", reason: "complaint" });
    capUnfilteredSuppressionReads();
    const body = await (await post(agent, "send-agent-digest")).json();
    expect(sent, "a suppressed address past the first 1,000 rows was mailed").toEqual([]);
    expect(body).toMatchObject({ sent: 0, suppressed: 1, suppressionUnread: 0 });
    expect(agentStamp()).toBe("2026-11-08T06:40:00.000Z");
  });

  it("a do-not-mail read that failed mails nobody and gives the claim back", async () => {
    installAgent();
    db.faults.push({ table: "suppressed_emails", op: "select", error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const body = await (await post(agent, "send-agent-digest")).json();
    expect(sent).toEqual([]);
    expect(body).toMatchObject({ sent: 0, suppressionUnread: 1 });
    expect(agentStamp(), "the window is retried next run").toBe(PREV);
  });

  it("an address on no list is still mailed", async () => {
    installAgent();
    const body = await (await post(agent, "send-agent-digest")).json();
    expect(sent).toHaveLength(1);
    expect(body).toMatchObject({ sent: 1, suppressed: 0, suppressionUnread: 0 });
  });
});
