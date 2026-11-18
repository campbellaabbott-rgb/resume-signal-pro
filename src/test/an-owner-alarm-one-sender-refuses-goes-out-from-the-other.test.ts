// @vitest-environment node
/**
 * AN OWNER ALARM ONE SENDER REFUSES GOES OUT FROM THE OTHER (bug round
 * 2026-11-08, NB-36).
 *
 * check-alerts and check-error-spikes mailed the owner from one sender only,
 * alerts@resend.dev: Resend's shared domain, which the account may not be
 * allowed to send from. A refused send was logged, never retried from
 * another sender, so a whole class of owner alarms could fail every time
 * without anyone hearing. They now take mail-watch's way: our own domain
 * first (alerts@resumebooster.work), then Resend's onboarding sender, which
 * always reaches the account's own address. And check-error-spikes gives its
 * six-hour door back when no sender accepted the mail, so the next run tries
 * again instead of keeping quiet for six hours about a mail nobody got.
 *
 * Run here as they ship, with Resend and the database faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const OURS = "Resume Booster Alerts <alerts@resumebooster.work>";
const ONBOARDING = "Resume Booster Alerts <onboarding@resend.dev>";
const ADMIN = "admin-key-harness-0123456789";
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com", ADMIN_API_KEY: ADMIN,
};

/** Every send either function asked for, in order, and the senders Resend refuses. */
let sends: Array<{ from: string; to: unknown }> = [];
let refuse = new Set<string>();
let alerts: EdgeHandler;
let spikes: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  alerts = await loadEdgeHandler("check-alerts", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__nb36Db; }",
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => globalThis.__nb36Send(m) }; } }",
  });
  spikes = await loadEdgeHandler("check-error-spikes", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__nb36Client; }",
  });
}, 120_000);

beforeEach(() => {
  sends = [];
  refuse = new Set();
  const g = globalThis as Record<string, unknown>;
  // The Resend SDK's answer: { data, error }.
  g.__nb36Send = async (m: { from: string; to: unknown }) => {
    sends.push({ from: m.from, to: m.to });
    return refuse.has(m.from) ? { data: null, error: { message: "The resend.dev domain is not allowed" } } : { data: { id: "em" }, error: null };
  };
  // The raw API, as check-error-spikes calls it.
  g.fetch = async (url: string, init: { body: string }) => {
    expect(url).toBe("https://api.resend.com/emails");
    const m = JSON.parse(init.body) as { from: string; to: unknown };
    sends.push({ from: m.from, to: m.to });
    return new Response("{}", { status: refuse.has(m.from) ? 403 : 200 });
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("check-alerts", () => {
  let logged: boolean[];
  beforeEach(() => {
    logged = [];
    const db = new FakeDb();
    (globalThis as Record<string, unknown>).__nb36Db = db;
    const answer = (name: string, data: unknown) => { db.rpcs[name] = () => ({ data, error: null }) as never; };
    answer("get_delivery_health", [{ delivery_rate: 10 }]);
    answer("get_ai_quality_stats", [{ success_rate: 100 }]);
    answer("get_email_health", [{ success_rate: 100 }]);
    answer("get_webhook_health", [{ total_received: 0 }]);
    answer("get_parse_failure_stats", [{ total_failures: 0 }]);
    answer("get_scan_health_status", [{ last_heartbeat_time: new Date(Date.now() - 60_000).toISOString() }]);
    answer("should_send_alert", true);
    db.rpcs.log_alert_sent = (a) => { logged.push(a.p_success === true); return { data: null, error: null } as never; };
  });
  const run = () => alerts(new Request("https://harness.supabase.co/functions/v1/check-alerts", {
    method: "POST", headers: { "x-admin-key": ADMIN, "content-type": "application/json" }, body: "{}",
  }));

  it("mails from our own domain first, and only once when it is accepted", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(sends.map((s) => s.from)).toEqual([OURS]);
    expect(sends[0].to).toEqual(["owner@example.com"]);
  });

  it("a send our domain is refused goes out from Resend's onboarding sender, and is logged as sent", async () => {
    refuse.add(OURS);
    const res = await run();
    expect(res.status).toBe(200);
    expect(sends.map((s) => s.from)).toEqual([OURS, ONBOARDING]);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((x) => x)).toBe(true);
  });

  it("a send every sender refused is a 502, logged as not sent", async () => {
    refuse = new Set([OURS, ONBOARDING]);
    const res = await run();
    expect(res.status).toBe(502);
    expect(sends.map((s) => s.from)).toEqual([OURS, ONBOARDING]);
    expect(logged.every((x) => !x)).toBe(true);
  });
});

describe("check-error-spikes", () => {
  let doorOpen: boolean;
  let givenBack: Array<Record<string, unknown>>;
  beforeEach(() => {
    doorOpen = true;
    givenBack = [];
    const recent = [{ error_type: "client", error_code: "UPLOAD_FAILED", error_message: "parse failed", function_name: "parse-pdf", visitor_id: "v1", created_at: new Date().toISOString() }];
    const query = { select: () => query, gte: () => query, order: () => query, limit: async () => ({ data: recent, error: null }) };
    const doors = {
      delete: () => {
        const filter: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, v: unknown) => { filter[col] = v; if (Object.keys(filter).length === 2) givenBack.push({ ...filter }); return chain; },
          then: (ok: (r: { error: null }) => void) => ok({ error: null }),
        };
        return chain;
      },
    };
    (globalThis as Record<string, unknown>).__nb36Client = {
      rpc: async (fn: string) => {
        if (fn === "detect_user_error_spikes") {
          return { data: [{ visitor_id: "v1", recent_error_count: 12, baseline_hourly_rate: 0.5, spike_multiplier: 96, recent_error_types: ["client"], last_error_at: new Date().toISOString(), is_spike: true }], error: null };
        }
        if (fn === "mail_door_take") return { data: doorOpen, error: null };
        return { data: [], error: null };
      },
      from: (table: string) => (table === "mail_door_counts" ? doors : query),
    };
  });
  const run = async () => (await spikes(new Request("https://harness.supabase.co/functions/v1/check-error-spikes", {
    method: "POST", headers: { "x-admin-key": ADMIN, "content-type": "application/json" }, body: "{}",
  }))).json();

  it("mails a spike from our own domain first", async () => {
    expect(await run()).toMatchObject({ mailed: true, mail_skipped: null });
    expect(sends.map((s) => s.from)).toEqual([OURS]);
    expect(givenBack).toEqual([]);
  });

  it("a spike mail our domain is refused goes out from Resend's onboarding sender", async () => {
    refuse.add(OURS);
    expect(await run()).toMatchObject({ mailed: true, mail_skipped: null });
    expect(sends.map((s) => s.from)).toEqual([OURS, ONBOARDING]);
    expect(givenBack).toEqual([]);
  });

  it("a spike mail every sender refused is said, and its six-hour door is given back so the next run tries again", async () => {
    refuse = new Set([OURS, ONBOARDING]);
    expect(await run()).toMatchObject({ mailed: false, mail_skipped: "send refused: HTTP 403" });
    expect(sends.map((s) => s.from)).toEqual([OURS, ONBOARDING]);
    expect(givenBack).toEqual([{ door: "check-error-spikes:owner", bucket: "all" }]);
  });
});
