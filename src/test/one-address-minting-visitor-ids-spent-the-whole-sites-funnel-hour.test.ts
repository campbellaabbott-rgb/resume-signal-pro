// @vitest-environment node
/**
 * ONE ADDRESS MINTING VISITOR IDS SPENT THE WHOLE SITE'S FUNNEL HOUR (review
 * of wave3/email-ops, 2026-10-10, on S8-019).
 *
 * WHAT WAS WRONG. track-ab-event's tiers ran in the order visitor (keyed on
 * the id the caller chooses), site (client_write_allowed's one bucket of
 * 20,000 an hour), then the writer, whose address ceiling (1,800 an hour) was
 * the only bound on one address. A script on one address that sent a fresh
 * visitor id each time passed the visitor tier and spent the site's bucket on
 * every call, including the calls the address ceiling then refused. About
 * 20,000 calls in an hour refused every real visitor's funnel event, answered
 * 200 {status: 'rate_limited_global'}.
 *
 * WHAT HOLDS NOW, driving the shipped budget with RPCs that count as the SQL
 * does: after a 20,000-call flood from one address, a visitor at another
 * address is recorded, and the flood spent at most one address ceiling of the
 * site's hour. The shipped handler hands the address tier a keyed hash, the
 * same for one address and different for another, never the address.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, type Query } from "./helpers/proxy-db";
import {
  ADDRESS_CEILING_PER_HOUR,
  GLOBAL_CEILING_PER_HOUR,
  recordEvent,
  type Rpc,
} from "../../supabase/functions/track-ab-event/budget";

/** Fixed-hour counters standing in for check_rate_limit, mail_door_take, client_write_allowed and the writer's limiter. */
function countingRpc() {
  const n = new Map<string, number>();
  const take = (k: string) => { const v = (n.get(k) ?? 0) + 1; n.set(k, v); return v; };
  const rpc: Rpc = async (fn, a) => {
    if (fn === "check_rate_limit") return { data: take(`visitor:${a.p_ip}`) <= Number(a.p_max_requests), error: null };
    if (fn === "mail_door_take") return { data: take(`door:${a.p_door}:${a.p_bucket}`) <= Number(a.p_max), error: null };
    // Called from the edge function, its per-address bucket is the function's
    // own egress: one bucket held to the ceiling, i.e. the '*' bucket.
    if (fn === "client_write_allowed") return { data: take("site") <= Number(a.p_ceiling), error: null };
    if (fn === "track_ab_event_optimized") {
      const status = take(`writer:${a.p_client_ip}`) > Number(a.p_max_requests) ? "rate_limited" : "recorded";
      return { data: { success: true, status }, error: null };
    }
    return { data: null, error: { message: `unscripted ${fn}` } };
  };
  return { rpc, spent: (k: string) => n.get(k) ?? 0 };
}

const event = (visitorId: string, clientIp: string, addressBucket: string) => ({
  testName: "conversion_funnel", variant: "landing_view", eventType: "view", visitorId, metadata: {}, clientIp, addressBucket,
});

describe("one address cannot spend the site's hour", () => {
  it("after 20,000 calls from one address with a fresh visitor id each, a visitor elsewhere is still recorded", async () => {
    const { rpc, spent } = countingRpc();
    for (let i = 0; i < GLOBAL_CEILING_PER_HOUR; i++) {
      await recordEvent(rpc, event(`flood-${String(i).padStart(8, "0")}`, "198.51.100.66", "bucket-of-198.51.100.66"));
    }
    expect(spent("site"), "one address spent more than its ceiling of the site's hour").toBeLessThanOrEqual(ADDRESS_CEILING_PER_HOUR);
    const real = await recordEvent(rpc, event("8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e", "203.0.113.20", "bucket-of-203.0.113.20"));
    expect(real.status, "a real visitor's funnel event was refused by one address's flood").toBe("recorded");
  });
});

describe("the shipped handler names the address to its tier only as a keyed hash", () => {
  let track: EdgeHandler;
  const db = new ProxyDb();
  const doors: Array<Record<string, unknown>> = [];
  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc_harness" };
    g.Deno = { env: { get: (k: string) => env[k] } };
    g.__addrDb = db;
    db.answer = (q: Query) => {
      if (q.rpc === "mail_door_take") { doors.push(q.calls[0][1][0] as Record<string, unknown>); return { data: true, error: null }; }
      if (q.rpc === "check_rate_limit" || q.rpc === "client_write_allowed") return { data: true, error: null };
      if (q.rpc === "track_ab_event_optimized") return { data: { success: true, status: "recorded" }, error: null };
      return undefined;
    };
    track = await loadEdgeHandler("track-ab-event", {
      "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__addrDb; }",
    });
  }, 60_000);

  const post = (ip: string) => track(new Request("https://h.supabase.co/functions/v1/track-ab-event", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ testName: "conversion_funnel", variant: "landing_view", eventType: "view", visitorId: "8b2f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" }),
  }));

  it("one bucket per address, 32 hex, holding no part of the address", async () => {
    await post("198.51.100.66");
    await post("198.51.100.66");
    await post("203.0.113.20");
    expect(doors, "the address was never counted before the site").toHaveLength(3);
    const [a1, a2, b] = doors.map((d) => String(d.p_bucket));
    expect(a1).toMatch(/^[0-9a-f]{32}$/);
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    expect(doors[0]).toMatchObject({ p_max: ADDRESS_CEILING_PER_HOUR, p_window_minutes: 60 });
  });
});
