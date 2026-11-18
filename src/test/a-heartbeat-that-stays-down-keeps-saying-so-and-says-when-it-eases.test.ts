// @vitest-environment node
/**
 * A HEARTBEAT THAT STAYS DOWN KEEPS SAYING SO, AND SAYS WHEN IT EASES
 * (bug round 2026-11-08: S14X-018, S14X-045; NEW-OPS-ALERTS-01's verify case).
 *
 * WHAT WAS WRONG.
 *   S14X-018  A heartbeat that stayed down mailed the owner once and then
 *             nothing for a day: every failing check had been announced, the
 *             escalation rule needs a status that was not down before, and
 *             the reminder waits 24 hours. Going from down to degraded was
 *             never said, so the last word in the inbox was "DOWN".
 *   S14X-045  The recovery note stamped the time the four-hour cooldown
 *             counts from. A new failure soon after a recovery waited up to
 *             four hours (a refused Stripe key, every checkout failing, was
 *             only 'degraded' and so was held too), and the state that sat
 *             silent inside that cooldown got a second 'recovered' note for
 *             an incident nobody was told of.
 *
 * WHAT HOLDS NOW, by running the shipped handler under the cron's key with
 * the clock and the network faked and job_board_meta kept between runs as
 * production keeps it:
 *   - down for two hours mails again, saying since when and for how long;
 *   - the first run that is degraded after hours down mails one 'no longer
 *     down' note naming what still fails, and the runs after it are quiet;
 *   - a degraded set held for hours is mailed once;
 *   - a refused or missing Stripe key grades the run down and is mailed at
 *     once, however soon after a recovery note;
 *   - a recovery note always ends an incident the owner was told of;
 *   - (NB-34) a ground-truth audit reading older than a day is named as
 *     stale first, with its date, and never judged against the SLA as if
 *     it were today's board;
 *   - (NEW-OPS-ALERTS-01, the cost wave's fix, kept as this round's verify
 *     case) a filter contract that failed at :00 stays failed, carried, at
 *     :10, with no recovery mail; the next :00 that passes sends one.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";
import { HOURLY_VERDICT_KEY } from "../../supabase/functions/scan-heartbeat/watch";

/** Where production keeps the alert state between runs. */
const ALERT_STATE_KEY = "heartbeat_alert_state";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

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
let meta: Record<string, unknown>;
/** What each faked service answers this run. */
let fullScan: { status: number; body: unknown };
let ai: { status: number; body: unknown };
let stripeStatus: number;
let storageTight: boolean;
let filterBroken: boolean;
let backstopOpen: boolean;
/** The ground-truth audit's row, or null for none. */
let auditRow: { v: Record<string, unknown>; updated_at: string } | null;

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const FULL_REPORT = { atsScoreEstimate: 71, reportMeta: { reportId: "R1" }, partialResults: false, reportCompleteness: 92 };
const RULES_REPORT = { atsScoreEstimate: 64, reportMeta: { reportId: "R2" }, partialResults: true, partialReason: "rule_based", reportCompleteness: 64, heartbeatNoModel: true };
const AI_OK = { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] };

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
    if (u.includes("api.stripe.com")) return okJson(stripeStatus === 200 ? { object: "balance" } : { error: { message: "Invalid API Key" } }, stripeStatus);
    if (u.includes("ai.gateway.lovable.dev")) return okJson(ai.body, ai.status);
    if (u.endsWith("/functions/v1/free-keyword-scan")) return body?.heartbeatNoModel === true ? okJson(RULES_REPORT) : okJson(fullScan.body, fullScan.status);
    if (u.endsWith("/functions/v1/job-board")) {
      if (body?.action === "vendor-health") return okJson({ drifted: [], unreachable: [] });
      if (body?.action === "status") return okJson({ catalogSize: 100, version: "t" });
      // A healthcare filter that serves a finance row breaks the filter contract.
      if (filterBroken && body?.category === "healthcare") return okJson({ jobs: [{ title: "Staff Accountant", company: "Acme", category: "finance" }], total: 1 });
      return okJson({ jobs: [], total: 0 });
    }
    return okJson({});
  };
  handler = await loadEdgeHandler("scan-heartbeat", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbDownDb; }",
  });
});

const keyOf = (q: Query) => q.calls.find((c) => c[0] === "eq" && c[1][0] === "k")?.[1][1] as string | undefined;
beforeEach(() => {
  meta = {};
  fullScan = { status: 200, body: FULL_REPORT };
  ai = { status: 200, body: AI_OK };
  stripeStatus = 200;
  storageTight = false;
  filterBroken = false;
  backstopOpen = true;
  auditRow = null;
  const db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "email_cron_key_matches") return { data: (q.calls[0][1][0] as { p_key: string }).p_key === CRON_KEY, error: null };
    if (q.rpc === "check_rate_limit") return { data: backstopOpen, error: null };
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
      if (k === ALERT_STATE_KEY || k === HOURLY_VERDICT_KEY) return { data: k in meta ? { v: meta[k] } : null, error: null };
      if (k === "audit") return { data: auditRow, error: null };
      if (k === "capacity") return { data: { v: { active: false, headroom: 50000, basis: "measured" } }, error: null };
      return { data: { updated_at: new Date().toISOString() }, error: null };
    }
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbDownDb = db;
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

type Out = { status: string; errorMessage?: string | null; checks: Array<{ name: string; passed: boolean; error?: string }> };
type Run = Out & { at: string; mails: Array<{ subject: string; html: string }> };

/** One cron run at `at` (UTC), with everything it left in the background settled. */
async function runAt(at: string): Promise<Run> {
  fetched.length = 0;
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
  const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", "x-email-cron": CRON_KEY }, body: "{}",
  }));
  const j = await res.json() as Out;
  for (let i = 0; i < 3; i++) { const p = pending; pending = []; await Promise.allSettled(p); }
  const mails = fetched.filter((f) => f.url.includes("api.resend.com"))
    .map((f) => ({ subject: String((f.body as { subject?: string })?.subject), html: String((f.body as { html?: string })?.html) }));
  return { ...j, at, mails };
}
/** Runs every ten minutes from `from` to `to` (both "HH:MM", one UTC day), three seconds past each. */
async function runsBetween(from: string, to: string): Promise<Run[]> {
  const out: Run[] = [];
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  for (let m = fh * 60 + fm; m <= th * 60 + tm; m += 10) {
    out.push(await runAt(`2026-11-12T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:03Z`));
  }
  return out;
}
const subjects = (runs: Run[]) => runs.flatMap((r) => r.mails.map((m) => `${r.at.slice(11, 16)} ${m.subject}`));
const check = (r: Run, name: string) => r.checks.find((c) => c.name === name);

describe("S14X-018: a heartbeat that stays down keeps saying so", () => {
  it("down for two hours mails a second time, saying since when and for about how long", async () => {
    fullScan = { status: 500, body: { error: "boom" } };
    const runs = await runsBetween("00:00", "02:10");
    for (const r of runs) expect(r.status, r.at).toBe("down");
    const sent = subjects(runs);
    expect(sent[0]).toBe("00:00 🔴 Heartbeat DOWN: e2e_scan");
    expect(sent.length, sent.join("\n")).toBe(2);
    expect(sent[1]).toBe("02:00 🔴 Heartbeat DOWN since 00:00 UTC (about 2 h): e2e_scan");
    const reminder = runs.flatMap((r) => r.mails)[1];
    expect(reminder.html).toMatch(/Still down since 00:00 UTC \(about 2 h\)/);
  });

  it("the first degraded run after six hours down mails one 'no longer down' note naming what still fails, and the next runs are quiet", async () => {
    // Storage is tight all along, so it is announced with the outage; the
    // outage is the scan, which comes back at 06:00.
    storageTight = true;
    fullScan = { status: 500, body: { error: "boom" } };
    const down: Run[] = [];
    for (let h = 0; h < 6; h++) down.push(await runAt(`2026-11-12T0${h}:00:03Z`));
    for (const r of down) expect(r.status, r.at).toBe("down");
    fullScan = { status: 200, body: FULL_REPORT };
    const eased = [await runAt("2026-11-12T06:00:03Z"), await runAt("2026-11-12T06:10:03Z"), await runAt("2026-11-12T06:20:03Z")];
    expect(eased.map((r) => r.status)).toEqual(["degraded", "degraded", "degraded"]);
    expect(subjects(eased)).toEqual(["06:00 🟡 Heartbeat no longer down (still DEGRADED: storage)"]);
    expect(eased[0].mails[0].html).toMatch(/No longer down; still degraded on: storage/);
    expect(eased[0].mails[0].html).toMatch(/\(was down\)/);
  });

  it("a degraded set held for six hours is mailed once: the daily reminder is for degraded, the two-hour one for down", async () => {
    storageTight = true;
    const runs: Run[] = [];
    for (let h = 0; h < 6; h++) for (const m of ["00", "30"]) runs.push(await runAt(`2026-11-12T0${h}:${m}:03Z`));
    for (const r of runs) expect(r.status, r.at).toBe("degraded");
    expect(subjects(runs)).toEqual(["00:00 🟡 Heartbeat DEGRADED: storage"]);
  });
});

describe("S14X-045: a cooldown ends with its incident", () => {
  it("a Stripe key refused twenty minutes after a recovery note is down and mailed at once", async () => {
    ai = { status: 500, body: { error: "gateway down" } };
    const first = await runAt("2026-11-12T00:00:03Z");
    expect(first.status).toBe("down");
    ai = { status: 200, body: AI_OK };
    const healed = await runAt("2026-11-12T00:10:03Z");
    expect(healed.status).toBe("healthy");
    expect(subjects([first, healed])).toEqual(["00:00 🔴 Heartbeat DOWN: ai_gateway", "00:10 ✅ Heartbeat recovered: all checks passing"]);
    stripeStatus = 401;
    const refused = await runAt("2026-11-12T00:30:03Z");
    expect(refused.status, "a key that fails every checkout is an outage").toBe("down");
    expect(check(refused, "stripe_credentials")).toMatchObject({ passed: false });
    expect(subjects([refused])).toEqual(["00:30 🔴 Heartbeat DOWN: stripe_credentials"]);
  });

  it("a missing Stripe key is down too", async () => {
    const saved = env.STRIPE_SECRET_KEY;
    delete env.STRIPE_SECRET_KEY;
    try {
      const r = await runAt("2026-11-12T00:20:03Z");
      expect(r.status).toBe("down");
      expect(r.mails.map((m) => m.subject)).toEqual(["🔴 Heartbeat DOWN: stripe_credentials"]);
    } finally { env.STRIPE_SECRET_KEY = saved; }
  });

  it("a recovery note always ends an incident the owner was told of: a check failing again soon after a recovery is announced, not silently followed by a second recovery", async () => {
    // An empty AI reply is degraded and checked on every run.
    const empty = { status: 200, body: { choices: [] } };
    const seq: Array<[string, typeof ai]> = [["00:20", empty], ["00:30", { status: 200, body: AI_OK }], ["00:40", empty], ["00:50", { status: 200, body: AI_OK }]];
    const runs: Run[] = [];
    for (const [t, a] of seq) { ai = a; runs.push(await runAt(`2026-11-12T${t}:03Z`)); }
    expect(runs.map((r) => r.status)).toEqual(["degraded", "healthy", "degraded", "healthy"]);
    const sent = subjects(runs);
    expect(sent).toEqual([
      "00:20 🟡 Heartbeat DEGRADED: ai_gateway",
      "00:30 ✅ Heartbeat recovered: all checks passing",
      "00:40 🟡 Heartbeat DEGRADED: ai_gateway",
      "00:50 ✅ Heartbeat recovered: all checks passing",
    ]);
    // The rule, stated over the sequence: between two recovery notes there is always an alert.
    const kinds = sent.map((s) => (/recovered/.test(s) ? "R" : "A")).join("");
    expect(kinds).not.toMatch(/RR/);
  });

  it("a failing run the two-an-hour backstop held back is never followed by a recovery note", async () => {
    backstopOpen = false;
    ai = { status: 200, body: { choices: [] } };
    const held = await runAt("2026-11-12T00:20:03Z");
    expect(held.status).toBe("degraded");
    expect(held.mails).toEqual([]);
    ai = { status: 200, body: AI_OK };
    backstopOpen = true;
    expect((await runAt("2026-11-12T00:30:03Z")).mails).toEqual([]);
  });
});

describe("NEW-OPS-ALERTS-01 (fixed in the cost wave, judged here): an hourly check that failed stays failed until the next full run", () => {
  it("the filter contract broken at :00 is carried at :10, not healthy, with no recovery mail; the :00 that passes sends one", async () => {
    filterBroken = true;
    const top = await runAt("2026-11-12T10:00:03Z");
    expect(top.status).toBe("unhealthy");
    expect(check(top, "job_board_filter_contract")).toMatchObject({ passed: false });
    filterBroken = false;
    const next = await runAt("2026-11-12T10:10:03Z");
    expect(next.status).not.toBe("healthy");
    expect(check(next, "job_board_filter_contract")?.error).toMatch(/^carried from the 10:00 UTC full run \(hourly check, not re-run\): filters returned rows that violate them/);
    expect(next.mails.some((m) => /recovered/.test(m.subject))).toBe(false);
    const fixed = await runAt("2026-11-12T11:00:03Z");
    expect(fixed.status).toBe("healthy");
    expect(fixed.mails.map((m) => m.subject)).toEqual(["✅ Heartbeat recovered: all checks passing"]);
  });
});

describe("NB-34: a stale accuracy reading is named as stale, never as today's breach", () => {
  // The live row on 2026-11-15: one reading, 2026-11-07, 96.6% (113 live, 4 gone).
  const reading = (at: string, extra: Record<string, unknown> = {}) => ({
    v: { at, accuracyPct: 96.6, live: 113, gone: 4, byVendor: {}, ...extra }, updated_at: at,
  });

  it("a nine-day-old 96.6% says the audit has not written a result, with the reading's date, and is not called dead listings", async () => {
    auditRow = reading("2026-11-07T04:23:33.811Z");
    const r = await runAt("2026-11-16T02:50:03Z");
    const c = check(r, "job_board_accuracy");
    expect(c?.passed).toBe(false);
    expect(c?.error).toMatch(/^ground-truth audit has not written a result in 214h \(it runs daily; stale past 26h\): its last reading \(96\.6%, 2026-11-07\) is not a current measurement/);
    expect(c?.error).not.toMatch(/serving dead listings|refresh\/prune/);
    expect(r.errorMessage).toBe("Board accuracy unmeasured: the daily audit has not written a result in 214h (last reading 96.6%, 2026-11-07)");
    expect(r.status).toBe("degraded");
  });

  it("a stale row is not judged by its vendor floor either", async () => {
    auditRow = reading("2026-11-10T04:23:33Z", { accuracyPct: 99, byVendor: { workday: { sampled: 30, live: 10, gone: 20, accuracyPct: 33.3 } } });
    const c = check(await runAt("2026-11-12T10:20:03Z"), "job_board_accuracy");
    expect(c?.error).toMatch(/^ground-truth audit has not written a result in 54h/);
    expect(c?.error).not.toMatch(/below the 80% floor/);
  });

  it("the same 96.6% read this morning is today's breach, as before", async () => {
    auditRow = reading("2026-11-12T04:23:33Z");
    const r = await runAt("2026-11-12T10:20:03Z");
    expect(check(r, "job_board_accuracy")?.error).toMatch(/^ground-truth audit: only 96\.6% of sampled postings confirmed live at the source \(113\/117\)/);
    expect(r.errorMessage).toBe("Board accuracy 96.6% (below 97% SLA)");
  });

  it("a reading inside the day at 99% passes; one a day and three hours old does not", async () => {
    auditRow = reading("2026-11-11T08:00:00Z", { accuracyPct: 99 });
    expect(check(await runAt("2026-11-12T08:20:03Z"), "job_board_accuracy")?.passed).toBe(true);
    expect(check(await runAt("2026-11-12T11:20:03Z"), "job_board_accuracy")?.passed).toBe(false);
  });
});
