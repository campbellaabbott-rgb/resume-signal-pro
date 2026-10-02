/**
 * THE PAID ANALYSIS, RUN FOR REAL: analyze-resume's shipped handler with a
 * fake Stripe, a fake AI gateway and an in-memory database.
 *
 * Shared by the two guards that make purchases against it -- the redemption
 * guard (one analysis per session, retry after a failure) and the price guard
 * (every currency create-checkout charges in is accepted). See edge-harness.ts
 * for why a handler is executed rather than its source read.
 */
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./edge-harness";

export type FakeSession = {
  id: string;
  payment_status: string;
  amount_total: number | null;
  currency: string;
  metadata: Record<string, string>;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  total_details?: { amount_discount?: number } | null;
};

/** A paid session exactly as create-checkout mints one, $5 in USD unless told otherwise. */
export function fullAnalysisSession(id: string, over: Partial<FakeSession> = {}): FakeSession {
  return {
    id,
    payment_status: "paid",
    amount_total: 500,
    currency: "usd",
    metadata: { product_type: "full_analysis", originalCurrency: "usd", baseAmountUSD: "5" },
    customer_details: { email: "buyer@example.com" },
    customer_email: null,
    total_details: { amount_discount: 0 },
    ...over,
  };
}

/**
 * A paid session exactly as create-checkout minted one between the $5 price
 * cut (2025-12-23) and the day it began naming the product (2026-06-30): the
 * three metadata keys it wrote then, and nothing else.
 */
export function legacyFullAnalysisSession(id: string, over: Partial<FakeSession> = {}): FakeSession {
  return fullAnalysisSession(id, {
    metadata: { resumeData: '{"fileName":"cv.pdf"}', originalCurrency: "usd", baseAmountUSD: "5" },
    ...over,
  });
}

/** What the model returns: the four core fields analyze-resume validates, plus a per-call marker. */
export function analysisFixture(marker: string) {
  return {
    marker,
    industry: "Software",
    experienceLevel: "mid",
    atsScore: { score: 71, breakdown: { keywordMatch: 70, formatting: 72, structure: 71, relevance: 70 }, improvements: [] },
    optimizedBullets: [{ original: "did things", improved: "Shipped things", explanation: "verb" }],
    actionVerbs: ["Shipped"],
    keywords: { found: ["TypeScript"], missing: ["Kubernetes"] },
    redFlags: [],
  };
}

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: (id, opts) => globalThis.__fakeStripe.retrieve(id, opts) } }; } }",
  "https://deno.land/std@0.168.0/crypto/mod.ts": "export const crypto = globalThis.crypto;",
  "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__fakeSupabase;",
  "_shared/ai-fallback.ts":
    "export const chainFrom = (m) => [m]; export const callAIWithModelFallback = (key, opts) => globalThis.__fakeAI(opts);",
};

export type Harness = {
  handler: EdgeHandler;
  db: FakeDb;
  sessions: Map<string, FakeSession>;
  /** Number of AI calls made so far. */
  aiCalls: () => number;
  /** Queue the outcome of the NEXT AI calls: "ok", an HTTP status to fail with, or a promise gate. */
  aiPlan: Array<"ok" | number | Promise<void>>;
  /** A cached analysis the cache lookup will return, or null for a miss. */
  cache: { value: unknown };
  call: (body: Record<string, unknown>) => Promise<{ status: number; json: Record<string, unknown> }>;
  /** Wait for every background task the handler handed to EdgeRuntime.waitUntil. */
  settle: () => Promise<void>;
  reset: () => void;
};

/** Load the shipped handler once; reset() gives each test a clean database and Stripe. */
export async function analyzeResumeHarness(): Promise<Harness> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    STRIPE_SECRET_KEY: "sk_test_harness",
    LOVABLE_API_KEY: "lovable_harness",
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    ADMIN_EMAIL: "owner@example.com",
  };
  const pending: Promise<unknown>[] = [];
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => undefined)); } };
  // The only fetches the handler makes are the analysis email and the alert
  // mail; neither may leave the process.
  g.fetch = async () => new Response("{}", { status: 200 });

  const state = {
    db: new FakeDb(),
    sessions: new Map<string, FakeSession>(),
    calls: 0,
    plan: [] as Array<"ok" | number | Promise<void>>,
    cache: { value: null as unknown },
  };

  const fresh = () => {
    const db = new FakeDb({
      used_stripe_sessions: ["session_id"],
      purchased_content: ["stripe_session_id"],
      resume_analyses: ["share_id"],
    });
    db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
    db.rpcs.check_rate_limit = () => ({ data: true, error: null });
    db.rpcs.get_cached_response = () => ({ data: state.cache.value, error: null });
    db.rpcs.store_cached_response = () => ({ data: null, error: null });
    db.rpcs.get_analysis_by_share_id = (a) => ({
      data: db.rows("resume_analyses")
        .filter((r) => r.share_id === a.share_id_param && new Date(String(r.expires_at)).getTime() > Date.now())
        .map((r) => ({ id: r.id, analysis_result: r.analysis_result, created_at: r.created_at, share_id: r.share_id })),
      error: null,
    });
    db.rpcs.delete_analysis_by_share_id = (a) => {
      const before = db.rows("resume_analyses").length;
      db.tables.resume_analyses = db.rows("resume_analyses").filter((r) => r.share_id !== a.p_share_id);
      return { data: db.rows("resume_analyses").length < before, error: null };
    };
    state.db = db;
    state.sessions = new Map();
    state.calls = 0;
    state.plan.length = 0;
    state.cache.value = null;
    g.__fakeSupabase = db;
  };
  fresh();

  g.__fakeStripe = {
    retrieve: async (id: string) => {
      await Promise.resolve();
      const s = state.sessions.get(id);
      if (!s) throw new Error(`No such checkout.session: '${id}'`);
      return JSON.parse(JSON.stringify(s));
    },
  };
  g.__fakeAI = async () => {
    state.calls++;
    const n = state.calls;
    const step = state.plan.length ? state.plan.shift()! : "ok";
    if (step instanceof Promise) await step;
    if (typeof step === "number") {
      return { response: new Response(JSON.stringify({ error: "upstream" }), { status: step }), modelUsed: "fake" };
    }
    const body = { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(analysisFixture(`ai-call-${n}`)) } }] } }] };
    return { response: new Response(JSON.stringify(body), { status: 200 }), modelUsed: "fake" };
  };

  const handler = await loadEdgeHandler("analyze-resume", STUBS);

  const harness: Harness = {
    handler,
    get db() { return state.db; },
    get sessions() { return state.sessions; },
    aiCalls: () => state.calls,
    aiPlan: state.plan,
    cache: state.cache,
    call: async (body) => {
      const res = await handler(new Request("https://harness.supabase.co/functions/v1/analyze-resume", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify(body),
      }));
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: res.status, json };
    },
    settle: async () => { while (pending.length) await pending.shift(); },
    reset: fresh,
  } as Harness;
  return harness;
}

/** A résumé long enough for every validator on the path. */
export const RESUME = "Jane Doe. Senior software engineer. ".repeat(20);
