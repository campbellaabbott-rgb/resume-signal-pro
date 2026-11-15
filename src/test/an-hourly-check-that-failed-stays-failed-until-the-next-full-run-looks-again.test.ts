// @vitest-environment node
/**
 * AN HOURLY CHECK THAT FAILED STAYS FAILED UNTIL THE NEXT FULL RUN LOOKS AGAIN
 * (cost wave review, 2026-11-15; scan-heartbeat 2026-11-09.1).
 *
 * WHAT WAS WRONG. The heartbeat runs five checks only on the cron's first run
 * of each UTC hour (the full scan, the filter contract, vendor-health and the
 * two storage reads) and skips them on the other five, and a skip never moves
 * the status. So while one of them was failing, the :10 run read 'healthy',
 * mailed "Heartbeat recovered: all checks passing", and stamped the alert
 * state healthy with a fresh lastSentAt, which kept the four-hour cooldown
 * running so the :00 run's alert was never sent again: an incident the owner
 * heard of once and then heard had ended, every hour. The row and the
 * healthchecks.io ping went green five runs in six.
 *
 * WHAT HOLDS NOW, by running the shipped handler under the cron's key with
 * the clock and the network faked, the alert state and the hour's verdict
 * kept in job_board_meta between runs as production keeps them:
 *   - a full run stores its failed hourly checks and the severity each gave;
 *   - an off-hour run within 70 minutes reports each as failed, marked
 *     carried, at that severity: no recovery mail, the same fingerprint, so
 *     no new alert either, and the status, row and ping say what the hour
 *     found;
 *   - the next full run that passes clears it, and the recovery note goes
 *     out once;
 *   - a verdict older than 70 minutes is not carried.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";
import { CARRY_MS, FACETS_STALE_MIN, HOURLY, HOURLY_VERDICT_KEY, carriedFailures, hourlyVerdictOf, worse } from "../../supabase/functions/scan-heartbeat/watch";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const CRON_KEY = "c".repeat(64);
const PING = "https://hc-ping.example/heartbeat-check";
const env: Record<string, string | undefined> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_for_the_harness_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com", HC_HEARTBEAT_PING_URL: PING,
};

type Call = { url: string; body: unknown };
const fetched: Call[] = [];
let pending: Promise<unknown>[] = [];
let handler: EdgeHandler;
/** job_board_meta as production keeps it between runs. */
let meta: Record<string, unknown>;
let facetsAgeMin: number;
/** What free-keyword-scan answers a full (model) scan. */
let fullScan: { status: number; body: unknown };
let storageTight: boolean;

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const FULL_REPORT = { atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 };
const PARTIAL_REPORT = { atsScoreEstimate: 64, reportMeta: { reportId: "R1" }, partialResults: true, partialReason: "rule_based", reportCompleteness: 64 };
const RULES_REPORT = { atsScoreEstimate: 64, reportMeta: { reportId: "R2" }, partialResults: true, partialReason: "rule_based", reportCompleteness: 64, heartbeatNoModel: true };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    fetched.push({ url: u, body: body ?? init?.body ?? null });
    if (u.startsWith(PING)) return new Response("OK", { status: 200 });
    if (u.includes("api.resend.com")) return okJson({ id: "em" });
    if (u.includes("api.stripe.com")) return okJson({ object: "balance" });
    if (u.includes("ai.gateway.lovable.dev")) return okJson({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] });
    if (u.endsWith("/functions/v1/free-keyword-scan")) return body?.heartbeatNoModel === true ? okJson(RULES_REPORT) : okJson(fullScan.body, fullScan.status);
    if (u.endsWith("/functions/v1/job-board")) {
      if (body?.action === "vendor-health") return okJson({ drifted: [], unreachable: [] });
      if (body?.action === "status") return okJson({ catalogSize: 100, version: "t" });
      return okJson({ jobs: [], total: 0 });
    }
    return okJson({});
  };
  handler = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbTierDb; }",
  });
});

let db: ProxyDb;
const keyOf = (q: Query) => q.calls.find((c) => c[0] === "eq" && c[1][0] === "k")?.[1][1] as string | undefined;
beforeEach(() => {
  meta = {};
  facetsAgeMin = 1;
  fullScan = { status: 200, body: FULL_REPORT };
  storageTight = false;
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "email_cron_key_matches") return { data: (q.calls[0][1][0] as { p_key: string }).p_key === CRON_KEY, error: null };
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.rpc === "get_storage_footprint") return { data: [{ db_bytes: storageTight ? 39 * 1024 ** 3 : 1024 ** 3, postings_bytes: 1, closures_bytes: 1 }], error: null };
    if (q.rpc === "get_stale_board_count") return { data: 12, error: null };
    if (q.rpc === "get_freshness_stats") return { data: [{ boards: 500, p50_min: 100, p95_min: 200 }], error: null };
    if (q.table === "job_board_meta") {
      const up = q.calls.find((c) => c[0] === "upsert");
      if (up) {
        const row = up[1][0] as { k: string; v: unknown };
        meta[row.k] = row.v;
        return { data: null, error: null };
      }
      const k = keyOf(q);
      if (k === "heartbeat_alert_state" || k === HOURLY_VERDICT_KEY) return { data: k in meta ? { v: meta[k] } : null, error: null };
      if (k === "capacity") return { data: { v: { active: false, headroom: 50000, basis: "measured" } }, error: null };
      if (k === "facets") return { data: { updated_at: new Date(Date.now() - facetsAgeMin * 60_000).toISOString() }, error: null };
      return { data: { updated_at: new Date().toISOString() }, error: null };
    }
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbTierDb = db;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.allSettled(pending);
  pending = [];
  fetched.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Out = { status: string; fullRun: boolean; checks: Array<{ name: string; passed: boolean; error?: string }>; skipped: Array<{ name: string; reason: string }> };
type Run = Out & { at: string; mails: string[]; pinged: string[] };

/** A run of the cron at `at` (UTC), with everything it left in the background settled. */
async function runAt(at: string): Promise<Run> {
  fetched.length = 0;
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", "x-email-cron": CRON_KEY }, body: "{}",
  }));
  expect(res.status).toBe(200);
  const j = await res.json() as Out;
  for (let i = 0; i < 3; i++) { const p = pending; pending = []; await Promise.allSettled(p); }
  const mails = fetched.filter((f) => f.url.includes("api.resend.com")).map((f) => String((f.body as { subject?: string })?.subject));
  const pinged = fetched.filter((f) => f.url.startsWith(PING)).map((f) => f.url);
  return { ...j, at, mails, pinged };
}
const failing = (r: Run) => r.checks.filter((c) => !c.passed).map((c) => c.name).sort();
const check = (r: Run, name: string) => r.checks.find((c) => c.name === name);
const HOUR = (h: number) => ["00:04", "10:03", "20:03", "30:03", "40:03", "50:03"].map((m) => `2026-11-09T${String(h).padStart(2, "0")}:${m}Z`);

describe("an hourly check failing at the top of the hour", () => {
  it("the scan's model chain answering a partial report: the off-hour runs stay degraded, mail no recovery and no second alert", async () => {
    fullScan = { status: 200, body: PARTIAL_REPORT };
    const runs: Run[] = [];
    for (const at of [...HOUR(10), "2026-11-09T11:00:04Z", "2026-11-09T11:10:03Z"]) runs.push(await runAt(at));
    expect(runs[0].fullRun).toBe(true);
    expect(runs[0].mails).toEqual(["🟡 Heartbeat DEGRADED: e2e_scan"]);
    for (const r of runs) {
      expect(r.status, r.at).toBe("degraded");
      expect(failing(r), r.at).toEqual(["e2e_scan"]);
    }
    for (const r of runs.slice(1)) expect(r.mails, `${r.at} mailed`).toEqual([]);
    const carried = check(runs[1], "e2e_scan");
    expect(carried?.error).toMatch(/^carried from the 10:00 UTC full run \(hourly check, not re-run\): answered with a partial report/);
    expect(runs[1].skipped.some((s) => s.name === "e2e_scan"), "a carried check is reported, not skipped").toBe(false);
    expect(runs[1].skipped.filter((s) => s.reason === HOURLY).map((s) => s.name).sort())
      .toEqual(["job_board_filter_contract", "job_board_storage", "job_board_vendors", "job_board_verification_ceiling"]);
    expect(meta.heartbeat_alert_state, "the alert state never read healthy").toMatchObject({ fingerprint: "degraded|e2e_scan" });
  });

  it("the storage alarm: every run of six hours keeps it in the failing set, so it is mailed once and never followed by a recovery note", async () => {
    storageTight = true;
    const runs: Run[] = [];
    for (let h = 10; h < 16; h++) for (const at of HOUR(h).slice(0, 3)) runs.push(await runAt(at));
    for (const r of runs) expect(failing(r), r.at).toContain("job_board_storage");
    const mailed = runs.filter((r) => r.mails.length);
    expect(mailed.map((r) => r.at), "one alert for one incident in six hours").toEqual(["2026-11-09T10:00:04Z"]);
    expect(runs.flatMap((r) => r.mails).some((m) => /recovered/.test(m))).toBe(false);
  });

  it("the end-to-end scan answering an error is down at :00 and carried as down: the off-hour ping reports the failure too", async () => {
    fullScan = { status: 500, body: { error: "boom" } };
    const [top, next] = [await runAt("2026-11-09T10:00:04Z"), await runAt("2026-11-09T10:10:03Z")];
    expect(top.status).toBe("down");
    expect(next.status).toBe("down");
    expect(next.pinged).toEqual([`${PING}/fail`]);
    expect(next.mails).toEqual([]);
  });

  it("the next full run that passes clears it: the recovery note goes out once, and the off-hour runs after it are healthy", async () => {
    fullScan = { status: 200, body: PARTIAL_REPORT };
    await runAt("2026-11-09T10:00:04Z");
    await runAt("2026-11-09T10:10:03Z");
    fullScan = { status: 200, body: FULL_REPORT };
    const fixed = await runAt("2026-11-09T11:00:04Z");
    expect(fixed.status).toBe("healthy");
    expect(fixed.mails).toEqual(["✅ Heartbeat recovered: all checks passing"]);
    const after = await runAt("2026-11-09T11:10:03Z");
    expect(after.status).toBe("healthy");
    expect(after.mails).toEqual([]);
    expect(check(after, "e2e_scan")).toBeUndefined();
  });

  it("a verdict older than seventy minutes is not carried: a missed full run does not keep an old failure alive", async () => {
    fullScan = { status: 200, body: PARTIAL_REPORT };
    await runAt("2026-11-09T10:00:04Z");
    const late = await runAt("2026-11-09T11:20:03Z");
    expect(check(late, "e2e_scan")).toBeUndefined();
    expect(late.status).toBe("healthy");
  });
});

describe("the verdict's own rules", () => {
  it("keeps only the five hourly checks, each with the severity it gave the run", () => {
    const v = hourlyVerdictOf(new Date("2026-11-09T10:00:04Z"), [
      { name: "e2e_scan", passed: false, error: "HTTP 500", severity: "down" },
      { name: "job_board_filter_contract", passed: false, error: "wrong rows" },
      { name: "job_board_storage", passed: false, error: "full" },
      { name: "job_board_vendors", passed: true },
      { name: "ai_gateway", passed: false, error: "every run checks this" },
    ]);
    expect(v.failed).toEqual([
      { name: "e2e_scan", error: "HTTP 500", severity: "down" },
      { name: "job_board_filter_contract", error: "wrong rows", severity: "unhealthy" },
      { name: "job_board_storage", error: "full", severity: "degraded" },
    ]);
  });

  it("carries nothing from a missing, malformed, future or stale verdict", () => {
    const now = new Date("2026-11-09T10:30:00Z");
    const good = { at: "2026-11-09T10:00:04Z", failed: [{ name: "job_board_storage", error: "full", severity: "degraded" }] };
    expect(carriedFailures(good, now)?.failed).toHaveLength(1);
    for (const v of [null, "x", { at: "nope", failed: good.failed }, { at: good.at, failed: "x" },
      { at: good.at, failed: [] }, { at: good.at, failed: [{ name: "ai_gateway", error: "x", severity: "down" }] },
      { at: good.at, failed: [{ name: "e2e_scan", error: "x", severity: "fine" }] },
      { at: "2026-11-09T12:00:00Z", failed: good.failed },
      { at: new Date(now.getTime() - CARRY_MS - 1000).toISOString(), failed: good.failed }]) {
      expect(carriedFailures(v, now), JSON.stringify(v)).toBeNull();
    }
    expect(worse("degraded", "down")).toBe("down");
    expect(worse("unhealthy", "degraded")).toBe("unhealthy");
  });
});

describe("the facets row, rebuilt only when it is 40 minutes old", () => {
  it("is healthy at the 55 minutes a gated rebuild reaches and one missed rebuild later, and stale past 90", async () => {
    expect(FACETS_STALE_MIN).toBe(90);
    facetsAgeMin = 70;
    const ok = await runAt("2026-11-09T10:20:03Z");
    expect(check(ok, "job_board_facets_cache")?.passed, JSON.stringify(check(ok, "job_board_facets_cache"))).toBe(true);
    facetsAgeMin = 95;
    const stale = await runAt("2026-11-09T10:30:03Z");
    expect(check(stale, "job_board_facets_cache")).toMatchObject({ passed: false });
    expect(check(stale, "job_board_facets_cache")?.error).toMatch(/95 min old \(gated 40-min rebuild; 90 min bound\)/);
  });
});
