// @vitest-environment node
/**
 * A FREELANCE PROFILE IS IMPORTED ONLY FOR A FREELANCE BUYER (S14 hotfix,
 * lane spend, M-S14-058).
 *
 * WHAT WAS WRONG. import-freelance-profile, the "import from your profile"
 * helper on the Freelance Boost page, checked no purchase: anyone holding
 * the publishable key got ten model extractions a day per address and a
 * hundred an hour site-wide, on the project's key, for a product that is no
 * longer sold.
 *
 * WHAT HOLDS NOW (the shipped handler; the database and the model faked):
 *   - no session, a made-up one, another product's claim, and an unnamed
 *     claim the gate rules out are answered 402 before anything is counted
 *     and before any model call;
 *   - a Freelance Boost or Transition Pro claim, an older buyer's unnamed
 *     claim, and a Pro member's grant for one whose account may still redeem
 *     it reach the model, counted by address and by purchase, with no
 *     function-wide ceiling for strangers to exhaust;
 *   - a grant for another product, a withdrawn grant, and a grant whose
 *     account has lapsed are refused; a grant that could not be read is a
 *     503, never a pass.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__s14ImportDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const PROFILE = "Freelance UX designer on Upwork since 2021. Redesigned a dental practice's booking site in Figma; bookings doubled in three months. ".repeat(2);
const MEMBER = "9b1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const GRANT = "0c8f3a2e-5d4b-4e1a-9f6c-7b2d1e0a3c4f";
const OTHER_GRANT = "1d9e4b3f-6e5c-4f2b-8a7d-8c3e2f1b4d5a";
const REVOKED_GRANT = "2e0f5c4a-7f6d-4a3c-9b8e-9d4f3a2c5e6b";
const LEGACY = "2026-08-01T00:00:00Z";
const AFTER_NAMING = "2026-09-01T00:00:00Z";

let handler: EdgeHandler;
let db: FakeDb;
let aiCalls: number;
let rateCalls: Array<{ p_ip: string; p_max_requests: number; p_window_minutes: number }>;
let memberRows: unknown[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef", LOVABLE_API_KEY: "lovable" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("import-freelance-profile", {
    "https://deno.land/std@0.190.0/http/server.ts": SERVE,
    "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  });
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  aiCalls = 0;
  rateCalls = [];
  memberRows = [{ tier: "pro", status: "active", current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(), bound: true }];
  (globalThis as Record<string, unknown>).__s14ImportDb = db;
  db.rpcs.check_rate_limit = (a) => { rateCalls.push(a as (typeof rateCalls)[number]); return { data: true, error: null }; };
  db.rpcs.pro_entitlement_rows = (a) => ({ data: a.p_user_id === MEMBER ? memberRows : [], error: null });
  db.rows("used_stripe_sessions").push(
    { session_id: "cs_live_boost", product_type: "freelance_boost", ip_address: null, used_at: AFTER_NAMING },
    { session_id: "cs_live_transition", product_type: "freelance_transition_pro", ip_address: null, used_at: AFTER_NAMING },
    { session_id: "cs_live_scanpack", product_type: "scan_pack", ip_address: "203.0.113.9", used_at: AFTER_NAMING },
    { session_id: "cs_live_older_buyer", product_type: null, ip_address: null, used_at: LEGACY },
    { session_id: "cs_live_unnamed_late", product_type: null, ip_address: null, used_at: AFTER_NAMING },
    { session_id: "cs_live_unnamed_addressed", product_type: null, ip_address: "unknown", used_at: LEGACY },
  );
  db.rows("pro_grants").push(
    { id: GRANT, product_type: "freelance_boost", user_id: MEMBER, revoked_at: null },
    { id: OTHER_GRANT, product_type: "cover_letter", user_id: MEMBER, revoked_at: null },
    { id: REVOKED_GRANT, product_type: "freelance_boost", user_id: MEMBER, revoked_at: "2026-10-01T00:00:00Z" },
  );
});

async function importWith(sessionId: unknown, profileText = PROFILE) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/import-freelance-profile", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", apikey: "anon_harness", "cf-connecting-ip": "198.51.100.40" },
    body: JSON.stringify(sessionId === undefined ? { profileText } : { profileText, sessionId }),
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.json() as Record<string, unknown>; } catch { /* not json */ }
  return { status: res.status, json };
}

describe("a caller who bought no Freelance Boost spends nothing", () => {
  for (const [what, sessionId] of [
    ["no session at all", undefined],
    ["a session id nobody claimed", "cs_live_never_paid"],
    ["a $2 scan pack's claim", "cs_live_scanpack"],
    ["an unnamed claim written after claims named their product", "cs_live_unnamed_late"],
    ["an unnamed claim with an address beside it", "cs_live_unnamed_addressed"],
    ["a Pro grant for another product", `pro_${OTHER_GRANT}`],
    ["a withdrawn Pro grant", `pro_${REVOKED_GRANT}`],
    ["a pro_ id that is not a grant id", "pro_../../etc"],
  ] as const) {
    it(`${what}: 402, nothing counted, no model call`, async () => {
      const r = await importWith(sessionId);
      expect(r.status, JSON.stringify(r.json)).toBe(402);
      expect(r.json.requiresPurchase).toBe(true);
      expect(rateCalls, "a caller who bought nothing spent a slot").toEqual([]);
      expect(aiCalls, "a caller who bought nothing reached the model").toBe(0);
    });
  }

  it("a Pro grant whose account no longer holds a paid plan: 402, no model call", async () => {
    memberRows = [{ tier: "pro", status: "canceled", current_period_end: "2026-09-01T00:00:00Z", bound: true }];
    const r = await importWith(`pro_${GRANT}`);
    expect(r.status).toBe(402);
    expect(aiCalls).toBe(0);
  });

  it("a grant that could not be read is a 503 to retry, never a pass", async () => {
    db.faults.push({ table: "pro_grants", op: "select", error: { message: "timeout" } });
    const r = await importWith(`pro_${GRANT}`);
    expect(r.status).toBe(503);
    expect(aiCalls).toBe(0);
  });

  it("a profile too short to read is answered 400 before any purchase is looked up", async () => {
    const r = await importWith("cs_live_boost", "too short");
    expect(r.status).toBe(400);
    expect(rateCalls).toEqual([]);
  });
});

describe("a Freelance Boost buyer imports as before", () => {
  for (const [what, sessionId] of [
    ["a Freelance Boost claim", "cs_live_boost"],
    ["a Transition Pro claim", "cs_live_transition"],
    ["an older buyer's unnamed claim (no address, before products were named)", "cs_live_older_buyer"],
    ["a Pro member's Freelance Boost grant", `pro_${GRANT}`],
  ] as const) {
    it(`${what} reaches the model, counted by address and by purchase, with no function-wide ceiling`, async () => {
      const r = await importWith(sessionId);
      expect(r.status, JSON.stringify(r.json)).not.toBe(402);
      expect(aiCalls, "the buyer never reached the model").toBeGreaterThan(0);
      expect(rateCalls.filter((a) => a.p_ip === "global"), "a purchase-gated tool kept a ceiling strangers could exhaust").toEqual([]);
      expect(rateCalls.some((a) => a.p_ip === "198.51.100.40" && a.p_max_requests === 10 && a.p_window_minutes === 1440)).toBe(true);
      expect(rateCalls.some((a) => a.p_ip.startsWith("sess:") && a.p_max_requests === 10 && a.p_window_minutes === 1440)).toBe(true);
    });
  }

  it("the preflight answers the build that carries this", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/import-freelance-profile", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "import-freelance-profile", "2026-11-10", 1)).toBe(true);
  });
});
