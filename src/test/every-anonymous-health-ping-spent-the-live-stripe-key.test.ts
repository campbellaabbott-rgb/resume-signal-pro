// @vitest-environment node
/**
 * EVERY ANONYMOUS HEALTH PING SPENT THE LIVE STRIPE KEY (S8-061).
 *
 * WHAT WAS WRONG. health-check and scheduled-health-probe answer anyone
 * (verify_jwt false) and every POST called Stripe's balance endpoint with
 * the live key and the AI gateway; the probe also wrote a heartbeat row.
 * Stripe's read limit is account-wide, shared with purchase verification, so
 * a flood of free pings could starve real checkouts, and the answer carried
 * the providers' refusal text.
 *
 * WHAT HOLDS NOW, running both shipped handlers with their network faked:
 * anonymous health-checks share one live probe a minute and see no provider
 * text; the owner's key gets a live probe with its messages; an anonymous
 * probe touches neither provider and writes no heartbeat, while the owner's
 * does both.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";

const ADMIN = "admin_key_for_the_harness_0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov", STRIPE_SECRET_KEY: "sk_live_x", ADMIN_API_KEY: ADMIN };
let check: EdgeHandler;
let probe: EdgeHandler;
let stripeCalls = 0;
let aiCalls = 0;
let db: ProxyDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  db = new ProxyDb();
  g.__pingDb = db;
  g.fetch = async (url: string) => {
    if (String(url).includes("api.stripe.com")) { stripeCalls++; return new Response("{}", { status: 401 }); }
    if (String(url).includes("ai.gateway.lovable.dev")) { aiCalls++; return new Response("{}", { status: 400 }); }
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = { "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__pingDb;" };
  check = await loadEdgeHandler("health-check", stubs);
  probe = await loadEdgeHandler("scheduled-health-probe", stubs);
}, 60_000);

beforeEach(() => { stripeCalls = 0; aiCalls = 0; db.queries = []; });

const call = (h: EdgeHandler, fn: string, headers: Record<string, string> = {}) =>
  h(new Request(`https://h.supabase.co/functions/v1/${fn}`, { method: "POST", headers, body: "{}" })).then((r) => r.json());
const heartbeats = () => db.queries.filter((q) => q.rpc === "log_heartbeat_result");

describe("health-check", () => {
  it("fifty anonymous pings in a minute make one live probe, and none of them sees a provider's refusal text", async () => {
    const answers = await Promise.all(Array.from({ length: 50 }, () => call(check, "health-check")));
    expect(stripeCalls, "every anonymous ping called Stripe with the live key").toBe(1);
    expect(aiCalls).toBe(1);
    for (const a of answers) {
      expect(a.checks.stripe.status).toBe("error");
      expect(JSON.stringify(a.checks), "a stranger was shown the provider's refusal").not.toMatch(/refused|HTTP 401|secret key/i);
    }
  });

  it("the owner's key gets a live probe, every time, with the message", async () => {
    const a = await call(check, "health-check", { "x-admin-key": ADMIN });
    const b = await call(check, "health-check", { "x-admin-key": ADMIN });
    expect(stripeCalls).toBe(2);
    expect(a.checks.stripe.message).toMatch(/refused/);
    expect(b.checks.stripe.status).toBe("error");
  });
});

describe("scheduled-health-probe", () => {
  it("an anonymous probe calls no provider and writes no heartbeat", async () => {
    const j = await call(probe, "scheduled-health-probe");
    expect(stripeCalls + aiCalls, "an anonymous probe spent the live keys").toBe(0);
    expect(heartbeats(), "an anonymous probe wrote a heartbeat row").toHaveLength(0);
    expect(j.probes.map((p: { service: string }) => p.service)).toEqual(["database"]);
  });

  it("the owner's key runs the live probe and writes its heartbeat", async () => {
    await call(probe, "scheduled-health-probe", { "x-admin-key": ADMIN });
    await new Promise((r) => setTimeout(r, 0));
    expect(stripeCalls).toBe(1);
    expect(heartbeats()).toHaveLength(1);
  });
});
