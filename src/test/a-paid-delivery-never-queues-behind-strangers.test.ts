// @vitest-environment node
/**
 * A PAID DELIVERY NEVER QUEUES BEHIND STRANGERS.
 *
 * WHAT WAS WRONG (review of 2026-10-04). The free generators gained a
 * function-wide hourly ceiling, the only bound against a rotating address
 * pool. Ten addresses at twenty calls spend it. For the rest of that hour
 * every server-side delivery that reached those generators with the
 * publishable key and no session was refused like a stranger: the webhook,
 * the purchase verifier and the retry sweep all sent the Apply Assistant's
 * cover letter that way, and the verifier sent the Cover Letter, Interview
 * Coach and Career Path bodies that way too. The Apply Assistant's callers
 * then saved `coverLetter: null`, marked the delivery generated and emailed
 * it -- a buyer who paid for a letter never got one, and nothing retried,
 * because the delivery counted as a success. The purchase-gated generators
 * had the mirror problem: our three servers share one egress address, so
 * their deliveries shared one twenty-an-hour address bucket, which anyone can
 * spend by asking warm-up to ping those generators.
 *
 * WHAT IS HELD, by RUNNING each caller's shipped handler (helpers/edge-harness)
 * and replaying the exact request it sends into the generator's shipped
 * handler while every address bucket and every function-wide ceiling refuses:
 *   - each server caller sends the service-role key, which the generator's
 *     spend gate never counts by address or ceiling, and names the session it
 *     is delivering, whose daily allowance still counts (the verifier
 *     regenerates on every success-page refresh until content is saved);
 *   - so each replayed delivery reaches the model.
 * The success page's own calls (a browser cannot hold the service key) carry
 * the session, and the generator counts them against the purchase's daily
 * allowance instead of the ceiling: held in
 * every-public-model-call-is-counted-before-it-is-made.test.ts, and the page's
 * bodies are read below.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVICE_KEY = "service_harness_key_0123456789abcdef";
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export const createClient = () => globalThis.__fakeSupabase; export class SupabaseClient {}";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.webhooks = { constructEventAsync: async (body) => JSON.parse(body) }; this.checkout = { sessions: { retrieve: async (id) => globalThis.__stripeSession(id) } }; } }",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: null, error: null }) }; } }",
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring.";
/** The generators this group's spend gate guards, which the delivery callers reach. */
const GUARDED = ["generate-cover-letter", "generate-interview-coach", "generate-career-path", "generate-keyword-fix"];

type Sent = { fn: string; url: string; headers: Record<string, string>; body: Record<string, unknown> };
type RateArgs = { p_function: string; p_ip: string };

const callers = new Map<string, EdgeHandler>();
const generators = new Map<string, EdgeHandler>();
const pending: Promise<unknown>[] = [];
let sent: Sent[];
let aiBodies: unknown[];
let rateCalls: RateArgs[];
/** true once replaying: every address bucket and every ceiling refuses. */
let spent = false;
const db = new FakeDb({ used_stripe_sessions: ["session_id"] });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_WEBHOOK_SECRET: "whsec_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_ANON_KEY: "anon_harness",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  g.fetch = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const u = String(url);
    if (u.includes("ai.gateway.lovable.dev")) {
      aiBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    const m = /\/functions\/v1\/([a-z0-9-]+)/.exec(u);
    if (m) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = String(v);
      sent.push({ fn: m[1], url: u, headers, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ success: true, data: { coverLetter: "Dear Hiring Manager," }, jobMetadata: {}, tailoredResume: {} }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
  g.__fakeSupabase = db;
  for (const fn of ["stripe-webhook", "verify-product-purchase", "retry-failed-deliveries"]) callers.set(fn, await loadEdgeHandler(fn, STUBS));
  for (const fn of GUARDED) generators.set(fn, await loadEdgeHandler(fn, STUBS));
}, 180_000);

beforeEach(() => {
  db.tables = {};
  db.writes = [];
  sent = [];
  aiBodies = [];
  rateCalls = [];
  spent = false;
  db.rpcs = {
    check_rate_limit: (a) => {
      rateCalls.push(a as RateArgs);
      const p = String((a as RateArgs).p_ip);
      return { data: !spent || p.startsWith("sess:"), error: null };
    },
    get_temp_resume: () => ({ data: [{ resume_text: RESUME, job_description_text: POSTING }], error: null }),
    get_purchased_content_by_session: () => ({ data: [], error: null }),
    get_cached_response: () => ({ data: null, error: null }),
    store_cached_response: () => ({ data: null, error: null }),
  };
});

async function drain() {
  while (pending.length) await pending.shift();
}

const paidSession = (id: string, productType: string) => ({
  id,
  payment_status: "paid",
  amount_total: 700,
  currency: "usd",
  customer_email: null,
  customer_details: { email: "buyer@example.com" },
  metadata: { product_type: productType, product_name: productType, session_id: "temp-resume-1", job_title: "Engineer", customer_email: "buyer@example.com", language: "en" },
});

async function viaWebhook(id: string, productType: string) {
  const res = await callers.get("stripe-webhook")!(new Request("https://harness.supabase.co/functions/v1/stripe-webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=harness" },
    body: JSON.stringify({ id: `evt_${id}`, type: "checkout.session.completed", data: { object: paidSession(id, productType) } }),
  }));
  await drain();
  return res.status;
}

async function viaVerifier(id: string, productType: string) {
  (globalThis as Record<string, unknown>).__stripeSession = () => paidSession(id, productType);
  const res = await callers.get("verify-product-purchase")!(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.20" },
    body: JSON.stringify({ sessionId: id, generateContent: true }),
  }));
  await drain();
  return res.status;
}

async function viaRetry(id: string, productType: string) {
  db.rows("used_stripe_sessions").push({ session_id: id, product_type: productType });
  db.rpcs.get_failed_deliveries_for_retry = () => ({
    data: [{ id: `pd-${id}`, product_type: productType, status: "generation_failed", stripe_session_id: id, customer_email: null, retry_count: 0, metadata: { resume_session_id: "temp-resume-1", job_title: "Engineer" } }],
    error: null,
  });
  const res = await callers.get("retry-failed-deliveries")!(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  await drain();
  return res.status;
}

/** Replay what a caller sent into the generator's shipped handler, with every address and ceiling refusing. */
async function replay(s: Sent) {
  spent = true;
  rateCalls = [];
  aiBodies = [];
  const res = await generators.get(s.fn)!(new Request(s.url, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.200", ...s.headers },
    body: JSON.stringify(s.body),
  }));
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ROUTES: Array<{ productType: string; fn: string }> = [
  { productType: "apply_assistant", fn: "generate-cover-letter" },
  { productType: "cover_letter", fn: "generate-cover-letter" },
  { productType: "interview_coach", fn: "generate-interview-coach" },
  { productType: "career_path_simulator", fn: "generate-career-path" },
  { productType: "basic_keyword_fix", fn: "generate-keyword-fix" },
];
const DRIVERS: Array<[string, (id: string, productType: string) => Promise<number>]> = [
  ["stripe-webhook", viaWebhook],
  ["verify-product-purchase", viaVerifier],
  ["retry-failed-deliveries", viaRetry],
];

describe("every server delivery reaches the generator as our own server, naming its purchase", () => {
  for (const [caller, drive] of DRIVERS) {
    for (const { productType, fn } of ROUTES) {
      it(`${caller} -> ${fn} (${productType}) reaches the model with every address and ceiling spent`, async () => {
        const id = `cs_${caller.replace(/-/g, "_")}_${productType}`;
        await drive(id, productType);
        const mine = sent.filter((s) => s.fn === fn);
        expect(mine.length, `${caller} never called ${fn} for a ${productType} purchase`).toBe(1);
        const s = mine[0];
        expect(s.headers.authorization, `${caller} reached ${fn} with the publishable key`).toBe(`Bearer ${SERVICE_KEY}`);
        expect(s.body.sessionId, `${caller} did not name the purchase to ${fn}`).toBe(id);

        const r = await replay(s);
        expect(r.status, JSON.stringify(r.body)).not.toBe(429);
        expect(aiBodies.length, `${fn} refused ${caller}'s delivery before the model`).toBeGreaterThan(0);
        const counted = rateCalls.filter((a) => a.p_function === fn).map((a) => String(a.p_ip));
        expect(counted.filter((p) => !p.startsWith("sess:")), "a delivery was counted by address or ceiling").toEqual([]);
        expect(counted.length, "the purchase's daily allowance was not counted").toBe(1);
      });
    }
  }

  it("a stranger replaying a delivery's body with the publishable key is still refused (the key, not the body, is the exemption)", async () => {
    await viaWebhook("cs_webhook_copy", "apply_assistant");
    const s = sent.find((x) => x.fn === "generate-cover-letter")!;
    const r = await replay({ ...s, headers: { ...s.headers, authorization: "Bearer anon_harness" } });
    expect(r.status).toBe(429);
    expect(aiBodies).toEqual([]);
  });
});

describe("the success page names the purchase on every call it makes to a free generator", () => {
  const page = readFileSync(resolve(__dirname, "../pages/ProductSuccess.tsx"), "utf8");
  const coach = readFileSync(resolve(__dirname, "../components/InterviewCoach.tsx"), "utf8");
  const path = readFileSync(resolve(__dirname, "../components/CareerPathSimulator.tsx"), "utf8");

  it("both Apply Assistant cover-letter calls carry the session", () => {
    const calls = [...page.matchAll(/invoke\('generate-cover-letter', \{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
    expect(calls.length, "the page's cover-letter calls were not found -- re-anchor this guard").toBe(2);
    for (const c of calls) expect(c).toMatch(/\bsessionId\b/);
  });

  it("the paid Interview Coach and Career Path panels are handed the session, and send it on every call", () => {
    expect(page).toMatch(/<InterviewCoach [^>]*sessionId=\{sessionId\}/);
    expect(page).toMatch(/<CareerPathSimulator [^>]*sessionId=\{sessionId\}/);
    const coachCalls = [...coach.matchAll(/invoke\("generate-interview-coach", \{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    expect(coachCalls.length).toBe(2);
    for (const c of coachCalls) expect(c).toMatch(/\bsessionId\b/);
    expect(path).toMatch(/invoke\("generate-career-path", \{[\s\S]*?\bsessionId\b[\s\S]*?\}\);/);
  });
});
