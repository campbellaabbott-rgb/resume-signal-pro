// @vitest-environment node
/**
 * A REFUSED KEY IS NOT A HEALTHY SERVICE (wave 2 email-ops, register L13-67).
 *
 * WHAT WAS WRONG. health-check (the /health-check status card) and
 * scheduled-health-probe called Stripe's balance endpoint and threw the answer
 * away, and read a missing STRIPE_SECRET_KEY as healthy: a rolled or absent key
 * failed every checkout while the page said Stripe was fine. Their AI check
 * degraded only on a 5xx, so a 401 (a bad key) or a 402 (credits exhausted)
 * read healthy too.
 *
 * WHAT HOLDS NOW, by running both shipped handlers with the network faked:
 * only a 200 from Stripe passes; a missing key or a 401/402/403 from Stripe or
 * the AI gateway is an error; Stripe's own 5xx is "slow", not a key problem.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";

const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov", STRIPE_SECRET_KEY: "sk_live_x" };
let stripeStatus = 200;
let aiStatus = 400;
let check: EdgeHandler;
let probe: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__probeDb = new ProxyDb();
  g.fetch = async (url: string) => {
    if (String(url).includes("api.stripe.com")) return new Response("{}", { status: stripeStatus });
    if (String(url).includes("ai.gateway.lovable.dev")) return new Response("{}", { status: aiStatus });
    throw new Error(`unexpected fetch ${url}`);
  };
  const stubs = { "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__probeDb;" };
  check = await loadEdgeHandler("health-check", stubs);
  probe = await loadEdgeHandler("scheduled-health-probe", stubs);
}, 60_000);

beforeEach(() => { stripeStatus = 200; aiStatus = 400; env.STRIPE_SECRET_KEY = "sk_live_x"; env.LOVABLE_API_KEY = "lov"; });

const runCheck = async () => (await check(new Request("https://h.supabase.co/functions/v1/health-check", { method: "POST", body: "{}" }))).json();
const runProbe = async () => (await probe(new Request("https://h.supabase.co/functions/v1/scheduled-health-probe", { method: "POST", body: "{}" }))).json();
const probeOf = (j: { probes: Array<{ service: string; status: string; error?: string }> }, s: string) => j.probes.find((p) => p.service === s)!;

describe("health-check", () => {
  it("a working key and a working gateway are ok (the gateway's 400 is the probe's empty request)", async () => {
    const j = await runCheck();
    expect(j.checks.stripe.status).toBe("ok");
    expect(j.checks.ai_gateway.status).toBe("ok");
  });

  it("Stripe refusing the key, or no key at all, is an error -- never ok", async () => {
    for (const s of [401, 402, 403]) {
      stripeStatus = s;
      const j = await runCheck();
      expect(j.checks.stripe.status, `HTTP ${s}`).toBe("error");
      expect(j.status).toBe("degraded");
    }
    delete env.STRIPE_SECRET_KEY;
    expect((await runCheck()).checks.stripe).toMatchObject({ status: "error", message: "STRIPE_SECRET_KEY is not set" });
  });

  it("Stripe's own 5xx is slow, not a key problem", async () => {
    stripeStatus = 503;
    expect((await runCheck()).checks.stripe.status).toBe("slow");
  });

  it("the AI gateway refusing the key or out of credits is an error", async () => {
    for (const s of [401, 402]) {
      aiStatus = s;
      expect((await runCheck()).checks.ai_gateway.status, `HTTP ${s}`).toBe("error");
    }
  });
});

describe("scheduled-health-probe", () => {
  it("a refused or missing Stripe key and a refused AI key are unhealthy", async () => {
    stripeStatus = 401;
    expect(probeOf(await runProbe(), "stripe").status).toBe("unhealthy");
    delete env.STRIPE_SECRET_KEY;
    expect(probeOf(await runProbe(), "stripe").status).toBe("unhealthy");
    env.STRIPE_SECRET_KEY = "sk_live_x";
    stripeStatus = 200;
    aiStatus = 402;
    expect(probeOf(await runProbe(), "ai-gateway")).toMatchObject({ status: "unhealthy", error: "AI credits exhausted (HTTP 402)" });
    aiStatus = 400;
    const ok = await runProbe();
    expect(probeOf(ok, "stripe").status).toBe("healthy");
    expect(probeOf(ok, "ai-gateway").status).toBe("healthy");
  });
});
