// @vitest-environment node
/**
 * THE FUNNEL TOOK ANY SIZE FROM ANY ADDRESS, AND REFUSED EVERY CRASH
 * (S8-019, S8-121, S8-123 on the server).
 *
 * WHAT WAS WRONG.
 *   S8-019  track-ab-event keyed its only flood bound (the address tier) on
 *           the FIRST X-Forwarded-For hop, which the caller writes, stored
 *           metadata of any size, and had no bound on the site as a whole.
 *   S8-121  The error boundaries' events were refused with a 400 (variant
 *           over 30 characters).
 *   S8-123  The dashboard grouped milestones by variant, so once the page
 *           rides in the variant it must still count 25% as 25%.
 *
 * WHAT HOLDS NOW, running the shipped handlers with their database faked: the
 * crash event the boundary now sends is accepted; the address tier is keyed
 * on the platform's address; a body over the metadata cap is refused before
 * any write; the site's hour refuses once full; and get-analytics folds
 * "pricing:25%" into pricing's 25% bucket.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Answer, type Query } from "./helpers/proxy-db";

const SERVICE = "svc";
const ADMIN = "admin_key_0123456789abcdef";
let track: EdgeHandler;
let analytics: EdgeHandler;
let db: ProxyDb;
let siteFull = false;
let events: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ rpc: string; args: Record<string, unknown> }> = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, ADMIN_API_KEY: ADMIN };
  g.Deno = { env: { get: (k: string) => env[k] } };
  const stubs = {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__funnelDb; }",
  };
  track = await loadEdgeHandler("track-ab-event", stubs);
  analytics = await loadEdgeHandler("get-analytics", stubs);
}, 60_000);

beforeEach(() => {
  siteFull = false; events = []; rpcCalls.length = 0;
  db = new ProxyDb();
  db.answer = (q: Query): Answer | undefined => {
    if (q.rpc) {
      const args = (q.calls.find(([m]) => m === "rpc")?.[1][0] ?? {}) as Record<string, unknown>;
      rpcCalls.push({ rpc: q.rpc, args });
    }
    if (q.rpc === "check_rate_limit") return { data: true, error: null };
    if (q.rpc === "client_write_allowed") return { data: !siteFull, error: null };
    if (q.rpc === "track_ab_event_optimized") return { data: { success: true, status: "recorded" }, error: null };
    if (q.table === "ab_test_events") return { data: events, error: null };
    return undefined;
  };
  (globalThis as Record<string, unknown>).__funnelDb = db;
});

const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  track(new Request("https://h.supabase.co/functions/v1/track-ab-event", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const crash = {
  testName: "client_error", variant: "app", eventType: "view", visitorId: "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
  metadata: { message: "Cannot read properties of undefined (reading 'map')", stack: "s".repeat(600), componentStack: "c\n".repeat(300), path: "/jobs" },
};
const writes = () => rpcCalls.filter((c) => c.rpc === "track_ab_event_optimized");

describe("track-ab-event", () => {
  it("accepts the crash event the boundaries now send", async () => {
    const res = await post(crash, { "cf-connecting-ip": "198.51.100.4" });
    expect(res.status, "the owner's crash telemetry is refused").toBe(200);
    expect(writes()).toHaveLength(1);
  });

  it("keys the address tier on the platform's address, never the caller's first hop", async () => {
    await post(crash, { "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(writes()[0].args.p_client_ip, "a forged first hop is a fresh allowance").toBe("203.0.113.9");
  });

  it("refuses metadata over the cap before any write", async () => {
    const res = await post({ ...crash, metadata: { blob: "x".repeat(5000) } }, { "cf-connecting-ip": "198.51.100.4" });
    expect(res.status).toBe(400);
    expect(rpcCalls, "an oversized body reached the database").toEqual([]);
  });

  it("refuses once the site's hour is full, whatever the address or visitor", async () => {
    siteFull = true;
    const res = await post({ ...crash, visitorId: "11111111-2222-4333-8444-555555555555" }, { "cf-connecting-ip": "192.0.2.77" });
    expect(await res.json()).toMatchObject({ success: true, status: "rate_limited_global" });
    expect(writes()).toEqual([]);
    const site = rpcCalls.find((c) => c.rpc === "client_write_allowed")!;
    expect(site.args).toMatchObject({ p_scope: "track-ab-event:global", p_window_minutes: 60 });
  });
});

describe("get-analytics counts a milestone whose page rides in its variant", () => {
  it("'pricing:25%' and an older '25%' with page metadata both count as pricing's 25%", async () => {
    const at = "2026-10-09T12:00:00Z";
    events = [
      { id: "1", test_name: "scroll_depth", variant: "pricing:25%", event_type: "view", metadata: { page: "pricing" }, created_at: at, visitor_id: "v1" },
      { id: "2", test_name: "scroll_depth", variant: "25%", event_type: "view", metadata: { page: "pricing" }, created_at: at, visitor_id: "v2" },
      { id: "3", test_name: "scroll_depth", variant: "home:25%", event_type: "view", metadata: { page: "home" }, created_at: at, visitor_id: "v1" },
    ];
    const res = await analytics(new Request("https://h.supabase.co/functions/v1/get-analytics", {
      method: "POST", headers: { "content-type": "application/json", "x-admin-key": ADMIN },
      body: JSON.stringify({ startDate: "2026-10-01", endDate: "2026-10-10", pageFilter: "all" }),
    }));
    expect(res.status).toBe(200);
    const j = await res.json();
    const pricing = (j.pageMetrics.pricing.scrollDepth as Array<{ variant: string; views: number }>);
    expect(pricing.find((r) => r.variant === "25%")?.views).toBe(2);
    expect(pricing.some((r) => r.variant.includes(":"))).toBe(false);
    expect((j.scrollDepth as Array<{ variant: string; views: number }>).find((r) => r.variant === "25%")?.views).toBe(3);
  });
});
