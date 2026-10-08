// @vitest-environment node
/**
 * AN OPERATIONS READER ANSWERS THE ADMIN KEY AND NOBODY ELSE.
 *
 * WHAT WAS WRONG. /health-check and /scan-metrics sat behind a lock screen
 * that only hid the page: the panels called nineteen SECURITY DEFINER readers
 * with supabase.rpc and the publishable key, and so could anyone else. Four of
 * them returned buyers' emails, Stripe checkout session ids (the bearer token
 * for purchased content), payment_intent ids and visitor ids. Migration
 * 20261004110000 closed all nineteen to anon and authenticated; the dashboards
 * now go through admin-ops.
 *
 * WHAT THIS HOLDS, against the shipped handler with only its network faked
 * (helpers/edge-harness):
 *   - the preflight carries x-fn-build and allows the x-admin-key header (a
 *     preflight that refuses the header would blank every panel);
 *   - no key, a wrong key, and an unset ADMIN_API_KEY with an empty header are
 *     401 and call NOTHING;
 *   - the right key with a function off the list -- add_scan_credits, the
 *     prune job -- is 400 and calls nothing: the admin key is not a way to run
 *     arbitrary service-role functions;
 *   - an argument that is not a p_ name is refused;
 *   - the right key and a listed reader calls it once, with the service-role
 *     client and the caller's arguments, and returns its rows;
 *   - a database error is a 502 that names the error, not an empty success;
 *   - the frontend helper sends the stored key and keeps supabase.rpc's shape.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2":
    "export function createClient(url, key) { globalThis.__opsClients.push(key); return globalThis.__opsDb; }",
};

const env: Record<string, string> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness",
  SUPABASE_ANON_KEY: "anon_harness",
  ADMIN_API_KEY: "admin-key-harness-0123456789",
};

let handler: EdgeHandler;
let db: FakeDb;
let calls: Array<{ fn: string; args: Record<string, unknown> }>;
let clients: string[];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  handler = await loadEdgeHandler("admin-ops", STUBS);
}, 120_000);

beforeEach(() => {
  env.ADMIN_API_KEY = "admin-key-harness-0123456789";
  calls = [];
  clients = [];
  db = new FakeDb();
  const record = (fn: string) => (args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: [{ total_orders: 3, recent_failures: [] }], error: null };
  };
  db.rpcs.get_delivery_health = record("get_delivery_health");
  db.rpcs.get_payment_health = record("get_payment_health");
  db.rpcs.add_scan_credits = record("add_scan_credits");
  const g = globalThis as Record<string, unknown>;
  g.__opsDb = db;
  g.__opsClients = clients;
});

async function ask(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/admin-ops", {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
  return { res, status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

describe("admin-ops", () => {
  it("answers the preflight with its build and allows the admin header", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/admin-ops", { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fn-build")).toMatch(/^admin-ops\.\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(res.headers.get("access-control-allow-headers") ?? "").toMatch(/x-admin-key/);
  });

  it("refuses a caller without the key, with the wrong key, or a padded key, and calls nothing", async () => {
    for (const headers of [{}, { "x-admin-key": "wrong" }, { "x-admin-key": `${env.ADMIN_API_KEY}x` }, { "x-admin-key": env.ADMIN_API_KEY.slice(0, -1) }]) {
      const r = await ask({ fn: "get_delivery_health", args: { p_hours_back: 24 } }, headers);
      expect(r.status, JSON.stringify(headers)).toBe(401);
    }
    // The publishable key in the Authorization header is not the admin key.
    expect((await ask({ fn: "get_delivery_health" }, { authorization: `Bearer ${env.ADMIN_API_KEY}` })).status).toBe(401);
    expect(calls).toEqual([]);
    expect(clients, "no client may be built before the key is checked").toEqual([]);
  });

  it("an unset ADMIN_API_KEY locks the door rather than opening it to an empty header", async () => {
    env.ADMIN_API_KEY = "";
    expect((await ask({ fn: "get_delivery_health" }, { "x-admin-key": "" })).status).toBe(401);
    expect((await ask({ fn: "get_delivery_health" })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("the right key cannot run a function off the list", async () => {
    const k = { "x-admin-key": env.ADMIN_API_KEY };
    for (const fn of ["add_scan_credits", "roll_up_and_prune_closures", "", "get_delivery_health; drop table x"]) {
      const r = await ask({ fn, args: {} }, k);
      expect(r.status, fn).toBe(400);
    }
    expect((await ask({ fn: "get_delivery_health", args: { hours: 1 } }, k)).status).toBe(400);
    expect((await ask({ fn: "get_delivery_health", args: [1] }, k)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("the right key and a listed reader calls it once with the service role and returns its rows", async () => {
    const r = await ask({ fn: "get_delivery_health", args: { p_hours_back: 24 } }, { "x-admin-key": env.ADMIN_API_KEY });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([{ total_orders: 3, recent_failures: [] }]);
    expect(calls).toEqual([{ fn: "get_delivery_health", args: { p_hours_back: 24 } }]);
    expect(clients).toEqual(["service_harness"]);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
  });

  it("the owner's catalogue reader answers the admin key with the service role, and nobody without it", async () => {
    // client_callable_unlisted_names (20261008141000) names the definers the
    // census only counts; it was not a function admin-ops would call.
    const unlisted = { unlisted: [{ signature: "public.stray_reader(integer)", anon: true, authenticated: true }], agrees: true };
    db.rpcs.client_callable_unlisted_names = (args) => { calls.push({ fn: "client_callable_unlisted_names", args }); return { data: unlisted, error: null }; };
    expect((await ask({ fn: "client_callable_unlisted_names" })).status).toBe(401);
    expect((await ask({ fn: "client_callable_unlisted_names" }, { "x-admin-key": "wrong" })).status).toBe(401);
    expect(calls).toEqual([]);
    const r = await ask({ fn: "client_callable_unlisted_names" }, { "x-admin-key": env.ADMIN_API_KEY });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(unlisted);
    expect(calls).toEqual([{ fn: "client_callable_unlisted_names", args: {} }]);
    expect(clients).toEqual(["service_harness"]);
    // A neighbouring catalogue name it does not list is still refused.
    expect((await ask({ fn: "client_callable_census" }, { "x-admin-key": env.ADMIN_API_KEY })).status).toBe(400);
  });

  it("a database error is a 502 that names it, not an empty success", async () => {
    db.rpcs.get_payment_health = () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const r = await ask({ fn: "get_payment_health", args: { p_hours_back: 24 } }, { "x-admin-key": env.ADMIN_API_KEY });
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toMatch(/statement timeout/);
  });
});

describe("the dashboards' helper", () => {
  it("sends the stored key and the call as {fn, args}, and keeps supabase.rpc's {data, error} shape", async () => {
    vi.resetModules();
    const invoke = vi.fn(async () => ({ data: { data: [{ total_orders: 1 }] }, error: null }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
    const store: Record<string, string> = { admin_dashboard_key: "k-from-the-gate" };
    (globalThis as Record<string, unknown>).sessionStorage = {
      getItem: (k: string) => store[k] ?? null, setItem: () => undefined, removeItem: () => undefined,
    };
    const { adminRpc } = await import("@/lib/admin-auth");
    const r = await adminRpc("get_delivery_health", { p_hours_back: 24 });
    expect(r).toEqual({ data: [{ total_orders: 1 }], error: null });
    expect(invoke).toHaveBeenCalledWith("admin-ops", {
      body: { fn: "get_delivery_health", args: { p_hours_back: 24 } },
      headers: { "x-admin-key": "k-from-the-gate" },
    });

    invoke.mockResolvedValueOnce({ data: null, error: { message: "Edge Function returned a non-2xx status code" } } as never);
    expect((await adminRpc("get_payment_health", { p_hours_back: 24 })).error?.message).toMatch(/non-2xx/);
    invoke.mockResolvedValueOnce({ data: { error: "not an operations reader: x" }, error: null } as never);
    expect((await adminRpc("get_payment_health", { p_hours_back: 24 })).data).toBeNull();
    vi.doUnmock("@/integrations/supabase/client");
  });
});
