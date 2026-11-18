// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild, which refuses
// jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * A FREE TOOL FALLS BACK TO FLASH, THEN GPT-5-MINI, NEVER TO PRO (cost audit
 * 2026-11-08, "Fallbacks for free tools").
 *
 * The product preview, the screening answers and the freelance profile
 * importer each asked chainFrom(flash): flash first, then the default chain's
 * remainder, whose next model was gemini-2.5-pro, the dearest and slowest one
 * there is. So the moment flash failed, a free teaser was written by the
 * model the paid deliverables use. freeChainFrom(primary) keeps the primary
 * and follows it with flash and gpt-5-mini only.
 *
 * The product preview has since been retired (NB-10): it answers 410 and asks
 * no model (the-product-preview-endpoint-is-retired-and-no-page-asks-it).
 *
 * WHAT THIS HOLDS, against each shipped handler with only its network faked:
 *   - when flash answers, flash is the only model asked (the primary did not
 *     move);
 *   - when it fails, gpt-5-mini is asked after it, and pro never is;
 *   - the spend gate counts the call before the first model request;
 *   - every reply the function parses logs one usage line under its label;
 *   - the preflight carries the new build and Access-Control-Max-Age 7200.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { FREE_CHAIN_TAIL, freeChainFrom } from "../../supabase/functions/_shared/ai-fallback";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const FLASH = "google/gemini-2.5-flash";
const MINI = "openai/gpt-5-mini";
const PRO = "google/gemini-2.5-pro";

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient() { const db = globalThis.__freeDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: { id: 'user-harness' } }, error: null }) } }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', metadata: { product_type: 'freelance_boost' } }) } }; } }",
  "_shared/supabase-client.ts": "export const getServiceClient = () => { const db = globalThis.__freeDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; };",
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring.";
const PAID = "cs_harness_paid";
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const SIGNED_IN = `${b64url({ alg: "HS256" })}.${b64url({ role: "authenticated", sub: "user-harness", aud: "authenticated" })}.c2ln`;

type Tool = { fn: string; build: [string, number]; labels: string[]; bearer: string; body: Record<string, unknown> };
const TOOLS: Tool[] = [
  { fn: "generate-application-answers", build: ["2026-11-10", 2], labels: ["APPLICATION-ANSWERS", "COVER-NOTE"], bearer: SIGNED_IN, body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING } },
  { fn: "import-freelance-profile", build: ["2026-11-10", 2], labels: ["IMPORT-FREELANCE"], bearer: "anon_harness", body: { profileText: RESUME, sessionId: PAID } },
];

const handlers = new Map<string, EdgeHandler>();
let db: FakeDb;
let events: string[];
let asked: string[];
let logged: string[];
let gateway: (model: string) => Response;

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }), { status: 200 });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
    LOVABLE_API_KEY: "lovable_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const model = String(JSON.parse(String(init?.body ?? "{}")).model);
      asked.push(model);
      events.push(`model:${model}`);
      return gateway(model);
    }
    return new Response("{}", { status: 200 });
  };
  for (const t of TOOLS) handlers.set(t.fn, await loadEdgeHandler(t.fn, STUBS));
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rows("used_stripe_sessions").push({ session_id: PAID, product_type: null, ip_address: null, used_at: "2026-08-01T00:00:00Z" });
  events = [];
  asked = [];
  logged = [];
  db.rpcs.check_rate_limit = () => { events.push("count"); return { data: true, error: null }; };
  db.rpcs.pro_entitlement_rows = () => ({ data: [], error: null });
  (globalThis as Record<string, unknown>).__freeDb = db;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function call(t: Tool) {
  const res = await handlers.get(t.fn)!(new Request(`https://harness.supabase.co/functions/v1/${t.fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${t.bearer}`, apikey: "anon_harness", "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify(t.body),
  }));
  await res.text();
  return res.status;
}

describe("freeChainFrom keeps the primary and follows it with the two cheap models only", () => {
  it("flash first is flash then gpt-5-mini; another primary keeps its place; pro is never in it", () => {
    expect(freeChainFrom(FLASH)).toEqual([FLASH, MINI]);
    expect(freeChainFrom("google/gemini-3-flash-preview")).toEqual(["google/gemini-3-flash-preview", FLASH, MINI]);
    expect(freeChainFrom(MINI)).toEqual([MINI, FLASH]);
    expect([...FREE_CHAIN_TAIL]).toEqual([FLASH, MINI]);
    for (const p of [FLASH, MINI, "x/y"]) expect(freeChainFrom(p)).not.toContain(PRO);
  });
});

for (const t of TOOLS) {
  describe(t.fn, () => {
    it("when flash answers, flash is the only model asked, after the spend gate counted the call", async () => {
      gateway = () => reply(JSON.stringify({ heading: "One bullet", body: "Rebuilt checkout for a dental chain.", note: "n", answers: [], data: {} }));
      await call(t);
      expect(asked.length, `${t.fn} never asked the model`).toBeGreaterThan(0);
      expect([...new Set(asked)]).toEqual([FLASH]);
      expect(events.indexOf("count"), events.join(" ")).toBeGreaterThanOrEqual(0);
      expect(events.indexOf("count")).toBeLessThan(events.findIndex((e) => e.startsWith("model:")));
    });

    it("when flash fails, gpt-5-mini is asked after it, and pro never is", async () => {
      gateway = () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
      await call(t);
      expect(asked.length, `${t.fn} never asked the model`).toBeGreaterThan(0);
      expect(asked).not.toContain(PRO);
      expect(asked[0]).toBe(FLASH);
      asked.forEach((m, i) => {
        expect([FLASH, MINI]).toContain(m);
        if (m === MINI) expect(asked[i - 1], asked.join(" > ")).toBe(FLASH);
      });
      expect(asked).toContain(MINI);
      expect(events.indexOf("count")).toBeLessThan(events.findIndex((e) => e.startsWith("model:")));
    });

    it("every reply it parsed is logged as one usage line under its own label, numbers only", async () => {
      gateway = () => reply(JSON.stringify({ heading: "One bullet", body: "Rebuilt checkout for a dental chain.", note: "n", answers: [], data: {} }));
      await call(t);
      const usage = logged.filter((l) => l.startsWith("[AI-USAGE]"));
      expect(usage.length, logged.join("\n")).toBeGreaterThan(0);
      for (const l of usage) {
        expect(l).toMatch(new RegExp(`^\\[AI-USAGE\\] context=(${t.labels.join("|")}) model=google/gemini-2\\.5-flash prompt_tokens=11 completion_tokens=7 cached_tokens=- reasoning_tokens=- finish_reason=stop$`));
        expect(l).not.toMatch(/Jane|dental|checkout/);
      }
    });

    it("the preflight carries the new build and lets a browser keep it for two hours", async () => {
      const res = await handlers.get(t.fn)!(new Request(`https://harness.supabase.co/functions/v1/${t.fn}`, { method: "OPTIONS" }));
      expect(res.headers.get("access-control-max-age")).toBe("7200");
      expect(buildIsAtLeast(res.headers.get("x-fn-build"), t.fn, t.build[0], t.build[1]), String(res.headers.get("x-fn-build"))).toBe(true);
    });
  });
}
