// @vitest-environment node
/**
 * A SIGNED-OUT STRANGER DRAFTS NO SCREENING ANSWERS (S14 hotfix, lane spend,
 * M-S14-009).
 *
 * WHAT WAS WRONG. generate-application-answers' screening-answers path, the
 * one the board's Prepare dialog and the account's apply copilot call,
 * answered the publishable key: its only check was the model spend gate, so
 * a script with no account spent up to 300 model calls an hour on the
 * project's key, from pages that only a signed-in person can open.
 *
 * WHAT HOLDS NOW (the shipped handler; the database, the auth server and the
 * model faked):
 *   - the publishable key, a token the auth server refuses, and a token
 *     minted for a connected app are each answered 401 sign_in_required,
 *     before anything is counted and before any model call;
 *   - a signed-in website session reaches the spend gate and the model;
 *   - our own servers (the service-role key) still reach the model;
 *   - the preflight says the build that carries this.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
// The auth server accepts exactly the tokens in globalThis.__s14Accepts.
const CLIENT = "export function createClient() { const db = globalThis.__s14Db; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async (jwt) => (globalThis.__s14Accepts ?? []).includes(jwt) ? ({ data: { user: { id: 'user-harness' } }, error: null }) : ({ data: { user: null }, error: { message: 'invalid JWT' } }) } }; }";
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring.";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.c2ln`;
const SIGNED_IN = token({ role: "authenticated", sub: "user-harness", aud: "authenticated" });
const EXPIRED = token({ role: "authenticated", sub: "user-gone", aud: "authenticated" });
const CONNECTOR = token({ role: "authenticated", sub: "user-harness", aud: "authenticated", client_id: "claude-connector" });

let handler: EdgeHandler;
let db: FakeDb;
let aiCalls: number;
let rateCalls: number;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, LOVABLE_API_KEY: "lovable" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiCalls++;
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  handler = await loadEdgeHandler("generate-application-answers", {
    "https://deno.land/std@0.190.0/http/server.ts": SERVE,
    "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  });
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  aiCalls = 0;
  rateCalls = 0;
  const g = globalThis as Record<string, unknown>;
  g.__s14Db = db;
  // The connector's token is one the auth server signs: only its claim refuses it.
  g.__s14Accepts = [SIGNED_IN, CONNECTOR];
  db.rpcs.check_rate_limit = () => { rateCalls++; return { data: true, error: null }; };
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
});

const ANSWERS = { resumeText: RESUME, jobTitle: "Engineer", jobCompany: "Acme", jobDescription: POSTING, questions: ["Why do you want to work here?"] };

async function call(bearer: string, body: Record<string, unknown> = ANSWERS) {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-application-answers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, apikey: "anon_harness", "cf-connecting-ip": "198.51.100.31" },
    body: JSON.stringify(body),
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.json() as Record<string, unknown>; } catch { /* not json */ }
  return { status: res.status, json };
}

describe("the screening answers answer a signed-in website session or our own servers, nobody else", () => {
  for (const [who, bearer] of [["the publishable key", "anon_harness"], ["a token the auth server refuses", EXPIRED], ["a token minted for a connected app", CONNECTOR]] as const) {
    it(`${who} is answered 401 sign_in_required, with nothing counted and no model call`, async () => {
      const r = await call(bearer);
      expect(r.status).toBe(401);
      expect(r.json).toMatchObject({ error: "sign_in_required", code: "sign_in_required" });
      // No sentence: the page words it in the reader's language (applyAnswers.signIn).
      expect(r.json.message).toBeUndefined();
      expect(rateCalls, "a refused stranger spent a slot").toBe(0);
      expect(aiCalls, "a refused stranger reached the model").toBe(0);
    });
  }

  it("the publishable key with no questions (the inferred-questions mode) is refused the same way", async () => {
    const r = await call("anon_harness", { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING });
    expect(r.status).toBe(401);
    expect(aiCalls).toBe(0);
  });

  it("a signed-in website session is counted and reaches the model", async () => {
    const r = await call(SIGNED_IN);
    expect(r.status).not.toBe(401);
    expect(rateCalls).toBeGreaterThan(0);
    expect(aiCalls).toBeGreaterThan(0);
  });

  it("our own servers (the service-role key) reach the model without a website session", async () => {
    const r = await call(SERVICE_KEY);
    expect(r.status).not.toBe(401);
    expect(aiCalls).toBeGreaterThan(0);
  });

  it("the preflight answers the build that carries this", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-application-answers", { method: "OPTIONS" }));
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "generate-application-answers", "2026-11-10", 1)).toBe(true);
  });
});
