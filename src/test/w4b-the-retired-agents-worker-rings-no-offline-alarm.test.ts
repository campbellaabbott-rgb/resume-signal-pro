// @vitest-environment node
/**
 * THE RETIRED AGENT'S WORKER RINGS NO OFFLINE ALARM (S12-171, second half;
 * account-compliance's handoff, applied at integration).
 *
 * WHAT WAS WRONG. The server-side apply agent is switched off (wave 4, owner
 * decision 2026-10-11: APPLY_AGENT_ON is false), so its worker is meant to be
 * down. scan-heartbeat still read agent_sender_state on every run, and an
 * active mandate left behind made the state "offline-with-work-outstanding":
 * the owner was mailed "Apply worker offline" every six hours for a machine
 * nobody should run.
 *
 * WHAT HOLDS NOW, running the shipped handler with its network faked: while
 * the switch is off the worker's state is not read, nothing is mailed, and the
 * response says why (reason "switched-off"). Control: with the switch stubbed
 * on, the same database rings the alarm as before.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const SERVICE = "service_role_key_for_the_harness_0123456789abcdef";
const env: Record<string, string> = {
  SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon",
  LOVABLE_API_KEY: "lov", RESEND_API_KEY: "re_x", ADMIN_API_KEY: "admin_key_0123456789", HEARTBEAT_SECRET: "hb",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAIL: "owner@example.com",
};
type Call = { url: string; body: Record<string, unknown> | null };
const fetched: Call[] = [];
let pending: Promise<unknown>[] = [];
let off: EdgeHandler;
let on: EdgeHandler;
let db: ProxyDb;

const okJson = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const STUBS = {
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__hbDb; }",
};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  g.fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = null; }
    fetched.push({ url: u, body });
    if (u.includes("api.resend.com")) return okJson({ id: "em" });
    if (u.includes("api.stripe.com")) return okJson({ object: "balance" });
    if (u.includes("ai.gateway.lovable.dev")) return okJson({ choices: [{ message: { content: "{\"industry\":\"tech\",\"atsScore\":70}" } }] });
    if (u.includes("/functions/v1/free-keyword-scan")) return okJson({ atsScoreEstimate: 71, reportMeta: { reportId: "R1" } });
    if (u.includes("/functions/v1/job-board")) return okJson(body?.action === "vendor-health" ? { drifted: [], unreachable: [] } : { jobs: [], total: 0 });
    return okJson({});
  };
  off = await loadEdgeHandler("scan-heartbeat", STUBS);
  on = await loadEdgeHandler("scan-heartbeat", {
    ...STUBS,
    "_shared/apply-agent-switch.ts": "export const APPLY_AGENT_ON = true; export const AGENT_PRODUCTS_ON_SALE = false; export const APPLY_ASSISTANT_ON_SALE = false;",
  });
});

beforeEach(() => {
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    // A worker last seen two days ago with a mandate still active.
    if (q.rpc === "agent_sender_state") {
      return { data: [{ ever_seen: true, last_seen: new Date(Date.now() - 2 * 86_400_000).toISOString(), offline_seconds: 2 * 86_400, active_mandates: 1, pending_packets: 0 }], error: null };
    }
    if (q.rpc === "product_delivery_health") return { data: [], error: null };
    if (q.rpc === "email_delivery_health") return { data: [], error: null };
    if (q.rpc === "get_email_health") return { data: [], error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__hbDb = db;
});

afterEach(() => { fetched.length = 0; pending = []; });

const run = async (handler: EdgeHandler) => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/scan-heartbeat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` }, body: "{}",
  }));
  const j = await res.json();
  await Promise.allSettled(pending);
  pending = [];
  return j;
};
const offlineMails = () => fetched.filter((f) => f.url.includes("api.resend.com") && /Apply worker offline/i.test(String(f.body?.subject ?? "")));
const senderReads = () => db.queries.filter((q) => q.rpc === "agent_sender_state");

describe("the apply worker's offline alarm", () => {
  it("while the agent is switched off: the worker's state is not read, nothing is mailed, and the response says why", async () => {
    const j = await run(off);
    expect(offlineMails(), "the retired agent's worker rang the owner").toHaveLength(0);
    expect(senderReads()).toHaveLength(0);
    expect(j.senderState).toEqual({ reason: "switched-off", shouldAlert: false });
  });

  it("control: with the switch on, the same worker rings the alarm", async () => {
    const j = await run(on);
    expect(j.senderState?.reason).toBe("offline-with-work-outstanding");
    expect(offlineMails()).toHaveLength(1);
  });
});
