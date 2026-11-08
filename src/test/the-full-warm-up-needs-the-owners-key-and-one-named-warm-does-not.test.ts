// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild, which refuses jsdom's
// TextEncoder (see helpers/edge-harness.ts).
/**
 * THE FULL WARM-UP NEEDS THE OWNER'S KEY; ONE NAMED WARM DOES NOT (cost audit
 * 2026-11-08, Do first #13).
 *
 * warm-up answered the publishable key. A request naming no function invoked
 * every function on its list, so one stranger's request became sixteen and
 * more, from our own egress address. Now the untargeted mode answers only:
 *   - the owner's ADMIN_API_KEY, as the x-admin-key header or as the body's
 *     adminKey (which a page needs no new preflight for);
 *   - our own servers (the service-role key);
 *   - the cron key (x-email-cron, checked by the database);
 * and anyone else gets 401 admin_key_required before a single invocation.
 * The scan button's hover warm of one named function is unchanged and needs
 * no key; a name that is not on the list warms nothing (400), where it used
 * to fall through to the whole list.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
const ADMIN_KEY = "admin-harness-key-for-the-warm-up";
const CRON_KEY = "cron-harness-key-0123456789abcdef0123456789";

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient(_u, key) { const w = globalThis.__warmWorld; return { rpc: (n, a) => w.db.rpc(n, a), from: (t) => w.db.from(t), functions: { invoke: async (fn, opts) => { w.invoked.push({ fn, key, body: opts && opts.body }); return { data: {}, error: null }; } } }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
};

let handler: EdgeHandler;
let world: { db: FakeDb; invoked: Array<{ fn: string; key: string; body: unknown }> };

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ADMIN_API_KEY: ADMIN_KEY,
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("warm-up", STUBS);
}, 120_000);

beforeEach(() => {
  world = { db: new FakeDb({}), invoked: [] };
  world.db.rpcs.email_cron_key_matches = (a) => ({ data: (a as { p_key: string }).p_key === CRON_KEY, error: null });
  (globalThis as Record<string, unknown>).__warmWorld = world;
});

const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/warm-up", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", apikey: "anon_harness", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("the full warm-up refuses a stranger before anything is invoked", () => {
  for (const [what, body] of [["an empty body", {}], ["no body at all", undefined], ["a wrong admin key", { adminKey: "guess" }], ["an empty target", { target: "" }]] as const) {
    it(`${what}, with the publishable key: 401 admin_key_required and no invocation`, async () => {
      const r = await post(body);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("admin_key_required");
      expect(world.invoked).toEqual([]);
    });
  }

  it("a short or wrong cron key is refused too", async () => {
    for (const k of ["short", `${CRON_KEY}x`]) {
      const r = await post({}, { "x-email-cron": k });
      expect(r.status, k).toBe(401);
    }
    expect(world.invoked).toEqual([]);
  });
});

describe("the full warm-up still runs for the owner, our servers and the cron", () => {
  const ways: Array<[string, unknown, Record<string, string>]> = [
    ["the owner's key as x-admin-key", {}, { "x-admin-key": ADMIN_KEY }],
    ["the owner's key in the body", { adminKey: ADMIN_KEY }, {}],
    ["the service-role key", {}, { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }],
    ["the cron key", {}, { "x-email-cron": CRON_KEY }],
  ];
  for (const [who, body, headers] of ways) {
    it(`${who}: every listed function is warmed, none of them a retired one`, async () => {
      const r = await post(body, headers);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.success).toBe(true);
      const fns = world.invoked.map((i) => i.fn);
      expect(fns.length).toBe(16);
      expect(fns).toContain("free-keyword-scan");
      for (const gone of ["generate-summary", "generate-cover-letter-stream", "generate-tailored-resume-stream"]) expect(fns).not.toContain(gone);
      // Invoked with the publishable key, as a visitor's browser would.
      expect([...new Set(world.invoked.map((i) => i.key))]).toEqual(["anon_harness"]);
    });
  }
});

describe("one named warm is unchanged", () => {
  it("a listed target is warmed alone, with no key", async () => {
    const r = await post({ target: "free-keyword-scan" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, mode: "targeted", target: "free-keyword-scan" });
    expect(world.invoked.map((i) => i.fn)).toEqual(["free-keyword-scan"]);
  });

  it("a name off the list warms nothing (400), where it used to warm the whole list", async () => {
    for (const target of ["generate-summary", "job-board", "constructor"]) {
      const r = await post({ target });
      expect(r.status, target).toBe(400);
      expect(r.body.code).toBe("unknown_target");
    }
    expect(world.invoked).toEqual([]);
  });
});

describe("the preflight", () => {
  it("allows the owner's key header, carries the new build, and is kept two hours", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/warm-up", { method: "OPTIONS" }));
    const allow = String(res.headers.get("access-control-allow-headers")).split(",").map((h) => h.trim().toLowerCase());
    expect(allow).toContain("x-admin-key");
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "warm-up", "2026-11-09", 1), String(res.headers.get("x-fn-build"))).toBe(true);
  });
});
