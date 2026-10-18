// @vitest-environment node
/**
 * EVERY FREE SCAN COULD LOSE ITS AI WHILE THE HEARTBEAT READ GREEN (S11-028).
 *
 * Tool calling can break while plain completion works (a 400 on the schema,
 * tool_calls that do not parse, the 85 s clock). free-keyword-scan then
 * serves its rule-based report with partialResults set, and it still carries
 * a numeric score and reportMeta, which is all the heartbeat's e2e_scan
 * checked. Its Check 2 is a completion with no tools, a 429 counted as a
 * pass, the fallback logged scan_metrics outputValid true, and nothing read
 * detection_telemetry.used_fallback. So every visitor could get "Partial
 * results" indefinitely with every monitor green.
 *
 * The shipped scan-heartbeat runs here with its network faked: a partial or
 * thin e2e report fails e2e_scan and degrades the run, a 429 is not a pass,
 * and an hour in which half the visitor scans fell back fails
 * scan_fallback_rate. free-keyword-scan logs a partial report as not valid.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, eqs, type Query } from "./helpers/proxy-db";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};
let handler: EdgeHandler;
let pending: Promise<unknown>[] = [];
/** What free-keyword-scan answers the heartbeat's e2e scan. */
let scanAnswer: { status: number; body: unknown } = { status: 200, body: {} };
/** detection_telemetry counts for the last hour. */
let telemetry: { total: number | null; fallbacks: number | null; error?: string } = { total: 0, fallbacks: 0 };

const GOOD = { atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 };

describe("scan-heartbeat judges whether the AI analysis reached the report", () => {
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    g.fetch = async (url: string, init?: { body?: string }) => {
      const u = String(url);
      let body: Record<string, unknown> | null = null;
      try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
      if (u.includes("api.resend.com")) return ok({ id: "em" });
      if (u.includes("api.stripe.com")) return ok({ object: "balance" });
      if (u.includes("ai.gateway.lovable.dev")) return ok({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
      if (u.includes("/functions/v1/free-keyword-scan")) return ok(scanAnswer.body, scanAnswer.status);
      if (u.includes("/functions/v1/job-board")) return ok(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
      return ok({});
    };
    handler = await loadEdgeHandler("scan-heartbeat", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbDb; }",
    });
  });
  beforeEach(() => {
    scanAnswer = { status: 200, body: GOOD };
    telemetry = { total: 40, fallbacks: 1 };
    const db = new ProxyDb();
    db.answer = (q: Query) => {
      if (q.rpc === "check_rate_limit") return { data: true, error: null };
      if (q.rpc === "cron_http_answers") return { data: { available: true, responses: 10, refused: 0, error_window_responses: 30, server_errors: 0, timed_out: 0, not_found: 0 }, error: null };
      if (q.table === "job_board_meta") return { data: { updated_at: new Date().toISOString() }, error: null };
      if (q.table === "detection_telemetry") {
        if (telemetry.error) return { data: null, error: { message: telemetry.error }, count: null };
        return { data: null, error: null, count: eqs(q, "used_fallback", true) ? telemetry.fallbacks : telemetry.total };
      }
      return undefined;
    };
    (globalThis as Record<string, unknown>).__hbDb = db;
  });
  afterEach(async () => { await Promise.allSettled(pending); pending = []; });
  const run = async () => (await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }))).json();
  type Out = { status: string; checks: Array<{ name: string; passed: boolean; error?: string }>; skipped: Array<{ name: string; reason: string }> };
  const check = (j: Out, name: string) => j.checks.find((c) => c.name === name);

  it("positive control: a full AI report passes e2e_scan, and a normal hour passes the fallback rate", async () => {
    const j: Out = await run();
    expect(check(j, "e2e_scan")?.passed, JSON.stringify(check(j, "e2e_scan"))).toBe(true);
    expect(check(j, "scan_fallback_rate")?.passed).toBe(true);
  });

  it("a rule-based fallback report fails e2e_scan, names the reason, and degrades the run", async () => {
    scanAnswer = { status: 200, body: { ...GOOD, partialResults: true, partialReason: "rule_based", reportCompleteness: 64 } };
    const j: Out = await run();
    const c = check(j, "e2e_scan");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/partial report \(rule_based\)/);
    expect(j.status).not.toBe("healthy");
  });

  it("a thin report (completeness under 70) fails e2e_scan", async () => {
    scanAnswer = { status: 200, body: { ...GOOD, reportCompleteness: 55 } };
    const c = check(await run(), "e2e_scan");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/completeness 55%/);
  });

  it("a 429 is not a pass", async () => {
    scanAnswer = { status: 429, body: { error: "rate limited" } };
    const j: Out = await run();
    expect(check(j, "e2e_scan")?.passed).toBe(false);
    expect(j.status).not.toBe("healthy");
  });

  it("an hour where half the visitor scans fell back fails scan_fallback_rate", async () => {
    telemetry = { total: 12, fallbacks: 6 };
    const j: Out = await run();
    const c = check(j, "scan_fallback_rate");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/6 of 12 visitor scans/);
    expect(j.status).not.toBe("healthy");
  });

  it("too few scans, or an unreadable table, is a skip with a reason, never a pass", async () => {
    telemetry = { total: 2, fallbacks: 2 };
    let j: Out = await run();
    expect(check(j, "scan_fallback_rate")).toBeUndefined();
    expect(j.skipped.find((s) => s.name === "scan_fallback_rate")?.reason).toMatch(/2 visitor scan\(s\) in the last hour: too few to judge/);
    telemetry = { total: null, fallbacks: null, error: "permission denied" };
    j = await run();
    expect(check(j, "scan_fallback_rate")).toBeUndefined();
    expect(j.skipped.find((s) => s.name === "scan_fallback_rate")?.reason).toMatch(/unreadable: permission denied/);
  });
});

describe("free-keyword-scan logs a partial report as not a valid AI output", () => {
  it("the completion metric's outputValid follows partialReport and carries the reason", () => {
    const src = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8"));
    const at = src.indexOf("logScanMetric(metricCtx, 'completed'");
    expect(at).toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf("});", at));
    expect(call).toMatch(/outputValid: !partialReport,/);
    expect(call).toMatch(/usedFallback: usedRuleBasedFallback/);
    expect(call).not.toMatch(/outputValid: true/);
  });
});
