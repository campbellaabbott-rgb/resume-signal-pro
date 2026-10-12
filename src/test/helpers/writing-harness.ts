/**
 * THE WRITING TOOLS, RUN AS SHIPPED, WITH ONLY THEIR NETWORK FAKED.
 *
 * One world per test: the accounts the auth server knows (by token), the
 * plans pro_entitlement_rows answers, what take_writing_tools answers, and
 * what the AI gateway replies. Every rpc, every count and every model request
 * is recorded, so a test can say "the model was never asked".
 *
 * Tokens are JWT-shaped (role, sub, aud) because the handlers read the claims
 * before asking the auth server (websiteSessionOf), exactly as live.
 */
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./edge-harness";

export const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
export const ANON_KEY = "anon_harness";
export const FREE_USER = "4f9a3c2e-1b7d-4e8a-9c0f-2a6b5d4e3f21";
export const PRO_USER = "9b1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A website session's token for this account, as the auth server would sign it. */
export const tokenFor = (sub: string) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role: "authenticated", sub, aud: "authenticated" })}.c2ln`;

const CLIENT = `export function createClient(_url, _key, opts) {
  const w = globalThis.__writingWorld;
  const headerToken = String(opts?.global?.headers?.Authorization ?? "").replace(/^Bearer\\s+/i, "");
  return {
    rpc: (n, a) => w.db.rpc(n, a),
    from: (t) => w.db.from(t),
    auth: { getUser: async (jwt) => { const u = w.users[jwt ?? headerToken]; return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } }; } },
  };
}`;
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";

export const WRITING_STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'unpaid', metadata: {} }) } }; } }",
  "_shared/supabase-client.ts":
    "export const getServiceClient = () => { const w = globalThis.__writingWorld; return { rpc: (n, a) => w.db.rpc(n, a), from: (t) => w.db.from(t) }; };",
};

export type AiCall = { model: string; body: Record<string, unknown> };

export class WritingWorld {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  users: Record<string, { id: string; email: string }> = {};
  takes: Array<Record<string, unknown>> = [];
  refunds: Array<Record<string, unknown>> = [];
  counts: Array<Record<string, unknown>> = [];
  ai: AiCall[] = [];
  /** What take_writing_tools answers; allowed by default, with one id per tool. */
  take: (a: Record<string, unknown>) => unknown = (a) => ({
    allowed: true,
    use_ids: (a.p_tools as string[]).map((t, i) => `use-${t}-${i}`),
  });
  /** The gateway's reply to each model request. */
  reply: (call: AiCall) => Response = () => new Response(JSON.stringify({ error: "no reply set" }), { status: 400 });

  constructor() {
    this.users[tokenFor(FREE_USER)] = { id: FREE_USER, email: "free@example.com" };
    this.users[tokenFor(PRO_USER)] = { id: PRO_USER, email: "pro@example.com" };
    const live = new Date(Date.now() + 20 * 86400_000).toISOString();
    this.db.rpcs.pro_entitlement_rows = (a) => ({
      data: a.p_user_id === PRO_USER ? [{ tier: "pro", status: "active", current_period_end: live, bound: true }] : [],
      error: null,
    });
    this.db.rpcs.take_writing_tools = (a) => { this.takes.push(a); return { data: this.take(a), error: null }; };
    this.db.rpcs.refund_writing_tools = (a) => { this.refunds.push(a); return { data: (a.p_use_ids as string[]).length, error: null }; };
    this.db.rpcs.check_rate_limit = (a) => { this.counts.push(a); return { data: true, error: null }; };
    this.db.rpcs.get_cached_response = () => ({ data: null, error: null });
    this.db.rpcs.store_cached_response = () => ({ data: null, error: null });
  }

  /** Make this world the one the loaded handlers and the fake network see. */
  install(): void {
    const g = globalThis as Record<string, unknown>;
    g.__writingWorld = this;
    const env: Record<string, string> = {
      SUPABASE_URL: "https://harness.supabase.co",
      SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      LOVABLE_API_KEY: "lovable_harness",
      STRIPE_SECRET_KEY: "sk_test_harness",
    };
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    g.fetch = async (url: string, init?: { body?: string }) => {
      if (String(url).includes("ai.gateway.lovable.dev")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        const call = { model: String(body.model), body };
        this.ai.push(call);
        return this.reply(call);
      }
      return new Response("{}", { status: 200 });
    };
  }

  /** The system and user prompt text of every model request, joined. */
  prompts(): string {
    return this.ai.map((c) => ((c.body.messages as Array<{ content: string }>) ?? []).map((m) => m.content).join("\n")).join("\n----\n");
  }
}

/** A gateway reply carrying `content` as the assistant's message. */
export const chatReply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });

/** A gateway reply carrying a tool call with these arguments. */
export const toolReply = (name: string, args: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });

export async function loadWriter(fn: string): Promise<EdgeHandler> {
  return loadEdgeHandler(fn, WRITING_STUBS);
}

/** POST a body to a loaded handler as `who`: "anon", "service", or an account token. */
export async function post(handler: EdgeHandler, fn: string, body: unknown, who: string, extra: Record<string, string> = {}) {
  const bearer = who === "anon" ? ANON_KEY : who === "service" ? SERVICE_KEY : who;
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, apikey: who === "service" ? SERVICE_KEY : ANON_KEY, "cf-connecting-ip": "198.51.100.4", ...extra },
    body: JSON.stringify(body),
  }));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, headers: res.headers };
}
