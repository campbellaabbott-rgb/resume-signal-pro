// @vitest-environment node
/**
 * A DIGEST IS SENT BY THE SCHEDULER, ONCE.
 *
 * WHAT WAS WRONG (review of 2026-10-04, the 2.23 shape in two more places).
 * send-search-digest and send-agent-digest are verify_jwt=false so pg_cron can
 * reach them, and both ran a full batch for ANY caller who posted
 * {"action":"send"}. Each selected the due rows and stamped a row only after
 * its awaited send, so N concurrent posts mailed every opted-in user N times
 * from our verified domain (and ran N board searches per saved search). The
 * market pulse had been fixed for exactly this; the digests had not.
 *
 * WHAT HOLDS NOW, proved two ways:
 *   1. Migration 20261004100000 is APPLIED to pglite: search_digest_claim_batch
 *      and agent_digest_claim_batch choose and stamp due rows in one statement
 *      (each search by its own cadence, the shortlist at most once per 20
 *      hours), a second claim gets nothing, and each row comes back with the
 *      stamp it had before. Both crons are rescheduled carrying x-email-cron,
 *      keeping their schedules; a digest job that does not exist is left so;
 *      the self-check refuses a digest cron edited back to no header.
 *   2. Both shipped handlers are RUN with Resend, the board and the database
 *      faked: no key, the publishable key or a wrong cron key is a 401 that
 *      claims nothing and sends nothing; the cron key or the service role
 *      claims and mails exactly the claimed rows; every skip that used to
 *      leave a row unstamped gives its claim back, so the next run retries it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { MAIL_DOOR_VERIFY, bootMailDoorDb, rows } from "./helpers/mail-door-db";

// ── 1. the SQL ───────────────────────────────────────────────────────────────

const U = "11111111-1111-4111-8111-111111111111";
describe("the claims, applied to the tables they meet", () => {
  let pg: PGlite;
  beforeAll(async () => { pg = await bootMailDoorDb({ cron: true, digestCrons: true }); }, 120_000);
  beforeEach(async () => { await pg.exec("BEGIN"); });
  afterEach(async () => { await pg.exec("ROLLBACK"); });

  const searches = () => rows<{ sd_name: string; sd_prev_sent_at: string | null }>(pg, "SELECT * FROM public.search_digest_claim_batch(400) ORDER BY sd_name");
  const mandates = () => rows<{ ad_email: string; ad_prev_sent_at: string | null }>(pg, "SELECT * FROM public.agent_digest_claim_batch(500) ORDER BY ad_email");

  it("a saved search is claimed by its own cadence, opted-in only, and a second claim gets nothing", async () => {
    await pg.query(`INSERT INTO public.user_job_searches (user_id, name, digest_opt_in, digest_cadence, digest_last_sent_at) VALUES
      ($1, 'never-sent', true, 'weekly', NULL),
      ($1, 'daily-21h', true, 'daily', now() - interval '21 hours'),
      ($1, 'daily-19h', true, 'daily', now() - interval '19 hours'),
      ($1, 'weekly-5d', true, 'weekly', now() - interval '5 days'),
      ($1, 'weekly-7d', true, 'weekly', now() - interval '7 days'),
      ($1, 'opted-out', false, 'daily', NULL)`, [U]);
    const first = await searches();
    expect(first.map((r) => r.sd_name)).toEqual(["daily-21h", "never-sent", "weekly-7d"]);
    expect(first.find((r) => r.sd_name === "never-sent")!.sd_prev_sent_at, "a first send keeps its 'never sent' marker").toBeNull();
    expect(first.find((r) => r.sd_name === "weekly-7d")!.sd_prev_sent_at, "the previous stamp is the 'new since' window").not.toBeNull();
    expect(await searches(), "a second run in the same window mailed the same searches").toEqual([]);
    const stamped = await rows<{ name: string }>(pg, "SELECT name FROM public.user_job_searches WHERE digest_last_sent_at > now() - interval '1 minute' ORDER BY name");
    expect(stamped.map((r) => r.name)).toEqual(["daily-21h", "never-sent", "weekly-7d"]);
  });

  it("the morning shortlist is claimed at most once per 20 hours, opted-in only", async () => {
    await pg.query(`INSERT INTO public.agent_mandates (user_id, email, email_opt_in, email_last_sent_at) VALUES
      (gen_random_uuid(), 'due@example.com', true, now() - interval '21 hours'),
      (gen_random_uuid(), 'new@example.com', true, NULL),
      (gen_random_uuid(), 'recent@example.com', true, now() - interval '3 hours'),
      (gen_random_uuid(), 'off@example.com', false, NULL)`);
    expect((await mandates()).map((r) => r.ad_email)).toEqual(["due@example.com", "new@example.com"]);
    expect(await mandates()).toEqual([]);
  });

  it("no client role can run either claim", async () => {
    const r = await rows<{ f: string; anon: boolean; auth: boolean; svc: boolean }>(pg, `
      SELECT f, has_function_privilege('anon', f, 'EXECUTE') AS anon, has_function_privilege('authenticated', f, 'EXECUTE') AS auth,
             has_function_privilege('service_role', f, 'EXECUTE') AS svc
        FROM unnest(ARRAY['public.search_digest_claim_batch(integer)', 'public.agent_digest_claim_batch(integer)']) f`);
    for (const x of r) expect(x, x.f).toMatchObject({ anon: false, auth: false, svc: true });
  });

  it("both digest crons now carry the cron key, on the schedules they already had", async () => {
    const j = await rows<{ jobname: string; schedule: string; command: string }>(pg,
      "SELECT jobname, schedule, command FROM cron.job WHERE jobname IN ('send-search-digest', 'send-agent-digest') ORDER BY jobname");
    expect(j.map((x) => [x.jobname, x.schedule])).toEqual([["send-agent-digest", "40 6 * * *"], ["send-search-digest", "23 14 * * *"]]);
    for (const x of j) {
      expect(x.command, x.jobname).toMatch(/'x-email-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'email_cron_key'/);
      expect(x.command, x.jobname).toContain(`/functions/v1/${x.jobname}'`);
    }
  });

  it("a digest cron the staged runner edited back to no header fails the self-check", async () => {
    await pg.query("UPDATE cron.job SET command = 'SELECT net.http_post(url := ''x'')' WHERE jobname = 'send-agent-digest'");
    await expect(pg.exec(MAIL_DOOR_VERIFY)).rejects.toThrow(/the send-agent-digest cron does not carry the email cron key/);
  });
});

describe("a database with no digest jobs", () => {
  it("is left with none: an absent job is someone's decision", async () => {
    const pg = await bootMailDoorDb({ cron: true });
    expect(await rows(pg, "SELECT jobname FROM cron.job WHERE jobname LIKE 'send-%digest'")).toEqual([]);
  }, 60_000);
});

// ── 2. the handlers ──────────────────────────────────────────────────────────

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const CRON_KEY = "c".repeat(64);
type Sent = { to: string | string[]; subject: string; html: string };
const sent: Sent[] = [];
const failFor = new Set<string>();
const db = new FakeDb();
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let boardTotal = 0;
let boardJobs: unknown[] = [];
let search: EdgeHandler;
let agent: EdgeHandler;

function rpc(name: string, impl: (a: Record<string, unknown>) => unknown) {
  db.rpcs[name] = (args) => { calls.push({ name, args }); return { data: impl(args), error: null }; };
}
const to = (m: Sent) => (Array.isArray(m.to) ? m.to[0] : m.to);

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_harness" };
  g.__digestSent = sent;
  g.__digestFail = failFor;
  g.__fakeSupabase = db;
  (db as unknown as { auth: unknown }).auth = {
    admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id.slice(0, 4)}@example.com` } }, error: null }) },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      const b = JSON.parse(init.body);
      return new Response(JSON.stringify(b.countOnly ? { total: boardTotal } : { jobs: boardJobs }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = {
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__fakeSupabase;",
    "https://esm.sh/resend@2.0.0":
      "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__digestSent.push(m); const t = Array.isArray(m.to) ? m.to[0] : m.to; return globalThis.__digestFail.has(t) ? { data: null, error: { message: 'bounced' } } : { data: { id: 'em' }, error: null }; } }; } }",
  };
  search = await loadEdgeHandler("send-search-digest", stubs);
  agent = await loadEdgeHandler("send-agent-digest", stubs);
}, 60_000);

afterEach(() => {
  sent.length = 0; calls.length = 0; failFor.clear(); db.tables = {}; db.writes = []; db.rpcs = {};
  boardTotal = 0; boardJobs = [];
});

const post = (h: EdgeHandler, fn: string, headers: Record<string, string> = {}) =>
  h(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action: "send" }),
  }));

const UNAUTHORISED = [{}, { authorization: "Bearer anon_publishable_key_0123456789abcdef" }, { "x-email-cron": "d".repeat(64) }, { "x-email-cron": "short" }];

describe("send-search-digest answers the scheduler and our service role, nobody else", () => {
  const claimed = (prev: string | null, extra: Record<string, unknown> = {}) => ({
    sd_id: "s-1", sd_user_id: "abcd-user", sd_name: "Nurse jobs", sd_params: { q: "nurse" },
    sd_prev_sent_at: prev, sd_fit_threshold: 0, sd_cadence: "weekly", ...extra,
  });

  it("no key, the publishable key, or a wrong cron key: 401, nothing claimed, nothing sent", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("search_digest_claim_batch", () => [claimed(null)]);
    for (const h of UNAUTHORISED) expect((await post(search, "send-search-digest", h)).status, JSON.stringify(h)).toBe(401);
    expect(calls.filter((c) => c.name === "search_digest_claim_batch")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("the cron key claims, and the claim is the only selection: it mails exactly the claimed search, and keeps the stamp", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("search_digest_claim_batch", () => [claimed("2026-09-27T14:23:00Z")]);
    boardTotal = 3;
    boardJobs = [{ id: "j1", company: "Acme", title: "Nurse", location: "Leeds", applyUrl: "https://acme.example/apply" }];
    const res = await post(search, "send-search-digest", { "x-email-cron": CRON_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, considered: 1 });
    expect(sent.map(to)).toEqual(["abcd@example.com"]);
    expect(db.writes.filter((w) => w.table === "user_job_searches"), "a sent digest gave its claim back").toEqual([]);
  });

  it("a failed send, or a transient empty list, gives the claim back so the next run retries", async () => {
    rpc("search_digest_claim_batch", () => [claimed("2026-09-27T14:23:00Z")]);
    db.rows("user_job_searches").push({ id: "s-1", digest_last_sent_at: "2026-10-04T14:23:00Z" });
    boardTotal = 3;
    boardJobs = [{ id: "j1", company: "Acme", title: "Nurse", location: "Leeds", applyUrl: "https://acme.example/apply" }];
    failFor.add("abcd@example.com");
    expect(await (await post(search, "send-search-digest", { authorization: `Bearer ${SERVICE}` })).json()).toMatchObject({ sent: 0, skipped: 1 });
    expect(db.rows("user_job_searches")[0].digest_last_sent_at).toBe("2026-09-27T14:23:00Z");
    db.rows("user_job_searches")[0].digest_last_sent_at = "2026-10-04T14:23:00Z";
    failFor.clear();
    boardJobs = [];
    await post(search, "send-search-digest", { authorization: `Bearer ${SERVICE}` });
    expect(db.rows("user_job_searches")[0].digest_last_sent_at).toBe("2026-09-27T14:23:00Z");
  });

  it("nothing new: no mail, and the claim's stamp advances the window", async () => {
    rpc("search_digest_claim_batch", () => [claimed(null)]);
    boardTotal = 0;
    await post(search, "send-search-digest", { authorization: `Bearer ${SERVICE}` });
    expect(sent).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("the preflight answers its build", async () => {
    const res = await search(new Request("https://harness.supabase.co/functions/v1/send-search-digest", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^send-search-digest\.2026-10-04\.\d+$/);
  });
});

describe("send-agent-digest answers the scheduler and our service role, nobody else", () => {
  const due = [{ ad_user_id: "u-1", ad_email: "Sub@Example.com", ad_prev_sent_at: "2026-10-03T06:40:00Z" }];
  const live = () => {
    db.rows("agent_subscribers").push({ email: "sub@example.com", status: "active", current_period_end: new Date(Date.now() + 9e8).toISOString() });
    db.rows("agent_mandates").push({ user_id: "u-1", email_last_sent_at: "2026-10-04T06:40:00Z" });
  };

  it("no key, the publishable key, or a wrong cron key: 401, nothing claimed, nothing sent", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("agent_digest_claim_batch", () => due);
    for (const h of UNAUTHORISED) expect((await post(agent, "send-agent-digest", h)).status, JSON.stringify(h)).toBe(401);
    expect(calls.filter((c) => c.name === "agent_digest_claim_batch")).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("the cron key claims and mails the claimed subscriber's new picks, keeping the stamp", async () => {
    rpc("email_cron_key_matches", (a) => a.p_key === CRON_KEY);
    rpc("agent_digest_claim_batch", () => due);
    live();
    db.rows("agent_queue").push(
      { user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: "Leeds", apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: "2026-10-04T05:00:00Z" },
      { user_id: "u-1", status: "ready", posting_id: "p0", title: "Old pick", company: "Acme", location: "Leeds", apply_url: "https://acme.example/b", salary: null, fit_pct: 90, reasons: [], created_at: "2026-10-01T05:00:00Z" },
    );
    const res = await post(agent, "send-agent-digest", { "x-email-cron": CRON_KEY });
    expect(await res.json()).toMatchObject({ sent: 1, skipped: 0 });
    expect(sent.map(to)).toEqual(["Sub@Example.com"]);
    expect(sent[0].html, "the cursor is the claim's PREVIOUS stamp: older picks were already mailed").not.toContain("Old pick");
    expect(db.rows("agent_mandates")[0].email_last_sent_at, "a sent digest gave its claim back").toBe("2026-10-04T06:40:00Z");
  });

  it("an empty shortlist, a lapsed subscriber or a failed send gives the claim back: the cursor stays where it was", async () => {
    rpc("agent_digest_claim_batch", () => due);
    live();
    await post(agent, "send-agent-digest", { authorization: `Bearer ${SERVICE}` });
    expect(sent).toEqual([]);
    expect(db.rows("agent_mandates")[0].email_last_sent_at).toBe("2026-10-03T06:40:00Z");

    db.rows("agent_mandates")[0].email_last_sent_at = "2026-10-04T06:40:00Z";
    db.tables.agent_subscribers = [];
    db.rows("agent_queue").push({ user_id: "u-1", status: "ready", posting_id: "p1", title: "Nurse", company: "Acme", location: null, apply_url: "https://acme.example/a", salary: null, fit_pct: 80, reasons: [], created_at: "2026-10-04T05:00:00Z" });
    await post(agent, "send-agent-digest", { authorization: `Bearer ${SERVICE}` });
    expect(sent).toEqual([]);
    expect(db.rows("agent_mandates")[0].email_last_sent_at).toBe("2026-10-03T06:40:00Z");

    db.rows("agent_mandates")[0].email_last_sent_at = "2026-10-04T06:40:00Z";
    live();
    failFor.add("Sub@Example.com");
    await post(agent, "send-agent-digest", { authorization: `Bearer ${SERVICE}` });
    expect(db.rows("agent_mandates")[0].email_last_sent_at).toBe("2026-10-03T06:40:00Z");
  });

  it("the preflight answers its build", async () => {
    const res = await agent(new Request("https://harness.supabase.co/functions/v1/send-agent-digest", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^send-agent-digest\.2026-10-04\.\d+$/);
  });
});
