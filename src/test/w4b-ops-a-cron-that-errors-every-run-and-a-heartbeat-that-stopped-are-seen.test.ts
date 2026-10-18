// @vitest-environment node
/**
 * A CRON THAT ERRORS EVERY RUN, AND A HEARTBEAT THAT STOPPED, ARE SEEN
 * (S12 sweep, ops: S12-157, S12-159, S12-160, S12-065).
 *
 * WHAT WAS WRONG.
 *   S12-157  scan-heartbeat's cron check failed only on a 401/403: a cron
 *            whose function answered 500 on every run read green, and 404s
 *            were not counted.
 *   S12-159  the heartbeat aborted its end-to-end scan at 75 s while the
 *            scanner's own model clock runs to 85 s before its rule-based
 *            report: a slow gateway read 'down'.
 *   S12-160  get_scan_health_status counted the heartbeat's own scans (six an
 *            hour) with the visitors': degraded at 100% visitor success, and
 *            "no successful scan" became critical the hour the probe missed.
 *   S12-065  nothing watched scan-heartbeat: if its cron stops, every alarm it
 *            owns goes quiet, and quiet reads as healthy.
 *
 * WHAT HOLDS NOW: 20261011200000 runs twice in pglite and its readers count
 * what they claim; the shipped scan-heartbeat fails the cron check on
 * repeated 5xx, calls an abort on its own clock degraded, and pings
 * HC_PING_URL; the shipped check-alerts alarms on a heartbeat older than 30
 * minutes. Only the network and the database are faked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";
import {
  CRON_ERROR_ALARM, cronAnswersCheck, E2E_ABORT_MS, isAbort, pingDeadMan, SCANNER_AI_DEADLINE_MS,
} from "../../supabase/functions/scan-heartbeat/watch";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const file = (stamp: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(`${stamp}_`))!), "utf8");
const BASE = file("20251223182331");
const SQL = file("20261011200000");
const ROLES = "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;";

async function boot(withNet: boolean) {
  const db = new PGlite();
  await db.exec(ROLES);
  await db.exec(BASE);
  if (withNet) {
    await db.exec(`CREATE SCHEMA net;
      CREATE TABLE net._http_response (id bigserial, status_code integer, content text, timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());`);
  }
  await db.exec(SQL);
  await db.exec(SQL);
  return db;
}
type Health = { status: string; scans_last_hour: number; success_rate_last_hour: string; issues: string[]; last_successful_scan: string | null };
const health = async (db: PGlite) => (await db.query<Health>("SELECT * FROM public.get_scan_health_status()")).rows[0];

describe("20261011200000 in pglite", () => {
  it("cron_http_answers is service-role only, and answers unavailable without pg_net", async () => {
    const db = await boot(false);
    const { rows } = await db.query<{ available: boolean; server_errors: number }>("SELECT available, server_errors FROM public.cron_http_answers(60, 180)");
    expect(rows).toEqual([{ available: false, server_errors: 0 }]);
    const acl = await db.query<Record<string, boolean>>(`
      SELECT has_function_privilege('anon', 'public.cron_http_answers(integer,integer)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.cron_http_answers(integer,integer)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.cron_http_answers(integer,integer)', 'EXECUTE') AS svc,
             has_function_privilege('anon', 'public.get_scan_health_status()', 'EXECUTE') AS health_anon`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, svc: true, health_anon: true });
  });

  it("counts refusals over the first window and 5xx, timeouts and 404s over the second, naming the newest 5xx", async () => {
    const db = await boot(true);
    await db.exec(`INSERT INTO net._http_response (status_code, content, timed_out, created) VALUES
      (200, 'ok', false, now() - interval '5 minutes'),
      (403, '{"error":"refused"}', false, now() - interval '10 minutes'),
      (401, 'old refusal', false, now() - interval '2 hours'),
      (500, '{"error":"sweep threw"}', false, now() - interval '20 minutes'),
      (503, '{"error":"newest error"}', false, now() - interval '3 minutes'),
      (502, 'older error', false, now() - interval '150 minutes'),
      (404, 'Function not found', false, now() - interval '40 minutes'),
      (NULL, NULL, true, now() - interval '30 minutes'),
      (500, 'too old for either window', false, now() - interval '5 hours');`);
    const { rows } = await db.query<Record<string, unknown>>(`SELECT available, responses, refused, last_refused_status, error_window_responses,
      server_errors, timed_out, not_found, last_error_status, last_error_sample FROM public.cron_http_answers(60, 180)`);
    expect(rows[0]).toEqual({
      available: true, responses: 6, refused: 1, last_refused_status: 403, error_window_responses: 8,
      server_errors: 3, timed_out: 1, not_found: 1, last_error_status: 503, last_error_sample: '{"error":"newest error"}',
    });
  });

  it("get_scan_health_status counts visitors' scans only, and an hour with none is not critical", async () => {
    const db = await boot(false);
    await db.exec(`INSERT INTO public.heartbeat_results (function_name, status, test_passed) VALUES ('free-keyword-scan', 'healthy', true);
      INSERT INTO public.scan_metrics (scan_type, status, duration_ms) VALUES
        ('heartbeat', 'completed', 9000), ('heartbeat', 'failed', 9000), ('synthetic', 'failed', 100);`);
    let h = await health(db);
    expect(h.scans_last_hour, "the heartbeat's own scans were counted as visitors'").toBe(0);
    expect(h.status).toBe("healthy");
    expect(h.issues).toEqual([]);
    expect(h.last_successful_scan).toBeNull();

    await db.exec(`INSERT INTO public.scan_metrics (scan_type, status, duration_ms) VALUES ('free', 'completed', 4000), ('free-stream', 'completed', 4000), ('paid', 'completed', 4000);`);
    h = await health(db);
    expect(h.scans_last_hour).toBe(3);
    expect(Number(h.success_rate_last_hour)).toBe(100);
    expect(h.status).toBe("healthy");
  });

  it("a visitor scan that failed, with no other, is critical and named", async () => {
    const db = await boot(false);
    await db.exec(`INSERT INTO public.heartbeat_results (function_name, status, test_passed) VALUES ('free-keyword-scan', 'healthy', true);
      INSERT INTO public.scan_metrics (scan_type, status, duration_ms) VALUES ('free', 'failed', 4000), ('heartbeat', 'completed', 4000);`);
    const h = await health(db);
    expect(h.status).toBe("critical");
    expect(h.issues).toContain("Every visitor scan in the last hour failed (1)");
  });

  it("names a heartbeat that has not run for 30 minutes, or ever: the dead-man", async () => {
    const db = await boot(false);
    let h = await health(db);
    expect(h.status).toBe("critical");
    expect(h.issues).toContain("Heartbeat has never run");
    await db.exec(`INSERT INTO public.heartbeat_results (function_name, status, test_passed, created_at) VALUES ('free-keyword-scan', 'healthy', true, now() - interval '45 minutes');`);
    h = await health(db);
    expect(h.status).toBe("critical");
    expect(h.issues).toContain("Heartbeat has not run for 45 min");
    await db.exec(`INSERT INTO public.heartbeat_results (function_name, status, test_passed, created_at) VALUES ('free-keyword-scan', 'healthy', true, now() - interval '9 minutes');`);
    h = await health(db);
    expect(h.status).toBe("healthy");
  });
});

describe("the cron answers rule (pure)", () => {
  const base = { available: true, responses: 120, refused: 0, error_window_responses: 360, server_errors: 0, timed_out: 40, not_found: 2 };
  it("passes a quiet window, counting the 404s and the timeouts it does not judge", () => {
    const v = cronAnswersCheck(base)!;
    expect(v.passed).toBe(true);
    expect(v.reason).toMatch(/5xx 0, 404 2, timeouts 40/);
  });
  it(`fails at ${CRON_ERROR_ALARM} server errors, naming the newest; one fewer passes`, () => {
    expect(cronAnswersCheck({ ...base, server_errors: CRON_ERROR_ALARM - 1 })!.passed).toBe(true);
    const v = cronAnswersCheck({ ...base, server_errors: CRON_ERROR_ALARM, last_error_status: 500, last_error_sample: '{"error":"retry sweep threw"}' })!;
    expect(v.passed).toBe(false);
    expect(v.error).toMatch(/3 cron calls answered a server error in the last 3 hours/);
    expect(v.error).toMatch(/newest HTTP 500: \{"error":"retry sweep threw"\}/);
  });
  it("a refusal still fails alone, and nothing to judge is no verdict", () => {
    expect(cronAnswersCheck({ ...base, refused: 1, last_refused_status: 401 })!.error).toMatch(/1 of 120 cron calls in the last hour were refused \(latest HTTP 401/);
    expect(cronAnswersCheck({ available: false })).toBeNull();
    expect(cronAnswersCheck(null)).toBeNull();
  });
});

describe("the end-to-end clock and the dead-man ping (pure)", () => {
  it("the heartbeat waits past the scanner's own model clock, read from the scanner's source", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/index.ts"), "utf8");
    const m = /const AI_DEADLINE_MS = ([\d_]+);/.exec(src);
    expect(m, "free-keyword-scan no longer declares AI_DEADLINE_MS").toBeTruthy();
    const scanner = Number(m![1].replace(/_/g, ""));
    expect(SCANNER_AI_DEADLINE_MS).toBe(scanner);
    expect(E2E_ABORT_MS).toBeGreaterThanOrEqual(scanner + 10_000);
    const hb = readFileSync(resolve(ROOT, "supabase/functions/scan-heartbeat/index.ts"), "utf8");
    expect(hb).toMatch(/setTimeout\(\(\) => controller\.abort\(\), E2E_ABORT_MS\)/);
  });

  it("an abort is recognised whatever the runtime calls it", () => {
    expect(isAbort(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
    expect(isAbort(new Error("signal is aborted without reason"))).toBe(true);
    expect(isAbort(new TypeError("error sending request: connection refused"))).toBe(false);
  });

  it("pings the check on a finished run, /fail on a down one, and nothing when unset or not https", async () => {
    const seen: string[] = [];
    const f = async (u: string) => { seen.push(u); return new Response("OK", { status: 200 }); };
    expect(await pingDeadMan("https://hc-ping.com/abc-123/", "degraded", f)).toBe("sent");
    expect(await pingDeadMan("https://hc-ping.com/abc-123", "down", f)).toBe("sent");
    expect(seen).toEqual(["https://hc-ping.com/abc-123", "https://hc-ping.com/abc-123/fail"]);
    expect(await pingDeadMan(undefined, "healthy", f)).toBe("unset");
    expect(await pingDeadMan("http://hc-ping.com/abc", "healthy", f)).toBe("unset");
    expect(await pingDeadMan("https://hc-ping.com/abc", "healthy", async () => { throw new Error("offline"); })).toBe("failed");
    expect(seen).toHaveLength(2);
  });
});

// ── the shipped scan-heartbeat ──────────────────────────────────────────────
const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const hbEnv: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};
let heartbeat: EdgeHandler;
let answers: Answer;
let scanFails: null | (() => never) = null;
let pings: string[] = [];
let pending: Promise<unknown>[] = [];

describe("the shipped scan-heartbeat", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => hbEnv[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    g.fetch = async (url: string, init?: { body?: string }) => {
      const u = String(url);
      let body: Record<string, unknown> | null = null;
      try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
      if (u.startsWith("https://hc-ping.com/")) { pings.push(u); return new Response("OK"); }
      if (u.includes("api.resend.com")) return ok({ id: "em" });
      if (u.includes("api.stripe.com")) return ok({ object: "balance" });
      if (u.includes("ai.gateway.lovable.dev")) return ok({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
      if (u.includes("/functions/v1/free-keyword-scan")) {
        if (scanFails) scanFails();
        return ok({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 });
      }
      if (u.includes("/functions/v1/job-board")) return ok(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
      return ok({});
    };
    heartbeat = await loadEdgeHandler("scan-heartbeat", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__w4bHbDb; }",
    });
  });
  beforeEach(() => {
    scanFails = null;
    pings = [];
    delete hbEnv.HC_PING_URL;
    answers = { data: { available: true, responses: 40, refused: 0, error_window_responses: 120, server_errors: 0, timed_out: 0, not_found: 0 }, error: null };
    const db = new ProxyDb();
    db.answer = (q: Query): Answer | undefined => {
      if (q.rpc === "check_rate_limit") return { data: true, error: null };
      if (q.rpc === "cron_http_answers") return answers;
      if (q.table === "job_board_meta") return { data: { updated_at: new Date().toISOString() }, error: null };
      return undefined;
    };
    (globalThis as Record<string, unknown>).__w4bHbDb = db;
  });
  afterEach(async () => { await Promise.allSettled(pending); pending = []; });
  type Out = { status: string; deadMan?: string; checks: Array<{ name: string; passed: boolean; error?: string }>; skipped: Array<{ name: string; reason: string }> };
  const run = async (): Promise<Out> => (await heartbeat(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }))).json();
  const check = (j: Out, name: string) => j.checks.find((c) => c.name === name);

  it("reads cron_http_answers over the two windows, and repeated 5xx fail the check and degrade the run", async () => {
    answers = { data: { available: true, responses: 40, refused: 0, error_window_responses: 120, server_errors: 4, timed_out: 3, not_found: 1, last_error_status: 500, last_error_sample: '{"error":"retry-failed-deliveries threw"}' }, error: null };
    const db = (globalThis as Record<string, unknown>).__w4bHbDb as ProxyDb;
    const j = await run();
    expect(db.rpcArgs("cron_http_answers")).toEqual([{ p_minutes: 60, p_error_minutes: 180 }]);
    const c = check(j, "cron_http_answers");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/4 cron calls answered a server error/);
    expect(c?.error).toMatch(/retry-failed-deliveries threw/);
    expect(j.status).not.toBe("healthy");
  });

  it("positive control: a window with no refusal and fewer 5xx than the bar passes", async () => {
    answers = { data: { available: true, responses: 40, refused: 0, error_window_responses: 120, server_errors: CRON_ERROR_ALARM - 1, timed_out: 30, not_found: 0 }, error: null };
    expect(check(await run(), "cron_http_answers")?.passed).toBe(true);
  });

  it("an abort on the heartbeat's own clock is degraded, not down, and says the scanner's clock", async () => {
    scanFails = () => { throw new DOMException("The operation was aborted.", "AbortError"); };
    const j = await run();
    const c = check(j, "e2e_scan");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/gave no answer within 100 s \(its own model clock is 85 s/);
    expect(j.status).toBe("degraded");
  });

  it("a scan that could not be reached at all is still down", async () => {
    scanFails = () => { throw new TypeError("error sending request: connection refused"); };
    const j = await run();
    expect(check(j, "e2e_scan")?.error).toMatch(/connection refused/);
    expect(j.status).toBe("down");
  });

  it("pings HC_PING_URL every run, /fail when it found the product down, and says when it is unset", async () => {
    let j = await run();
    expect(j.deadMan).toBe("unset");
    expect(pings).toEqual([]);
    hbEnv.HC_PING_URL = "https://hc-ping.com/0f1e2d3c-test";
    j = await run();
    expect(j.deadMan).toBe("sent");
    expect(pings).toEqual(["https://hc-ping.com/0f1e2d3c-test"]);
    scanFails = () => { throw new TypeError("connection refused"); };
    j = await run();
    expect(j.status).toBe("down");
    expect(pings.at(-1)).toBe("https://hc-ping.com/0f1e2d3c-test/fail");
  });
});

// ── the shipped check-alerts ────────────────────────────────────────────────
const ADMIN = "admin-key-harness-0123456789";
const alertEnv: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com", ADMIN_API_KEY: ADMIN,
};
let alerts: EdgeHandler;
let alertDb: FakeDb;
let mail: Array<{ subject: string; html: string }> = [];

describe("check-alerts watches the heartbeat", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => alertEnv[k] } };
    alerts = await loadEdgeHandler("check-alerts", {
      "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__w4bAlertDb; }",
      "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__w4bAlertMail.push(m); return { data: { id: 'x' }, error: null }; } }; } }",
    });
  });
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => alertEnv[k] } };
    mail = [];
    alertDb = new FakeDb();
    const quiet = (row: Record<string, unknown>) => () => ({ data: [row], error: null });
    alertDb.rpcs.get_delivery_health = quiet({ delivery_rate: 100 });
    alertDb.rpcs.get_ai_quality_stats = quiet({ success_rate: 100 });
    alertDb.rpcs.get_email_health = quiet({ success_rate: 100 });
    alertDb.rpcs.get_webhook_health = quiet({ total_received: 0 });
    alertDb.rpcs.get_parse_failure_stats = quiet({ total_failures: 0 });
    alertDb.rpcs.should_send_alert = () => ({ data: true, error: null });
    alertDb.rpcs.log_alert_sent = () => ({ data: null, error: null });
    g.__w4bAlertDb = alertDb;
    g.__w4bAlertMail = mail;
  });
  const runAlerts = async () => (await alerts(new Request("https://harness.supabase.co/functions/v1/check-alerts", {
    method: "POST", headers: { "x-admin-key": ADMIN, "content-type": "application/json" }, body: "{}",
  }))).json();
  const lastRun = (minutesAgo: number | null) => {
    alertDb.rpcs.get_scan_health_status = () => ({ data: [{ last_heartbeat_time: minutesAgo === null ? null : new Date(Date.now() - minutesAgo * 60_000).toISOString(), last_heartbeat_status: "healthy" }], error: null });
  };

  it("a heartbeat that last ran 45 minutes ago is a critical alert, named in the mail", async () => {
    lastRun(45);
    const r = await runAlerts();
    expect(r.alertsTriggered).toBe(1);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toMatch(/CRITICAL/);
    expect(mail[0].html).toContain("Heartbeat Stopped");
    expect(mail[0].html).toMatch(/>45\.0</);
  });

  it("positive control: a heartbeat that ran nine minutes ago raises nothing", async () => {
    lastRun(9);
    expect(await runAlerts()).toEqual({ success: true, alertsTriggered: 0, unavailable: 0 });
    expect(mail).toEqual([]);
  });

  it("a heartbeat that never ran is an alert too; an unreadable reader is blindness, named", async () => {
    lastRun(null);
    expect((await runAlerts()).alertsTriggered).toBe(1);
    expect(mail[0].html).toContain("Heartbeat Stopped");
    mail.length = 0;
    alertDb.rpcs.get_scan_health_status = () => ({ data: null, error: { message: "permission denied" } });
    const r = await runAlerts();
    expect(r.unavailable).toBe(1);
    expect(mail[0].html).toContain("These checks could not be evaluated: get_scan_health_status.");
  });
});
