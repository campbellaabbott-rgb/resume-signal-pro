// @vitest-environment node
/**
 * THE SUCCESS-PAGE REPAIR GRANTS NO RETIRED PASS (recheck 3 of wave 4,
 * 2026-10-26).
 *
 * The Agent Pass is no longer sold (AGENT_PRODUCTS_ON_SALE is false). A pass
 * checkout opened before the cut and paid after it reaches stripe-webhook,
 * which grants nothing, records the sale undeliverable_retired and mails the
 * owner that no pass was granted. agent-pass-status was left unchanged, and
 * its success-page repair called agent_pass_grant for any paid pass session
 * of the caller's: six hours, ten applications, 300 requests a minute, 10,000
 * a day and the 1,000-a-day fit allowance, for a product the owner was told
 * was not delivered. The shipped handler runs here with only Stripe and the
 * database faked: with the switch as it ships the repair is a terminal
 * "retired" and the grant is never called; with the products back on sale it
 * grants as before.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { APPLY_AGENT_SWITCH_ON } from "./helpers/apply-agent-switch-on";

const BUYER = "11111111-1111-1111-1111-111111111111";
const SESSION = "cs_live_retiredpass000000000001";
const env: Record<string, string | undefined> = {
  SUPABASE_URL: "https://harness.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_harness_key",
  SUPABASE_ANON_KEY: "anon_harness_key",
  STRIPE_SECRET_KEY: "sk_live_harness",
};
const g = globalThis as Record<string, unknown>;
let calls: Array<{ name: string; args: unknown }> = [];

const CLIENT = `export function createClient(url, key, opts) {
  const log = globalThis.__repairCalls;
  const chain = (answer) => new Proxy(function () {}, {
    get: (_x, p) => {
      if (p === "then") return (ok) => ok({ data: answer, error: null });
      if (typeof p === "symbol") return undefined;
      return () => chain(answer);
    },
  });
  const bearer = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\\s+/i, "");
  return {
    from: () => chain(null),
    rpc: (name, args) => { log.push({ name, args }); return chain(name === "agent_pass_grant" ? { granted_ok: true, grant_reason: "granted" } : null); },
    auth: {
      getUser: async () => bearer === "jwt-buyer"
        ? { data: { user: { id: "${BUYER}", email: "buyer@example.org" } }, error: null }
        : { data: { user: null }, error: { message: "no session" } },
    },
  };
}`;
const STRIPE = `export default class Stripe {
  constructor() {
    this.checkout = { sessions: { retrieve: async (id) => ({
      id, payment_status: "paid", mode: "payment", amount_total: 2900,
      metadata: { product_type: "agent_pass", user_id: "${BUYER}" },
      client_reference_id: "${BUYER}", payment_intent: "pi_retiredpass1",
    }) } };
  }
}`;
const STUBS: Record<string, string> = {
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0": STRIPE,
};

let shipped: EdgeHandler;
let onSale: EdgeHandler;
beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  shipped = await loadEdgeHandler("agent-pass-status", STUBS);
  onSale = await loadEdgeHandler("agent-pass-status", { ...STUBS, ...APPLY_AGENT_SWITCH_ON });
}, 240_000);
beforeEach(() => {
  calls = [];
  g.__repairCalls = calls;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
});

const repair = (h: EdgeHandler, how: "GET" | "POST") => h(new Request(
  how === "GET" ? `https://harness.supabase.co/functions/v1/agent-pass-status?session_id=${SESSION}` : "https://harness.supabase.co/functions/v1/agent-pass-status",
  { method: how, headers: { authorization: "Bearer jwt-buyer", "content-type": "application/json" }, ...(how === "POST" ? { body: JSON.stringify({ session_id: SESSION }) } : {}) },
));

describe("agent-pass-status, with the Agent Pass off sale as it ships", () => {
  for (const how of ["GET", "POST"] as const) {
    it(`a ${how} naming a paid pass session grants nothing and answers a terminal 'retired'`, async () => {
      const res = await repair(shipped, how);
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j).toMatchObject({ repair: "retired", repairTerminal: true, agentSwitchedOff: true });
      expect(calls.filter((c) => c.name === "agent_pass_grant"), JSON.stringify(calls)).toEqual([]);
    });
  }

  it("the preflight carries the new build", async () => {
    const pre = await shipped(new Request("https://harness.supabase.co/functions/v1/agent-pass-status", { method: "OPTIONS" }));
    expect(pre.headers.get("x-fn-build")).toBe("agent-pass-status.2026-10-11.15");
  });
});

describe("positive control: with the products back on sale the repair grants as before", () => {
  it("agent_pass_grant is called once with the pass's terms", async () => {
    const j = await (await repair(onSale, "GET")).json();
    expect(j.repair).toBeUndefined();
    const grants = calls.filter((c) => c.name === "agent_pass_grant");
    expect(grants).toHaveLength(1);
    expect(grants[0].args).toMatchObject({ p_user_id: BUYER, p_stripe_session_id: SESSION, p_session_hours: 6, p_applications_total: 10, p_amount_cents: 2900 });
  });
});
