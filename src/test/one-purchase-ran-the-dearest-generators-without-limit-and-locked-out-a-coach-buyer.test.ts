// @vitest-environment node
/**
 * ONE PURCHASE RAN THE DEAREST GENERATORS WITHOUT LIMIT, AND LOCKED OUT A
 * COACH BUYER (sweep S8-063, S8-065).
 *
 * S8-063: generate-ats-defense (gpt-5, no output cap) and
 * generate-apply-package (gemini-2.5-pro plus a retry) re-checked Stripe on
 * every call but never counted the purchase, and both went on to the model
 * when check_rate_limit errored. One $15 or $7 session plus a pool of
 * addresses bought unbounded runs. Run against the shipped handlers: a
 * purchase now buys 10 a day, and a limiter error is a 503 before any model
 * call. A Pro account's own plan keeps its unlimited kits.
 *
 * S8-065: modelSpendGate counted the per-address hour (20) before it read the
 * purchase, so a paying Interview Coach buyer (one generate plus one evaluate
 * per answer, 15 calls a pass) got a 429 for an hour on the 21st call with
 * half the purchase's 30 a day unspent.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { modelSpendGate } from "../../supabase/functions/_shared/model-spend-gate";

type Session = { id: string; payment_status: string; metadata: Record<string, string>; customer_details?: { email: string } };

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end.";

const sessions = new Map<string, Session>();
let aiRequests = 0;
let db: FakeDb;
/** check_rate_limit as the database answers it: a purchase's bucket counts, every other bucket passes. */
let sessionCounts: Map<string, number>;
let limiterFails = false;

function installDb() {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  sessionCounts = new Map();
  db.rpcs.check_rate_limit = (a) => {
    if (limiterFails) return { data: null, error: { message: "boom" } };
    const ip = String(a.p_ip);
    if (!ip.startsWith("sess:")) return { data: true, error: null };
    const n = (sessionCounts.get(ip) ?? 0) + 1;
    sessionCounts.set(ip, n);
    return { data: n <= Number(a.p_max_requests), error: null };
  };
  const g = globalThis as Record<string, unknown>;
  g.__spendDb = db;
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    LOVABLE_API_KEY: "lovable_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.__spendStripe = async (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error(`No such checkout.session: '${id}'`);
    return JSON.parse(JSON.stringify(s));
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiRequests++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
});

beforeEach(() => {
  installDb();
  sessions.clear();
  aiRequests = 0;
  limiterFails = false;
});

const STRIPE = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id) => globalThis.__spendStripe(id) } }; } }";
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";

describe("generate-apply-package", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    handler = await loadEdgeHandler("generate-apply-package", {
      "https://deno.land/std@0.168.0/http/server.ts": SERVE,
      "https://esm.sh/stripe@18.5.0": STRIPE,
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return { auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }",
      "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__spendDb;",
    });
  }, 120_000);

  const ask = (sessionId: string) => handler(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({ resumeText: RESUME, jobPostingText: POSTING, sessionId }),
  }));

  it("one paid session buys ten kits a day, not an eleventh", async () => {
    sessions.set("cs_live_kit", { id: "cs_live_kit", payment_status: "paid", metadata: { product_type: "apply_assistant" } });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await ask("cs_live_kit")).status);
    expect(statuses[10]).toBe(429);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    // Each allowed call may retry once at the model; the refused one asks nothing.
    const before = aiRequests;
    await ask("cs_live_kit");
    expect(aiRequests).toBe(before);
  });

  it("a limiter that cannot answer is a 503, before any model call", async () => {
    sessions.set("cs_live_kit2", { id: "cs_live_kit2", payment_status: "paid", metadata: { product_type: "apply_assistant" } });
    limiterFails = true;
    expect((await ask("cs_live_kit2")).status).toBe(503);
    expect(aiRequests).toBe(0);
  });
});

describe("generate-ats-defense", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    handler = await loadEdgeHandler("generate-ats-defense", {
      "https://deno.land/std@0.168.0/http/server.ts": SERVE,
      "https://esm.sh/stripe@18.5.0": STRIPE,
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__spendDb; }",
    });
  }, 120_000);

  const ask = (sessionId: string) => handler(new Request("https://harness.supabase.co/functions/v1/generate-ats-defense", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
    body: JSON.stringify({ sessionId, resumeText: RESUME }),
  }));

  it("one paid session buys ten reports a day, not an eleventh", async () => {
    sessions.set("cs_live_ats_paid", { id: "cs_live_ats_paid", payment_status: "paid", metadata: { product_type: "ats_defense" }, customer_details: { email: "buyer@example.com" } });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await ask("cs_live_ats_paid")).status);
    expect(statuses[10]).toBe(429);
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
  });

  it("a limiter that cannot answer is a 503, before any model call", async () => {
    sessions.set("cs_live_ats_two", { id: "cs_live_ats_two", payment_status: "paid", metadata: { product_type: "ats_defense" } });
    limiterFails = true;
    expect((await ask("cs_live_ats_two")).status).toBe(503);
    expect(aiRequests).toBe(0);
  });
});

describe("the spend gate and a paying Interview Coach buyer", () => {
  it("a paying buyer past the shared address hour is allowed while the purchase's day lasts", async () => {
    const SESSION = "cs_live_coach_paid";
    const calls: Array<Record<string, unknown>> = [];
    const gateDb = {
      rpc: async (_n: string, a: Record<string, unknown>) => {
        calls.push(a);
        // The address's shared hour (20) is spent by the buyer's own 20
        // calls; the purchase's day (30) is not.
        return { data: !(a.p_function === "generate-interview-coach" && a.p_ip === "203.0.113.11"), error: null };
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { session_id: SESSION, product_type: "interview_coach" }, error: null }) }) }) }),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "no" } }) },
    };
    const req = new Request("https://x.test/fn", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.11" } });
    const refused = await modelSpendGate(gateDb as never, req, "generate-interview-coach", { perAddress: 20, globalPerHour: 200, perSessionPerDay: 30 }, {}, { session: SESSION, products: ["interview_coach"] });
    expect(refused).toBeNull();
    expect(calls.some((a) => String(a.p_ip).startsWith("sess:"))).toBe(true);
  });

  it("a body naming a purchase, from an address whose purchase bucket is spent, is refused", async () => {
    const gateDb = {
      rpc: async (_n: string, a: Record<string, unknown>) => ({ data: String(a.p_ip).startsWith("sess:"), error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { session_id: "cs_y", product_type: "interview_coach" }, error: null }) }) }) }),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "no" } }) },
    };
    const req = new Request("https://x.test/fn", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.13" } });
    const refused = await modelSpendGate(gateDb as never, req, "generate-interview-coach", { perAddress: 20, globalPerHour: 200, perSessionPerDay: 30 }, {}, { session: "cs_y", products: ["interview_coach"] });
    expect(refused?.status).toBe(429);
  });

  it("a spent purchase day still falls back to the address's hour", async () => {
    const gateDb = {
      rpc: async () => ({ data: false, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { session_id: "cs_x", product_type: "interview_coach" }, error: null }) }) }) }),
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "no" } }) },
    };
    const req = new Request("https://x.test/fn", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.12" } });
    const refused = await modelSpendGate(gateDb as never, req, "generate-interview-coach", { perAddress: 20, globalPerHour: 200, perSessionPerDay: 30 }, {}, { session: "cs_x", products: ["interview_coach"] });
    expect(refused?.status).toBe(429);
  });
});
