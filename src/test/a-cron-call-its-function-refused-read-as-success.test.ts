// @vitest-environment node
/**
 * A CRON CALL ITS FUNCTION REFUSED READ AS SUCCESS (S8-051).
 *
 * WHAT WAS WRONG. net.http_post only queues a request, so a function cron's
 * run is 'succeeded' in 0.0 s whatever the function answered, and nothing
 * read the answers pg_net keeps. A cron re-keyed wrong, or a gate flipped,
 * 401s on every run while every surface reads healthy.
 *
 * WHAT HOLDS NOW: in pglite, cron_http_refusals counts the answers of the
 * window (refusals, 5xx, timeouts, the newest refusal's status and body) and
 * says unavailable without pg_net; the shipped scan-heartbeat fails its
 * cron_http_refusals check (and degrades) on a refusal, passes on none, and
 * records a skip with a reason when the reader is missing.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009143000_a_cron_call_its_function_refused_is_counted_not_read_as_success.sql"), "utf8");
const ROLES = "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;";

describe("20261009143000 in pglite", () => {
  it("without pg_net it answers unavailable, and it is service-role only", async () => {
    const db = new PGlite();
    await db.exec(ROLES);
    await db.exec(SQL);
    await db.exec(SQL);
    const { rows } = await db.query<{ available: boolean; responses: number }>("SELECT available, responses FROM public.cron_http_refusals(60)");
    expect(rows).toEqual([{ available: false, responses: 0 }]);
    const acl = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(`
      SELECT has_function_privilege('anon', 'public.cron_http_refusals(integer)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.cron_http_refusals(integer)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.cron_http_refusals(integer)', 'EXECUTE') AS svc`);
    expect(acl.rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });

  it("counts the window's refusals, 5xx and timeouts, and names the newest refusal", async () => {
    const db = new PGlite();
    await db.exec(ROLES);
    await db.exec(`
      CREATE SCHEMA net;
      CREATE TABLE net._http_response (id bigserial, status_code integer, content text, timed_out boolean, error_msg text, created timestamptz NOT NULL DEFAULT now());
      INSERT INTO net._http_response (status_code, content, timed_out, created) VALUES
        (200, '{"ok":true}', false, now() - interval '5 minutes'),
        (401, '{"error":"The batch send is for the scheduler only."}', false, now() - interval '20 minutes'),
        (403, '{"error":"newest refusal"}', false, now() - interval '2 minutes'),
        (503, 'boom', false, now() - interval '10 minutes'),
        (NULL, NULL, true, now() - interval '30 minutes'),
        (401, 'too old', false, now() - interval '3 hours');
    `);
    await db.exec(SQL);
    const { rows } = await db.query<Record<string, unknown>>("SELECT available, responses, refused, server_errors, timed_out, last_refused_status, last_refused_sample FROM public.cron_http_refusals(60)");
    expect(rows[0]).toEqual({ available: true, responses: 5, refused: 2, server_errors: 1, timed_out: 1, last_refused_status: 403, last_refused_sample: '{"error":"newest refusal"}' });
  });
});

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};
let handler: EdgeHandler;
let refusals: Answer;
let pending: Promise<unknown>[] = [];

describe("scan-heartbeat reads the cron answers", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    g.fetch = async (url: string, init?: { body?: string }) => {
      const u = String(url);
      let body: Record<string, unknown> | null = null;
      try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
      if (u.includes("api.resend.com")) return ok({ id: "em" });
      if (u.includes("api.stripe.com")) return ok({ object: "balance" });
      if (u.includes("ai.gateway.lovable.dev")) return ok({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
      if (u.includes("/functions/v1/free-keyword-scan")) return ok({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" } });
      if (u.includes("/functions/v1/job-board")) return ok(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
      return ok({});
    };
    handler = await loadEdgeHandler("scan-heartbeat", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__cronDb; }",
    });
  });
  beforeEach(() => {
    const db = new ProxyDb();
    db.answer = (q: Query): Answer | undefined => {
      if (q.rpc === "check_rate_limit") return { data: true, error: null };
      if (q.rpc === "cron_http_refusals") return refusals;
      if (q.table === "job_board_meta") return { data: { updated_at: new Date().toISOString() }, error: null };
      return undefined;
    };
    (globalThis as Record<string, unknown>).__cronDb = db;
  });
  afterEach(async () => { await Promise.allSettled(pending); pending = []; });
  const run = async () => (await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }))).json();
  const check = (j: { checks: Array<{ name: string; passed: boolean; error?: string }> }) => j.checks.find((c) => c.name === "cron_http_refusals");

  it("a refused cron call fails the check, names the refusal, and degrades the status", async () => {
    refusals = { data: { available: true, responses: 40, refused: 3, server_errors: 1, timed_out: 0, last_refused_status: 401, last_refused_sample: '{"error":"The batch send is for the scheduler only."}' }, error: null };
    const j = await run();
    const c = check(j);
    expect(c, "nothing read the answers the crons received").toBeTruthy();
    expect(c!.passed).toBe(false);
    expect(c!.error).toMatch(/3 of 40 cron calls/);
    expect(c!.error).toMatch(/scheduler only/);
    expect(j.status).not.toBe("healthy");
  });

  it("no refusal passes", async () => {
    refusals = { data: { available: true, responses: 40, refused: 0, server_errors: 2, timed_out: 1 }, error: null };
    expect(check(await run())?.passed).toBe(true);
  });

  it("a missing reader is a skip with a reason, never a pass", async () => {
    refusals = { data: null, error: { message: "function public.cron_http_refusals(integer) does not exist" } };
    const j = await run();
    expect(check(j)).toBeUndefined();
    expect(j.skipped.find((s: { name: string }) => s.name === "cron_http_refusals")?.reason).toMatch(/reader unavailable/);
  });
});
