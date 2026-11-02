// @vitest-environment node
/**
 * THE HEARTBEAT WRITES ITS ROW AND ALERTS BEFORE THE ISOLATE IS CUT (audit
 * 2026-10-31, S13-069; scan-heartbeat 2026-11-03.1).
 *
 * WHAT WAS WRONG. The isolate is cut at about 150 s. The AI probe had no
 * clock, the checks ran one after another with the end-to-end scan's 100 s
 * last, and the row (log_heartbeat_result) and the alert came only after all
 * of them. During a slow gateway or database incident the run could pass the
 * cut: no row, no alert, in the incident they exist for.
 *
 * WHAT HOLDS NOW (the shipped handler; the database, the gateway, Stripe and
 * Resend faked; the clock faked so a minute passes in a millisecond):
 *   - a gateway that never answers is given up at AI_PROBE_MS: the check
 *     fails as slow, not proven down, and the run is degraded, not down;
 *   - a check the database holds forever is cut at RUN_BUDGET_MS: the run
 *     answers, writes its row and sends its alert, a failed run_budget check
 *     saying what was not evaluated;
 *   - the end-to-end scan starts with the checks, not after them;
 *   - a row the database will not write does not hold the owner's alert.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Query } from "./helpers/proxy-db";
import { AI_PROBE_MS, E2E_ABORT_MS, RUN_BUDGET_MS } from "../../supabase/functions/scan-heartbeat/watch";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", HEARTBEAT_SECRET: "hb", STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};

let heartbeat: EdgeHandler;
let db: ProxyDb;
let pending: Promise<unknown>[];
let calls: string[];
let gatewayHangs: boolean;
let holdQuery: (q: Query) => boolean;

/** A fetch that answers only when its signal aborts: a peer holding the connection. */
const hang = (signal?: AbortSignal | null) => new Promise<Response>((_res, rej) => {
  signal?.addEventListener("abort", () => rej(new DOMException("The operation was aborted.", "AbortError")));
});

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  g.fetch = async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    if (u.includes("api.resend.com")) { calls.push("resend"); return ok({ id: "em" }); }
    if (u.includes("api.stripe.com")) { calls.push("stripe"); return ok({ object: "balance" }); }
    if (u.includes("ai.gateway.lovable.dev")) {
      calls.push("gateway");
      return gatewayHangs ? hang(init?.signal) : ok({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
    }
    if (u.includes("/functions/v1/free-keyword-scan")) {
      calls.push("e2e");
      return ok({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 });
    }
    if (u.includes("/functions/v1/job-board")) return ok(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
    return ok({});
  };
  heartbeat = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbBudgetDb; }",
  });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  pending = [];
  calls = [];
  gatewayHangs = false;
  holdQuery = () => false;
  db = new ProxyDb();
  db.answer = (q) => {
    if (holdQuery(q)) return new Promise(() => {});
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.table === "job_board_meta") return { data: { updated_at: new Date().toISOString() }, error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbBudgetDb = db;
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(E2E_ABORT_MS + RUN_BUDGET_MS);
  vi.useRealTimers();
  await Promise.allSettled(pending);
});

type Out = { status: string; checks: Array<{ name: string; passed: boolean; error?: string }>; skipped: Array<{ name: string; reason: string }> };
const start = () => heartbeat(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
}));
const rows = () => db.rpcArgs("log_heartbeat_result");

describe("the AI probe has a clock of its own", () => {
  it("a gateway that never answers is given up at the probe's clock: slow, not proven down, and the row is written", async () => {
    gatewayHangs = true;
    const run = start();
    await vi.advanceTimersByTimeAsync(AI_PROBE_MS + 50);
    const j = await (await run).json() as Out;
    const c = j.checks.find((x) => x.name === "ai_gateway");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/no answer to a 100-token probe within 30 s: slow, not proven down/);
    expect(j.status).toBe("degraded");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ p_status: "degraded" });
  });
});

describe("the checks run on a budget", () => {
  it("a check the database holds forever is cut at the budget, and the run still answers, writes its row and alerts", async () => {
    holdQuery = (q) => q.rpc === "get_cached_response";
    const run = start();
    let answered = false;
    void run.then(() => { answered = true; });
    await vi.advanceTimersByTimeAsync(RUN_BUDGET_MS - 1000);
    expect(answered, "the run answered before its budget was spent").toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    const j = await (await run).json() as Out;
    const cut = j.checks.find((c) => c.name === "run_budget");
    expect(cut?.passed).toBe(false);
    expect(cut?.error).toMatch(/had not finished within the run's 115 s budget/);
    expect(j.status).toBe("degraded");
    expect(j.checks.map((c) => c.name)).not.toContain("cache_system");
    expect(rows()).toHaveLength(1);
    await Promise.allSettled(pending);
    expect(calls).toContain("resend");
  });

  it("the end-to-end scan starts with the checks, before the AI probe", async () => {
    const run = start();
    await vi.advanceTimersByTimeAsync(10);
    await run;
    expect(calls.indexOf("e2e")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("e2e")).toBeLessThan(calls.indexOf("gateway"));
  });

  it("a row the database will not write does not hold the owner's alert", async () => {
    gatewayHangs = true;
    holdQuery = (q) => q.rpc === "log_heartbeat_result";
    void start();
    await vi.advanceTimersByTimeAsync(AI_PROBE_MS + 50);
    await Promise.allSettled(pending);
    expect(rows()).toHaveLength(1);
    expect(calls).toContain("resend");
  });
});
