// @vitest-environment node
/**
 * THE ALERT MONITOR ANSWERS ITS CRON AND ITS OWNER, AND NOBODY ELSE.
 *
 * WHAT WAS WRONG. check-alerts runs with verify_jwt = false and checked
 * nothing: any POST ran the alert evaluation and got back `{metrics, alerts}`
 * -- the delivery, AI, email, webhook and parse rates check-alerts computes
 * with the service role from get_delivery_health, get_ai_quality_stats,
 * get_email_health, get_webhook_health and get_parse_failure_stats. Migration
 * 20261004110000 moved exactly those readers behind the ADMIN_API_KEY, so
 * check-alerts was a second door around that gate.
 *
 * WHAT THIS HOLDS, against the shipped handler with only its network faked
 * (helpers/edge-harness):
 *   - the preflight carries x-fn-build and allows the two key headers;
 *   - no key, a short cron key, a wrong admin key, or an unset ADMIN_API_KEY
 *     with an empty header is 401 with NO client built and NO call made;
 *   - a cron key of the right length that the vault does not hold is 401
 *     after exactly one call -- alerts_cron_key_matches -- and no reader runs;
 *   - the vault's key, or the owner's key, runs the evaluation, and the
 *     answer is a count: no metric, no alert value;
 *   - the cron job migration 20261004110000 schedules sends x-alerts-cron.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2":
    "export function createClient(url, key) { globalThis.__alertClients.push(key); return globalThis.__alertDb; }",
  "https://esm.sh/resend@2.0.0":
    "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__alertMail.push(m); return { id: 'x' }; } }; } }",
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  RESEND_API_KEY: "re_harness",
  ADMIN_EMAIL: "owner@example.com",
  ADMIN_API_KEY: "admin-key-harness-0123456789",
};
const VAULT_KEY = "a".repeat(64);
const READERS = ["get_delivery_health", "get_ai_quality_stats", "get_email_health", "get_webhook_health", "get_parse_failure_stats"];

let handler: EdgeHandler;
let db: FakeDb;
let calls: string[];
let clients: string[];
let mail: unknown[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("check-alerts", STUBS);
}, 120_000);

beforeEach(() => {
  env.ADMIN_API_KEY = "admin-key-harness-0123456789";
  calls = [];
  clients = [];
  mail = [];
  db = new FakeDb();
  db.rpcs.alerts_cron_key_matches = (args) => {
    calls.push("alerts_cron_key_matches");
    return { data: args.p_key === VAULT_KEY, error: null };
  };
  // Every metric breaches its threshold, so the run has something to say.
  const reader = (name: string, row: Record<string, unknown>) => () => { calls.push(name); return { data: [row], error: null }; };
  db.rpcs.get_delivery_health = reader("get_delivery_health", { delivery_rate: 12.5 });
  db.rpcs.get_ai_quality_stats = reader("get_ai_quality_stats", { success_rate: 40 });
  db.rpcs.get_email_health = reader("get_email_health", { success_rate: 50 });
  db.rpcs.get_webhook_health = reader("get_webhook_health", { total_received: 10, processing_failed: 5 });
  db.rpcs.get_parse_failure_stats = reader("get_parse_failure_stats", { total_failures: 9 });
  db.rpcs.should_send_alert = () => { calls.push("should_send_alert"); return { data: true, error: null }; };
  db.rpcs.log_alert_sent = () => { calls.push("log_alert_sent"); return { data: null, error: null }; };
  const g = globalThis as Record<string, unknown>;
  g.__alertDb = db;
  g.__alertClients = clients;
  g.__alertMail = mail;
});

async function ask(headers: Record<string, string> = {}) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/check-alerts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", ...headers },
    body: "{}",
  }));
  return { res, status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

describe("check-alerts", () => {
  it("answers the preflight with its build and allows both key headers", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/check-alerts", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toMatch(/^check-alerts\.\d{4}-\d{2}-\d{2}\.\d+$/);
    const allowed = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowed).toMatch(/x-admin-key/);
    expect(allowed).toMatch(/x-alerts-cron/);
  });

  it("refuses a stranger before building a client: no key, a short cron key, a wrong admin key", async () => {
    for (const headers of [{}, { "x-alerts-cron": "short" }, { "x-admin-key": "wrong" }, { "x-admin-key": `${env.ADMIN_API_KEY}x` },
      { authorization: `Bearer ${env.ADMIN_API_KEY}` }]) {
      const r = await ask(headers);
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.body).toEqual({ error: "Unauthorized" });
      expect(r.res.headers.get("x-fn-build")).toMatch(/^check-alerts\./);
    }
    expect(clients, "no client may be built before a key is checked").toEqual([]);
    expect(calls).toEqual([]);
    expect(mail).toEqual([]);
  });

  it("an unset ADMIN_API_KEY locks the owner's door rather than opening it to an empty header", async () => {
    env.ADMIN_API_KEY = "";
    expect((await ask({ "x-admin-key": "" })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("a cron key the vault does not hold is refused after the key check alone -- no reader runs", async () => {
    const r = await ask({ "x-alerts-cron": "b".repeat(64) });
    expect(r.status).toBe(401);
    expect(calls).toEqual(["alerts_cron_key_matches"]);
    expect(clients).toEqual(["service_harness"]);
    db.rpcs.alerts_cron_key_matches = () => { calls.push("alerts_cron_key_matches"); return { data: null, error: { message: "boom" } }; };
    expect((await ask({ "x-alerts-cron": VAULT_KEY })).status, "a failed key check is a refusal, not a pass").toBe(401);
    expect(calls.filter((c) => READERS.includes(c))).toEqual([]);
    expect(mail).toEqual([]);
  });

  it("the vault's key runs the evaluation and answers a count, never the metrics", async () => {
    const r = await ask({ "x-alerts-cron": VAULT_KEY });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, alertsTriggered: 5, unavailable: 0 });
    expect(JSON.stringify(r.body)).not.toMatch(/delivery_rate|success_rate|12\.5|metrics/);
    expect(calls[0]).toBe("alerts_cron_key_matches");
    for (const fn of READERS) expect(calls, fn).toContain(fn);
    expect(mail).toHaveLength(1);
  });

  it("the owner's key runs it without consulting the vault", async () => {
    const r = await ask({ "x-admin-key": env.ADMIN_API_KEY });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, alertsTriggered: 5, unavailable: 0 });
    expect(calls).not.toContain("alerts_cron_key_matches");
  });
});

describe("the schedule sends the key", () => {
  it("the census migration reschedules check-alerts with x-alerts-cron read from the vault, on its old minutes", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.startsWith("20261004110000_"))!;
    const sql = readFileSync(resolve(dir, file), "utf8").replace(/--[^\n]*/g, "");
    const job = /cron\.schedule\(\s*'check-alerts',\s*'([^']+)',\s*\$job\$([\s\S]*?)\$job\$/.exec(sql);
    expect(job, "no cron.schedule('check-alerts', ...) in the census migration").toBeTruthy();
    expect(job![1]).toBe("18 */6 * * *");
    expect(job![2]).toMatch(/functions\/v1\/check-alerts/);
    expect(job![2]).toMatch(/'x-alerts-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'alerts_cron_key'/);
    // The function reads the same header name the job sends.
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/check-alerts/index.ts"), "utf8");
    expect(fn).toMatch(/req\.headers\.get\("x-alerts-cron"\)/);
    expect(fn).toMatch(/rpc\("alerts_cron_key_matches", \{ p_key: cronKey \}\)/);
  });
});
