// @vitest-environment node
/**
 * AN ERROR ALERT NOTHING EVER RAN RUNS ON A SCHEDULE, AND MAILS ONLY A SPIKE
 * (wave 2 email-ops, register L10-20).
 *
 * WHAT WAS WRONG. check-error-spikes had no trigger anywhere -- no cron, no
 * page, no script -- and its admin-key check meant a header-less cron could
 * not have run it, while 20261004110000's notes say browser errors are mailed
 * to the owner by it. Had it been scheduled as it was, it would have mailed
 * the owner on ANY error in its window, every run.
 *
 * WHAT HOLDS NOW, by running the shipped handler (database and Resend faked)
 * and applying the schedule to pglite: the alerts cron key runs it and a wrong
 * one is refused; errors without a spike mail nobody; a spike mails once per
 * six-hour cooldown; a refused send is said, not called sent; and the job runs
 * every 15 minutes with the vault's alerts key.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { bootEmailOpsDb, migration, rows } from "./helpers/email-ops-db";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CRON = "a".repeat(64);
const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  ADMIN_EMAIL: "owner@example.com",
  RESEND_API_KEY: "re_harness",
  ADMIN_API_KEY: "admin-key-harness-0123456789",
};

let handler: EdgeHandler;
let mails: Array<Record<string, unknown>>;
let rpcs: string[];
let spike: boolean;
let doorOpen: boolean;
let resendStatus: number;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  handler = await loadEdgeHandler("check-error-spikes", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__spikeClient; }",
  });
}, 120_000);

beforeEach(() => {
  mails = [];
  rpcs = [];
  spike = false;
  doorOpen = true;
  resendStatus = 200;
  const recent = [{ error_type: "client", error_code: "UPLOAD_FAILED", error_message: "parse failed", function_name: "parse-pdf", visitor_id: "v1", created_at: new Date().toISOString() }];
  const query = { select: () => query, gte: () => query, order: () => query, limit: async () => ({ data: recent, error: null }) };
  (globalThis as Record<string, unknown>).__spikeClient = {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      rpcs.push(fn);
      if (fn === "alerts_cron_key_matches") return { data: a.p_key === CRON, error: null };
      if (fn === "detect_user_error_spikes") {
        return { data: [{ visitor_id: "v1", recent_error_count: spike ? 12 : 1, baseline_hourly_rate: 0.5, spike_multiplier: spike ? 96 : 1, recent_error_types: ["client"], last_error_at: new Date().toISOString(), is_spike: spike }], error: null };
      }
      if (fn === "mail_door_take") return { data: doorOpen, error: null };
      return { data: [], error: null };
    },
    from: () => query,
  };
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body: string }) => {
    mails.push({ url, ...JSON.parse(init.body) });
    return new Response("{}", { status: resendStatus });
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const run = (headers: Record<string, string>) =>
  handler(new Request("https://harness.supabase.co/functions/v1/check-error-spikes", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }));

describe("who may run it", () => {
  it("the alerts cron key runs it; a wrong or short key is refused and reads nothing", async () => {
    spike = true;
    expect((await run({ "x-alerts-cron": CRON })).status, "the scheduler's own key was refused, so nothing could ever run it").toBe(200);
    rpcs = [];
    expect((await run({ "x-alerts-cron": "b".repeat(64) })).status).toBe(401);
    expect((await run({ "x-alerts-cron": "short" })).status).toBe(401);
    expect((await run({ authorization: `Bearer ${env.ADMIN_API_KEY.slice(0, -1)}x` })).status).toBe(401);
    expect(rpcs.filter((f) => f !== "alerts_cron_key_matches")).toEqual([]);
  });
});

describe("what it mails", () => {
  it("errors without a spike mail nobody", async () => {
    const res = await run({ "x-alerts-cron": CRON });
    expect(await res.json()).toMatchObject({ recent_errors_count: 1, spikes_found: 0, mailed: false, mail_skipped: "no spike" });
    expect(mails, "every error in the window mailed the owner").toEqual([]);
  });

  it("a spike mails the owner once, and not again inside the cooldown", async () => {
    spike = true;
    expect(await (await run({ "x-alerts-cron": CRON })).json()).toMatchObject({ spikes_found: 1, mailed: true, mail_skipped: null });
    expect(mails).toHaveLength(1);
    expect(String(mails[0].subject)).toMatch(/^\[Error spike\] 1 visitor/);
    expect(String(mails[0].from)).not.toMatch(/ResumeBee/);
    doorOpen = false;
    expect(await (await run({ "x-alerts-cron": CRON })).json()).toMatchObject({ mailed: false, mail_skipped: "cooldown: a spike mail went out in the last 6 hours" });
    expect(mails).toHaveLength(1);
  });

  it("a send the provider refused is said, not called sent", async () => {
    spike = true;
    resendStatus = 403;
    expect(await (await run({ "x-admin-key": env.ADMIN_API_KEY })).json()).toMatchObject({ mailed: false, mail_skipped: "send refused: HTTP 403" });
  });
});

describe("the schedule, applied to pglite (20261008128000)", () => {
  it("runs every 15 minutes with the vault's alerts key, and is safe to re-run", async () => {
    const pg = await bootEmailOpsDb({ cron: true, apply: ["20261008128000"] });
    await pg.exec(migration("20261008128000"));
    const jobs = await rows<{ schedule: string; command: string }>(pg, "SELECT schedule, command FROM cron.job WHERE jobname = 'check-error-spikes'");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe("7-59/15 * * * *");
    expect(jobs[0].command).toMatch(/'x-alerts-cron', \(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name = 'alerts_cron_key'/);
    expect(jobs[0].command).toContain("/functions/v1/check-error-spikes'");
  }, 60_000);
});
