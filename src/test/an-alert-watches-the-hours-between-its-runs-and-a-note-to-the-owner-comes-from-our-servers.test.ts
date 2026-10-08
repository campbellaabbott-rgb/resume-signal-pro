// @vitest-environment node
/**
 * AN ALERT WATCHES THE HOURS BETWEEN ITS RUNS, AND A NOTE TO THE OWNER COMES
 * FROM OUR OWN SERVERS (wave 2 email-ops, register L13-48, L10-17, L10-13).
 *
 * WHAT WAS WRONG.
 *   L13-48  check-alerts runs every six hours but asked each health reader for
 *           the last ONE hour, so deliveries failing 07:00-11:00 were invisible
 *           to the 12:18 run (blind about 83% of the clock); and it logged every
 *           alert p_success: true without reading the send's answer.
 *   L10-17  its "View Health Dashboard" button linked
 *           resumebooster.lovable.app -- another product -- whenever SITE_URL
 *           was unset, and no other function sets it.
 *   L10-13  notify-owner accepted unauthenticated {type:'signup'} posts: a
 *           forgeable "New account" signal and a way to spend the Resend quota,
 *           bounded only by a counter in one isolate's memory.
 *
 * WHAT HOLDS NOW, by running both shipped handlers with Resend and the
 * database faked.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const ADMIN = "admin-key-harness-0123456789";
const CRON_KEY = "c".repeat(64);
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com", ADMIN_API_KEY: ADMIN,
};
type Mail = { to: string[]; subject: string; html: string };
let mail: Mail[] = [];
let resendError: { message: string } | null = null;
let db: FakeDb;
let alerts: EdgeHandler;
let notify: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const resend = "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__opsMail.push(m); return globalThis.__opsResendError ? { data: null, error: globalThis.__opsResendError } : { data: { id: 'x' }, error: null }; } }; } }";
  alerts = await loadEdgeHandler("check-alerts", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__opsDb; }",
    "https://esm.sh/resend@2.0.0": resend,
  });
  notify = await loadEdgeHandler("notify-owner", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__opsDb; }",
    "https://esm.sh/resend@2.0.0": resend,
  });
}, 120_000);

const rpcArgs: Array<[string, Record<string, unknown>]> = [];
beforeEach(() => {
  mail = []; resendError = null; rpcArgs.length = 0;
  db = new FakeDb();
  const g = globalThis as Record<string, unknown>;
  g.__opsDb = db; g.__opsMail = mail;
  Object.defineProperty(g, "__opsResendError", { configurable: true, get: () => resendError });
  const rec = (name: string, data: unknown, error: unknown = null) => { db.rpcs[name] = (a) => { rpcArgs.push([name, a]); return { data, error } as never; }; };
  rec("get_delivery_health", [{ delivery_rate: 10 }]);
  rec("get_ai_quality_stats", [{ success_rate: 100 }]);
  rec("get_email_health", [{ success_rate: 100 }]);
  rec("get_webhook_health", [{ total_received: 0 }]);
  rec("get_parse_failure_stats", [{ total_failures: 0 }]);
  rec("should_send_alert", true);
  rec("log_alert_sent", null);
  db.rpcs.email_cron_key_matches = (a) => ({ data: a.p_key === CRON_KEY, error: null });
  db.rpcs.mail_door_take = () => ({ data: true, error: null });
});

const runAlerts = () => alerts(new Request("https://harness.supabase.co/functions/v1/check-alerts", { method: "POST", headers: { "x-admin-key": ADMIN, "content-type": "application/json" }, body: "{}" }));

describe("check-alerts reads the hours since its last run", () => {
  it("every health reader is asked for the six hours the cron's cadence leaves between runs", async () => {
    await runAlerts();
    const readers = rpcArgs.filter(([n]) => n.startsWith("get_"));
    expect(readers).toHaveLength(5);
    for (const [n, a] of readers) expect(a, n).toEqual({ p_hours_back: 6 });
  });

  it("the mail links our own health page, never another product's host", async () => {
    await runAlerts();
    expect(mail).toHaveLength(1);
    expect(mail[0].html).toContain('href="https://resumebooster.work/health-check"');
    expect(mail[0].html).not.toMatch(/lovable\.app/);
  });

  it("a refused send is logged as not sent, so its cooldown does not swallow the next try, and the run says so", async () => {
    resendError = { message: "domain not verified" };
    const res = await runAlerts();
    expect(res.status).toBe(502);
    const logged = rpcArgs.filter(([n]) => n === "log_alert_sent").map(([, a]) => a.p_success);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((x) => x === false), "every alert was logged as sent").toBe(true);
  });

  it("a reader that cannot answer is an alarm of its own, named in the mail", async () => {
    db.rpcs.get_delivery_health = () => ({ data: null, error: { message: "permission denied" } });
    await runAlerts();
    expect(mail).toHaveLength(1);
    expect(mail[0].html).toContain("Health Checks Unavailable");
    expect(mail[0].html).toContain("These checks could not be evaluated: get_delivery_health.");
  });
});

describe("notify-owner answers our own servers only", () => {
  const post = (headers: Record<string, string>, body: unknown = { type: "signup", email: "ceo@bigco.example" }) =>
    notify(new Request("https://harness.supabase.co/functions/v1/notify-owner", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("no key, the publishable key, or a wrong cron key: 401 and no mail", async () => {
    for (const h of [{}, { authorization: "Bearer anon_publishable_key_0123456789abcdef" }, { "x-email-cron": "d".repeat(64) }]) {
      expect((await post(h)).status, JSON.stringify(h)).toBe(401);
    }
    expect(mail, "a stranger fabricated a 'New account' mail").toEqual([]);
  });

  it("the trigger's cron key and free-keyword-scan's service role are heard, and counted in the database", async () => {
    const counted: Array<Record<string, unknown>> = [];
    db.rpcs.mail_door_take = (a) => { counted.push(a); return { data: true, error: null }; };
    expect((await post({ "x-email-cron": CRON_KEY }, { type: "INSERT", record: { email: "new@example.com", created_at: "2026-10-08T00:00:00Z" } })).status).toBe(200);
    expect((await post({ authorization: `Bearer ${SERVICE}` }, { type: "scan", score: 70, industry: "technology" })).status).toBe(200);
    expect(mail.map((m) => m.subject)).toEqual(["🎉 New account: new@example.com", "📄 New scan: 70/100 (technology)"]);
    expect(counted.map((c) => [c.p_door, c.p_max, c.p_window_minutes])).toEqual([["notify-owner", 100, 60], ["notify-owner", 100, 60]]);
  });

  it("past the database's hourly ceiling nothing is sent", async () => {
    db.rpcs.mail_door_take = () => ({ data: false, error: null });
    expect(await (await post({ authorization: `Bearer ${SERVICE}` })).json()).toEqual({ skipped: "rate-capped" });
    expect(mail).toEqual([]);
  });
});
