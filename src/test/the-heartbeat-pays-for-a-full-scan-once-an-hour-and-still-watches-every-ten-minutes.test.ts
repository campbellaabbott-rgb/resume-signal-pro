// @vitest-environment node
/**
 * THE HEARTBEAT PAYS FOR A FULL SCAN ONCE AN HOUR AND STILL WATCHES EVERY TEN
 * MINUTES (cost audit 2026-11-08, Do first #1; owner decision 2026-11-08;
 * scan-heartbeat 2026-11-09.1, free-keyword-scan 2026-11-09.2).
 *
 * WHAT WAS WRONG. Every ten-minute run made a full uncached scan (two model
 * calls, each carrying the whole scan prompt), a model probe, four filtered
 * board reads, the vendor canary and two whole-table storage reads: 288 heavy
 * model calls a day, about 98% of the free scanner's, and 864 job-board calls,
 * to watch about two visitor scans a day. And the probe asked a thinking model
 * for text under a 100-token cap, so a reply the thinking used up came back
 * empty and read as 'degraded'.
 *
 * WHAT HOLDS NOW, by running the shipped handler under the cron's own key with
 * the clock and the network faked:
 *   - the cron's run at minute 0-9 of a UTC hour runs every check, the full
 *     scan among them;
 *   - its other five runs skip the full scan, the four filter probes,
 *     vendor-health, get_storage_footprint and get_stale_board_count as
 *     'runs hourly', ask the scanner for its rule-based report with no model
 *     call (scan_path), and still ping healthchecks.io, read job-board status
 *     and probe the gateway;
 *   - a run the owner or the service role starts by hand is always full;
 *   - an off-hour run never calls the scanner without the secret that makes
 *     it skip its model, and a scanner that did not say it skipped fails;
 *   - the probe passes on a reply that holds a choice, empty or not, and
 *     prints token counts only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";
import { FULL_RUN_MINUTES, HOURLY, isFullRun, noModelScanCheck } from "../../supabase/functions/scan-heartbeat/watch";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ADMIN = "admin_key_for_the_harness_0123456789";
const CRON_KEY = "c".repeat(64);
const PING = "https://hc-ping.example/heartbeat-check";
const env: Record<string, string | undefined> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: ADMIN, HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com", HC_HEARTBEAT_PING_URL: PING,
};

type Call = { url: string; body: Record<string, unknown> | null; headers: Record<string, string> };
const fetched: Call[] = [];
let pending: Promise<unknown>[] = [];
let handler: EdgeHandler;
let db: ProxyDb;
/** What the AI gateway answers the probe. */
let gatewayReply: unknown;
/** What free-keyword-scan answers, given the body the heartbeat sent. */
let scanner: (body: Record<string, unknown> | null) => { status: number; body: unknown };

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const FULL_REPORT = { atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 };
const RULES_REPORT = { atsScoreEstimate: 64, reportMeta: { reportId: "R2" }, partialResults: true, partialReason: "rule_based", reportCompleteness: 64, heartbeatNoModel: true };
/** The scanner as shipped: it honours the flag only with the heartbeat's secret. */
const honest = (body: Record<string, unknown> | null) =>
  body?.heartbeatNoModel === true ? { status: 200, body: RULES_REPORT } : { status: 200, body: FULL_REPORT };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    fetched.push({ url: u, body, headers: { ...(init?.headers ?? {}) } });
    if (u.startsWith(PING)) return new Response("OK", { status: 200 });
    if (u.includes("api.resend.com")) return okJson({ id: "em" });
    if (u.includes("api.stripe.com")) return okJson({ object: "balance" });
    if (u.includes("ai.gateway.lovable.dev")) return okJson(gatewayReply);
    if (u.endsWith("/functions/v1/free-keyword-scan")) { const a = scanner(body); return okJson(a.body, a.status); }
    if (u.endsWith("/functions/v1/job-board")) {
      if (body?.action === "vendor-health") return okJson({ drifted: [], unreachable: [] });
      return okJson({ jobs: [], total: 0 });
    }
    return okJson({});
  };
  handler = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbTierDb; }",
  });
});

beforeEach(() => {
  env.HEARTBEAT_SECRET = "hb";
  gatewayReply = { choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 41, completion_tokens_details: { reasoning_tokens: 40 } } };
  scanner = honest;
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "email_cron_key_matches") return { data: (q.calls[0][1][0] as { p_key: string }).p_key === CRON_KEY, error: null };
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.rpc === "get_storage_footprint") return { data: [{ db_bytes: 1024 ** 3, postings_bytes: 1, closures_bytes: 1 }], error: null };
    if (q.rpc === "get_stale_board_count") return { data: 12, error: null };
    if (q.table === "job_board_meta") return { data: { updated_at: new Date().toISOString() }, error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbTierDb = db;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.allSettled(pending);
  pending = [];
  fetched.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Out = {
  status: string; fullRun: boolean; deadMan: string; errorMessage: string | null;
  checks: Array<{ name: string; passed: boolean; error?: string }>;
  skipped: Array<{ name: string; reason: string }>;
};

/** A run at `at` (UTC), by the cron unless other headers are given. */
async function runAt(at: string, headers: Record<string, string> = { "x-email-cron": CRON_KEY }): Promise<Out> {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
  }));
  expect(res.status).toBe(200);
  const j = await res.json() as Out;
  await Promise.allSettled(pending);
  return j;
}

const OFF_HOUR = "2026-11-09T10:20:03Z";
const ON_THE_HOUR = "2026-11-09T10:00:04Z";
const HOURLY_CHECKS = ["e2e_scan", "job_board_filter_contract", "job_board_vendors", "job_board_storage", "job_board_verification_ceiling"];

const check = (j: Out, name: string) => j.checks.find((c) => c.name === name);
const skip = (j: Out, name: string) => j.skipped.find((s) => s.name === name);
const scans = () => fetched.filter((f) => f.url.endsWith("/functions/v1/free-keyword-scan"));
const listProbes = () => fetched.filter((f) => f.url.endsWith("/functions/v1/job-board") && f.body?.action === "list");
const boardCalls = (action: string) => fetched.filter((f) => f.url.endsWith("/functions/v1/job-board") && f.body?.action === action);
const rpcs = (name: string) => db.queries.filter((q) => q.rpc === name);

describe("which runs are full", () => {
  it("the cron's run at minute 0-9 of a UTC hour is full, its other runs are not, and a run started by hand always is", () => {
    expect(FULL_RUN_MINUTES).toBe(10);
    for (const m of [0, 4, 9]) expect(isFullRun(new Date(`2026-11-09T10:0${m}:30Z`), true), `minute ${m}`).toBe(true);
    for (const m of [10, 20, 35, 59]) expect(isFullRun(new Date(`2026-11-09T10:${m}:00Z`), true), `minute ${m}`).toBe(false);
    for (const m of [0, 20, 59]) expect(isFullRun(new Date(`2026-11-09T10:${String(m).padStart(2, "0")}:00Z`), false)).toBe(true);
  });
});

describe("an off-hour run of the cron", () => {
  it("skips the full scan, the four filter probes, vendor-health and the two storage reads as 'runs hourly'", async () => {
    const j = await runAt(OFF_HOUR);
    expect(j.fullRun).toBe(false);
    for (const name of HOURLY_CHECKS) {
      expect(skip(j, name)?.reason, name).toBe(HOURLY);
      expect(check(j, name), `${name} ran off the hour`).toBeUndefined();
    }
    expect(listProbes(), "the filter probes ran off the hour").toEqual([]);
    expect(boardCalls("vendor-health")).toEqual([]);
    expect(rpcs("get_storage_footprint")).toEqual([]);
    expect(rpcs("get_stale_board_count")).toEqual([]);
  });

  it("makes no scan model call: it asks the scanner for the rule-based report, with the heartbeat's secret, and judges it as scan_path", async () => {
    const j = await runAt(OFF_HOUR);
    expect(scans()).toHaveLength(1);
    expect(scans()[0].body).toMatchObject({ synthetic: true, heartbeatNoModel: true });
    expect(scans()[0].headers["x-heartbeat-secret"]).toBe("hb");
    expect(check(j, "scan_path")).toMatchObject({ passed: true });
  });

  it("still pings healthchecks.io, reads job-board status, probes the gateway and writes its row", async () => {
    const j = await runAt(OFF_HOUR);
    expect(j.deadMan).toBe("sent");
    expect(fetched.filter((f) => f.url.startsWith(PING))).toHaveLength(1);
    expect(boardCalls("status")).toHaveLength(1);
    expect(fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev"))).toHaveLength(1);
    expect(check(j, "ai_gateway")?.passed).toBe(true);
    const rows = db.rpcArgs("log_heartbeat_result");
    expect(rows).toHaveLength(1);
    expect(rows[0].p_metadata).toMatchObject({ full_run: false });
  });

  it("fails scan_path when the scanner does not say it skipped its model (it may have run a full scan)", async () => {
    scanner = () => ({ status: 200, body: FULL_REPORT });
    const j = await runAt(OFF_HOUR);
    const c = check(j, "scan_path");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/did not say it skipped its model/);
    expect(noModelScanCheck(200, FULL_REPORT).severity, "a scanner that may have spent a model call is slow money, not an outage").toBe("degraded");
  });

  it("fails scan_path, down, when the scanner answers an error", async () => {
    scanner = () => ({ status: 500, body: { error: "boom" } });
    const j = await runAt(OFF_HOUR);
    expect(check(j, "scan_path")).toMatchObject({ passed: false });
    expect(check(j, "scan_path")?.error).toMatch(/HTTP 500/);
    expect(j.status).toBe("down");
  });

  it("without the heartbeat's secret it does not call the scanner at all, and says why", async () => {
    env.HEARTBEAT_SECRET = undefined;
    const j = await runAt(OFF_HOUR);
    expect(scans(), "an off-hour run without the secret would be a full model scan").toEqual([]);
    expect(skip(j, "scan_path")?.reason).toMatch(/HEARTBEAT_SECRET is not set/);
    expect(skip(j, "e2e_scan")?.reason).toBe(HOURLY);
  });
});

describe("the hourly run runs everything", () => {
  it("the cron's run at minute 0-9: the full scan (no flag), the four filter probes, vendor-health and both storage reads", async () => {
    const j = await runAt(ON_THE_HOUR);
    expect(j.fullRun).toBe(true);
    expect(scans()).toHaveLength(1);
    expect(scans()[0].body).not.toHaveProperty("heartbeatNoModel");
    expect(check(j, "e2e_scan")).toMatchObject({ passed: true });
    expect(check(j, "scan_path")).toBeUndefined();
    expect(listProbes()).toHaveLength(4);
    expect(boardCalls("vendor-health")).toHaveLength(1);
    expect(boardCalls("status")).toHaveLength(1);
    expect(rpcs("get_storage_footprint")).toHaveLength(1);
    expect(rpcs("get_stale_board_count")).toHaveLength(1);
    expect(check(j, "job_board_storage")).toBeDefined();
    expect(check(j, "job_board_verification_ceiling")).toBeDefined();
    expect(check(j, "job_board_vendors")).toBeDefined();
    expect(j.skipped.filter((s) => s.reason === HOURLY)).toEqual([]);
    expect(db.rpcArgs("log_heartbeat_result")[0].p_metadata).toMatchObject({ full_run: true });
  });

  it("a run the owner or the service role starts by hand is full at any minute", async () => {
    for (const headers of [{ "x-admin-key": ADMIN }, { authorization: `Bearer ${SERVICE}` }]) {
      fetched.length = 0;
      const j = await runAt(OFF_HOUR, headers);
      expect(j.fullRun, JSON.stringify(Object.keys(headers))).toBe(true);
      expect(check(j, "e2e_scan")).toBeDefined();
      expect(scans()[0].body).not.toHaveProperty("heartbeatNoModel");
      expect(listProbes()).toHaveLength(4);
    }
  });
});

describe("the AI probe cannot raise a false 'degraded'", () => {
  it("a reply whose thinking used the whole cap (no text, finish_reason length) is an answer: the probe passes", async () => {
    gatewayReply = { choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 9, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } } };
    const j = await runAt(OFF_HOUR);
    expect(check(j, "ai_gateway")).toMatchObject({ passed: true });
    expect(j.errorMessage ?? "", "the run still named the gateway").not.toMatch(/AI Gateway/);
  });

  it("a 200 that holds no choice at all still fails it", async () => {
    gatewayReply = { error: { message: "upstream" } };
    const j = await runAt(OFF_HOUR);
    expect(check(j, "ai_gateway")).toMatchObject({ passed: false, error: "the AI gateway answered 200 with no choice in the reply" });
  });

  it("the probe asks a one-line question and prints its token counts, never its text", async () => {
    gatewayReply = { choices: [{ message: { content: "OK, here is a sentence the log must not carry" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 41, completion_tokens_details: { reasoning_tokens: 40 } } };
    await runAt(OFF_HOUR);
    const probe = fetched.find((f) => f.url.includes("ai.gateway.lovable.dev"))!;
    expect(JSON.stringify(probe.body)).not.toMatch(/John Smith|Software Engineer/);
    const lines = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[AI-USAGE]"));
    expect(lines).toEqual(["[AI-USAGE] context=scan-heartbeat model=google/gemini-2.5-flash prompt_tokens=9 completion_tokens=41 cached_tokens=- reasoning_tokens=40 finish_reason=stop"]);
  });
});
