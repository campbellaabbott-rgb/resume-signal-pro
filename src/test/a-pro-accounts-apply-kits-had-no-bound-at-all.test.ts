// @vitest-environment node
/**
 * A PRO ACCOUNT'S APPLY KITS HAD NO BOUND AT ALL (review of S8-063).
 *
 * Taking a Pro account out of the address's 40-a-day bucket also took it out
 * of every limiter: the address check ran only for non-Pro callers and the
 * purchase allowance only for a purchase, so one Pro account (a first-time
 * trial counts) could run gemini-2.5-pro kits without an hourly, daily or
 * global cap. The account and plan lookups also ran before any limiter for
 * every request with a Bearer header, the publishable key included.
 *
 * Now every signed-in account has its own hourly bucket, counted before its
 * plan is read, Pro accounts together share an hourly ceiling, a limiter
 * that cannot answer refuses (503), and the publishable key is never looked
 * up. Run against the shipped handler; auth, the plan, the database and the
 * model are faked.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end.";

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const USERS = {
  pro: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
  other: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  trial: "11111111-2222-4333-8444-555555555555",
};
const TOKENS = {
  pro: jwt({ role: "authenticated", sub: USERS.pro }),
  other: jwt({ role: "authenticated", sub: USERS.other }),
  trial: jwt({ role: "authenticated", sub: USERS.trial }),
  publishable: jwt({ role: "anon", iss: "supabase" }),
};
const USER_OF: Record<string, string> = { [TOKENS.pro]: USERS.pro, [TOKENS.other]: USERS.other, [TOKENS.trial]: USERS.trial };

let db: FakeDb;
let counts: Map<string, number>;
let handler: EdgeHandler;
let modelCalls = 0;
let getUserCalls = 0;

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const STRIPE = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async () => { throw new Error('no stripe here'); } } }; } }";
const SUPABASE = "export function createClient(_u, _k, o) { const h = o?.global?.headers?.Authorization ?? ''; return { auth: { getUser: async () => globalThis.__proGetUser(h) } }; }";
const PRO = `export async function accountProStanding(_db, userId) {
  if (userId === '${USERS.trial}') return { pro: true, trialing: true };
  return { pro: userId === '${USERS.pro}' || userId === '${USERS.other}', trialing: false };
}`;

beforeAll(async () => {
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
  g.__proGetUser = async (h: string) => {
    getUserCalls++;
    const id = USER_OF[h.replace(/^Bearer /, "")];
    return { data: { user: id ? { id } : null }, error: null };
  };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      modelCalls++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-apply-package", {
    "https://deno.land/std@0.168.0/http/server.ts": SERVE,
    "https://esm.sh/stripe@18.5.0": STRIPE,
    "https://esm.sh/@supabase/supabase-js@2": SUPABASE,
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__kitDb;",
    "_shared/pro.ts": PRO,
  });
}, 120_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  counts = new Map();
  db.rpcs.check_rate_limit = (a) => {
    const key = `${a.p_function}|${a.p_ip}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { data: n <= Number(a.p_max_requests), error: null };
  };
  // A Pro kit also takes one tailored résumé from the account's writing
  // allowance since wave 4's second round (20261011160000); allowed here, and
  // given back because the harness's model never delivers. This test is about
  // the hourly bucket, which is counted before it.
  db.rpcs.take_writing_tools = (a) => ({ data: { allowed: true, use_ids: (a.p_tools as string[]).map((t) => `use-${t}`) }, error: null });
  db.rpcs.refund_writing_tools = (a) => ({ data: (a.p_use_ids as string[]).length, error: null });
  (globalThis as Record<string, unknown>).__kitDb = db;
  modelCalls = 0;
  getUserCalls = 0;
});

const ask = (token: string, ip = "203.0.113.41") => handler(new Request("https://harness.supabase.co/functions/v1/generate-apply-package", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "cf-connecting-ip": ip },
  body: JSON.stringify({ resumeText: RESUME, jobPostingText: POSTING }),
}));

describe("a Pro account's kits have a fair-use bound", () => {
  it("one account is refused past its hourly allowance, from any address, before the model is called", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) statuses.push((await ask(TOKENS.pro, `203.0.113.${i % 50}`)).status);
    expect(statuses.filter((s) => s === 429 || s === 402 || s === 503)).toEqual([]);
    const before = modelCalls;
    const refused = await ask(TOKENS.pro, "198.51.100.7");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "rate_limited_function", limit: 60 });
    expect(refused.headers.get("retry-after")).toBe("3600");
    expect(modelCalls).toBe(before);
  });

  it("another Pro account is still served after the first one is refused", async () => {
    for (let i = 0; i < 61; i++) await ask(TOKENS.pro);
    expect((await ask(TOKENS.other)).status).not.toBe(429);
  });

  it("all Pro accounts together stop at the function's hourly ceiling", async () => {
    counts.set("generate-apply-package|pro", 600);
    const res = await ask(TOKENS.other);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited_global", limit: 600 });
    expect(modelCalls).toBe(0);
  });

  it("a trialing account is bounded the same way", async () => {
    for (let i = 0; i < 60; i++) await ask(TOKENS.trial);
    expect((await ask(TOKENS.trial)).status).toBe(429);
  });

  it("a limiter that cannot answer refuses a Pro account, and no model is called", async () => {
    db.rpcs.check_rate_limit = () => ({ data: null, error: { message: "connection refused" } });
    const res = await ask(TOKENS.pro);
    expect(res.status).toBe(503);
    expect(modelCalls).toBe(0);
  });

  it("the publishable key is never looked up as an account; its caller is counted by address", async () => {
    await ask(TOKENS.publishable);
    expect(getUserCalls).toBe(0);
    expect(counts.get("generate-apply-package|203.0.113.41")).toBe(1);
  });
});
