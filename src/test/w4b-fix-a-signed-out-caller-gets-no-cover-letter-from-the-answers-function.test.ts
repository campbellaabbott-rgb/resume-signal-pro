// @vitest-environment node
/**
 * A SIGNED-OUT CALLER GETS NO COVER LETTER FROM THE ANSWERS FUNCTION
 * (wave 4 round 2 review, security lens).
 *
 * WHAT WAS WRONG. The owner gated the writing tools by account on the server
 * (signed out: no cover letter). generate-application-answers' 'cover-note'
 * mode wrote a grounded cover letter for anyone holding the publishable key;
 * its only check was the model spend gate. Its only caller was the retired,
 * switched-off apply agent; the /apply page asks for screening answers only.
 *
 * WHAT HOLDS NOW (the shipped handler, the database and the model faked):
 *   - a cover-note request with the publishable key is answered 401
 *     {error:'sign_in_required'} and no model is called, nothing counted;
 *   - our own servers (the service-role key) still reach the generator;
 *   - the screening-answers mode the /apply page uses is not refused.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__gaaDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }; }";
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring.";

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
  (globalThis as Record<string, unknown>).__gaaDb = db;
  db.rpcs.check_rate_limit = () => { rateCalls++; return { data: true, error: null }; };
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
});

const call = async (body: Record<string, unknown>, bearer = "anon_harness") => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/generate-application-answers", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, apikey: "anon_harness", "cf-connecting-ip": "198.51.100.30" },
    body: JSON.stringify(body),
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.json() as Record<string, unknown>; } catch { /* not json */ }
  return { status: res.status, json };
};

const COVER = { mode: "cover-note", resumeText: RESUME, jobTitle: "Engineer", jobCompany: "Acme", jobDescription: POSTING, language: "en" };

describe("the cover-note mode takes the writing tools' account gate", () => {
  it("the publishable key is answered 401 sign_in_required, with no model call and nothing counted", async () => {
    const r = await call(COVER);
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("sign_in_required");
    expect(aiCalls).toBe(0);
    expect(rateCalls).toBe(0);
  });

  it("our own servers still reach the generator", async () => {
    const r = await call(COVER, SERVICE_KEY);
    expect(r.status).not.toBe(401);
    expect(aiCalls).toBeGreaterThan(0);
  });

  it("the screening-answers mode the apply page uses is not refused by it", async () => {
    const r = await call({ resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING });
    expect(r.status).not.toBe(401);
  });
});
