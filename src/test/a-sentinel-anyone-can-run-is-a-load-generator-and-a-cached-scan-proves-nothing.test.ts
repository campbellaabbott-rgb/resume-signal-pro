// @vitest-environment node
/**
 * A SENTINEL ANYONE CAN RUN IS A LOAD GENERATOR, AND A CACHED SCAN PROVES
 * NOTHING (wave 2 email-ops, register L10-10, L10-21, L10-15, L10-05, L10-08,
 * and the heartbeat half of L13-67).
 *
 * WHAT WAS WRONG, in scan-heartbeat:
 *   L10-10  it answered any POST, and every run makes a model call, a full
 *           scan with the limiter bypass, whole-table counts, the slow
 *           job-board probes and (on a stall) a service-role refresh kick;
 *   L10-21  its end-to-end scan sent a constant résumé, which free-keyword-
 *           scan answered from its 7-day report cache before any AI work, so
 *           e2e_scan read green across ~177 runs that recorded no completion;
 *   L10-15  vendor drift PASSED when the canary answered 5xx and vanished on a
 *           timeout, against the file's own rule that unevaluated is skipped;
 *   L10-05  an alert stamped every failing check "announced" before the send,
 *           and the send's answer was never read, so a refused alert silenced
 *           its checks for a day;
 *   L10-08  "is email actually going out" read only email_send_log, which no
 *           paid-report mailer writes;
 *   L13-67  nothing watched the Stripe key: a rolled or missing key fails
 *           every checkout while everything reads healthy.
 *
 * WHAT HOLDS NOW, by running the shipped handler with its network faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, eqs, type Answer, type Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ADMIN = "admin_key_for_the_harness_0123456789";
const CRON_KEY = "c".repeat(64);
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: ADMIN, HEARTBEAT_SECRET: "hb", STRIPE_SECRET_KEY: "sk_test_x",
};
type Call = { url: string; body: Record<string, unknown> | null };
const fetched: Call[] = [];
let db: ProxyDb;
let pending: Promise<unknown>[] = [];
let handler: EdgeHandler;
/** Per-URL answers; a test overrides the ones it is about. */
let answers: Record<string, (body: Record<string, unknown> | null) => Response | Promise<Response>> = {};

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const DEFAULTS: Record<string, (body: Record<string, unknown> | null) => Response | Promise<Response>> = {
  "ai.gateway.lovable.dev": () => okJson({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] }),
  "api.stripe.com": () => okJson({ object: "balance" }),
  "api.resend.com": () => okJson({ id: "em" }),
  "/functions/v1/free-keyword-scan": () => okJson({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" } }),
  "/functions/v1/job-board": (b) => (b?.action === "vendor-health" ? okJson({ drifted: [], unreachable: [] }) : okJson({ jobs: [], total: 0 })),
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    fetched.push({ url: u, body });
    const key = Object.keys({ ...DEFAULTS, ...answers }).find((k) => u.includes(k));
    const fn = key ? (answers[key] ?? DEFAULTS[key]) : () => okJson({});
    return fn(body);
  };
  handler = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbDb; }",
  });
});

beforeEach(() => {
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "email_cron_key_matches") return { data: (q.calls[0][1][0] as { p_key: string }).p_key === CRON_KEY, error: null };
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.rpc === "get_email_health") return { data: [{ total_emails: 5, successful_emails: 3, failed_emails: 2, success_rate: 60 }], error: null };
    if (q.rpc === "email_delivery_health") return { data: [{ status: "sent", n: 4, stuck: 0, last_at: new Date().toISOString() }], error: null };
    if (q.table === "job_board_meta" && eqs(q, "k", "refresh_progress")) return { data: { updated_at: new Date().toISOString() }, error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbDb = db;
});

afterEach(() => { fetched.length = 0; pending = []; answers = {}; });

const run = (headers: Record<string, string> = {}) =>
  handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }));
const check = (j: { checks: Array<{ name: string; passed: boolean; error?: string }> }, name: string) => j.checks.find((c) => c.name === name);
const skipped = (j: { skipped: Array<{ name: string; reason: string }> }, name: string) => j.skipped.find((s) => s.name === name);
const settle = async () => { await Promise.allSettled(pending); };

describe("L10-10: the heartbeat answers its cron, the service role and the owner, nobody else", () => {
  it("no key, the publishable key, or a wrong cron key: 401, and nothing is fetched or counted", async () => {
    for (const h of [{}, { authorization: "Bearer anon" }, { "x-email-cron": "d".repeat(64) }, { "x-admin-key": "wrong" }]) {
      expect((await run(h)).status, JSON.stringify(h)).toBe(401);
    }
    expect(fetched, "a stranger's POST still ran the model call and the scan").toEqual([]);
    expect(db.queries.filter((q) => q.rpc !== "email_cron_key_matches"), "a stranger's POST still read the tables").toEqual([]);
  });

  it("the cron key, the service role and the owner's key each run it", async () => {
    for (const h of [{ "x-email-cron": CRON_KEY }, { authorization: `Bearer ${SERVICE}` }, { "x-admin-key": ADMIN }]) {
      const res = await run(h);
      expect(res.status, JSON.stringify(Object.keys(h))).toBe(200);
      await settle();
    }
  });

  it("the preflight lets the dashboard send the owner's key and names the build", async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-allow-headers")).toMatch(/x-admin-key/);
    expect(res.headers.get("x-fn-build")).toMatch(/^scan-heartbeat\.2026-10-(0[89]|[1-3]\d)\.\d+$/);
  });
});

describe("L10-21: the end-to-end scan is never a cache hit", () => {
  it("each run sends a résumé no earlier run sent, marked synthetic", async () => {
    await run({ authorization: `Bearer ${SERVICE}` });
    await run({ authorization: `Bearer ${SERVICE}` });
    await settle();
    const scans = fetched.filter((f) => f.url.endsWith("/functions/v1/free-keyword-scan")).map((f) => f.body!);
    expect(scans).toHaveLength(2);
    expect(scans[0].resumeText, "the constant résumé hit the 7-day report cache").not.toBe(scans[1].resumeText);
    for (const s of scans) expect(s.synthetic).toBe(true);
  });

  it("a report served from the cache fails e2e_scan", async () => {
    answers["/functions/v1/free-keyword-scan"] = () => okJson({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, cachedReport: true });
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(check(j, "e2e_scan")).toMatchObject({ passed: false });
    expect(check(j, "e2e_scan")!.error).toMatch(/report cache/);
  });
});

describe("L10-15: vendor drift is skipped, never passed, when it was not evaluated", () => {
  it("a 5xx from the canary is a skip with its reason, not a pass", async () => {
    answers["/functions/v1/job-board"] = (b) => (b?.action === "vendor-health" ? okJson({ error: "boom" }, 503) : okJson({ jobs: [], total: 0 }));
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(check(j, "job_board_vendors"), "a failing canary read as no drift").toBeUndefined();
    expect(skipped(j, "job_board_vendors")!.reason).toMatch(/HTTP 503/);
  });

  it("a canary that never answers is a skip too, not a vanished check", async () => {
    answers["/functions/v1/job-board"] = (b) => {
      if (b?.action === "vendor-health") { const e = new Error("The signal has been aborted"); e.name = "AbortError"; throw e; }
      return okJson({ jobs: [], total: 0 });
    };
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(skipped(j, "job_board_vendors")!.reason).toMatch(/did not answer/);
  });

  it("a real answer with no drift still passes", async () => {
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(check(j, "job_board_vendors")).toMatchObject({ passed: true });
  });
});

describe("L13-67: the Stripe key is checked, and only a 200 passes", () => {
  it("a refused key fails the check and degrades the run; Stripe's own 5xx is a skip", async () => {
    answers["api.stripe.com"] = () => okJson({ error: { type: "invalid_request_error" } }, 401);
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(check(j, "stripe_credentials")).toMatchObject({ passed: false });
    expect(j.status).not.toBe("healthy");
    answers["api.stripe.com"] = () => okJson({}, 503);
    const k = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(check(k, "stripe_credentials")).toBeUndefined();
    expect(skipped(k, "stripe_credentials")!.reason).toMatch(/HTTP 503/);
  });

  it("a missing key fails", async () => {
    const saved = env.STRIPE_SECRET_KEY;
    delete env.STRIPE_SECRET_KEY;
    try {
      const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
      await settle();
      expect(check(j, "stripe_credentials")).toMatchObject({ passed: false });
    } finally { env.STRIPE_SECRET_KEY = saved; }
  });
});

describe("L10-08: the delivery check counts the paid-report mail log too", () => {
  it("email_logs' sent and failed counts reach the delivery verdict, as counts only", async () => {
    const j = await (await run({ authorization: `Bearer ${SERVICE}` })).json();
    await settle();
    expect(j.delivery.paidMail).toEqual({ sent: 3, failed: 2 });
    expect(j.delivery.failed, "a failed paid report was invisible to the sentinel").toBe(2);
    expect(j.delivery.reason).toBe("failures");
    expect(JSON.stringify(j.delivery)).not.toMatch(/@/);
  });
});

describe("L10-05: an alert is marked announced only after Resend took it", () => {
  const stateWrites = () => db.on("job_board_meta", "upsert").map((q) => (q.calls.find(([m]) => m === "upsert")![1][0] as { k: string; v: { alerted?: Record<string, string> } }))
    .filter((r) => r.k === "heartbeat_alert_state");

  it("a refused alert stamps nothing, so the next run tries again", async () => {
    answers["ai.gateway.lovable.dev"] = () => okJson({ error: "down" }, 500); // something to alert about
    answers["api.resend.com"] = () => okJson({ message: "rate limited" }, 429);
    await run({ authorization: `Bearer ${SERVICE}` });
    await settle();
    expect(fetched.some((f) => f.url.includes("api.resend.com")), "no alert was attempted").toBe(true);
    expect(stateWrites().filter((w) => w.v.alerted && Object.keys(w.v.alerted).length > 0), "a refused alert marked its checks announced").toEqual([]);
  });

  it("an accepted alert stamps its checks, after the send", async () => {
    answers["ai.gateway.lovable.dev"] = () => okJson({ error: "down" }, 500);
    await run({ authorization: `Bearer ${SERVICE}` });
    await settle();
    const stamped = stateWrites().filter((w) => w.v.alerted && "ai_gateway" in w.v.alerted);
    expect(stamped).toHaveLength(1);
  });
});

describe("the migration, applied to pglite (20261008123000)", () => {
  it("the sentinel cron keeps its schedule and now sends the cron key; the sign-up note sends it too; the heartbeat reader is closed", async () => {
    const { bootEmailOpsDb, migration, rows } = await import("./helpers/email-ops-db");
    const pg = await bootEmailOpsDb({
      cron: true,
      seed: "SELECT cron.schedule('scan-heartbeat-sentinel', '*/10 * * * *', 'SELECT net.http_post(url := ''https://x/functions/v1/scan-heartbeat'')');",
    });
    await pg.exec(migration("20261008123000"));
    await pg.exec(migration("20261008123000"));
    const [job] = await rows<{ schedule: string; command: string }>(pg, "SELECT schedule, command FROM cron.job WHERE jobname = 'scan-heartbeat-sentinel'");
    expect(job.schedule).toBe("*/10 * * * *");
    expect(job.command).toMatch(/'x-email-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'email_cron_key'/);
    const [fn] = await rows<{ def: string }>(pg, "SELECT pg_get_functiondef('public.notify_owner_on_signup()'::regprocedure) AS def");
    expect(fn.def).toMatch(/'x-email-cron', v_key/);
    await pg.exec(`INSERT INTO public.heartbeat_results (function_name, status, response_time_ms, test_passed, error_message, created_at) VALUES
      ('free-keyword-scan', 'healthy', 900, true, 'secret detail', now() - interval '20 minutes'),
      ('free-keyword-scan', 'down', 75000, false, 'secret detail', now() - interval '10 minutes'),
      ('other-function', 'down', 1, false, null, now())`);
    const hb = await rows<Record<string, unknown>>(pg, "SELECT * FROM public.get_recent_heartbeats(10)");
    expect(hb.map((r) => r.status)).toEqual(["down", "healthy"]);
    expect(Object.keys(hb[0]).sort(), "the reader hands out error text").toEqual(["created_at", "function_name", "id", "response_time_ms", "status", "test_passed"]);
    const [acl] = await rows<{ anon: boolean; svc: boolean }>(pg, "SELECT has_function_privilege('anon', 'public.get_recent_heartbeats(integer)', 'EXECUTE') AS anon, has_function_privilege('service_role', 'public.get_recent_heartbeats(integer)', 'EXECUTE') AS svc");
    expect(acl).toEqual({ anon: false, svc: true });
  }, 60_000);

  it("the history reader (20261008127000) gives the panels their window, newest first, closed to the client roles", async () => {
    const { bootEmailOpsDb, migration, rows } = await import("./helpers/email-ops-db");
    const pg = await bootEmailOpsDb({ apply: ["20261008127000"] });
    await pg.exec(`INSERT INTO public.heartbeat_results (function_name, status, response_time_ms, test_passed, error_message, checks_passed, metadata, created_at) VALUES
      ('free-keyword-scan', 'healthy', 900, true, NULL, '{"e2e_scan":{"passed":true,"time_ms":900}}', '{"ai_model":"m"}', now() - interval '20 minutes'),
      ('scheduled-health-probe', 'healthy', 50, true, NULL, '{"database":true}', '{"probes":[{"service":"database","latency_ms":40}]}', now() - interval '10 minutes'),
      ('free-keyword-scan', 'down', 75000, false, repeat('x', 400), '{}', NULL, now() - interval '5 minutes'),
      ('free-keyword-scan', 'healthy', 800, true, NULL, '{}', NULL, now() - interval '30 hours')`);
    const day = await rows<Record<string, unknown>>(pg, "SELECT * FROM public.get_heartbeat_history(24, NULL, 5000)");
    expect(day.map((r) => r.function_name), "the 30-hour-old row is outside the window").toEqual(["free-keyword-scan", "scheduled-health-probe", "free-keyword-scan"]);
    expect(String(day[0].error_message)).toHaveLength(300);
    expect(day[1].probes).toEqual([{ service: "database", latency_ms: 40 }]);
    const scan = await rows<Record<string, unknown>>(pg, "SELECT status FROM public.get_heartbeat_history(168, 'free-keyword-scan', 10)");
    expect(scan.map((r) => r.status)).toEqual(["down", "healthy", "healthy"]);
    const [acl] = await rows<{ anon: boolean; auth: boolean; svc: boolean }>(pg, `SELECT
      has_function_privilege('anon', 'public.get_heartbeat_history(integer,text,integer)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.get_heartbeat_history(integer,text,integer)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.get_heartbeat_history(integer,text,integer)', 'EXECUTE') AS svc`);
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
    await pg.exec(migration("20261008127000"));
  }, 60_000);
});
