// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild, which refuses
// jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * EVERY PUBLIC MODEL CALL IS COUNTED BEFORE IT IS MADE, AGAINST AN ADDRESS THE CALLER CANNOT CHOOSE.
 *
 * WHAT WAS WRONG (defect sweep 2026-10-02: 1.06, 1.64). Twenty-odd edge
 * functions call the AI gateway on the project's key and answer the
 * publishable key. Each had its own copy of a per-address limiter keyed on the
 * FIRST x-forwarded-for hop, which the caller writes: a script that sent a
 * fresh value per request had a fresh allowance per request. Two copies read
 * `allowed === false`, so a limiter error skipped the limit; one fell through
 * on any error by design; generate-summary had no limiter at all. Several sent
 * no output cap, and the free cover-letter generator had no input bound.
 *
 * THE PROPERTY, run against each shipped handler (helpers/edge-harness) with
 * only its network faked -- a check_rate_limit the test controls and an AI
 * gateway that records every request:
 *   - the bucket is the function's own name and the address is the
 *     platform's: cf-connecting-ip, else the LAST forwarded hop; three
 *     requests with three forged first hops spend from ONE bucket;
 *   - a refused count (false), an RPC error and a null answer each stop the
 *     request before any model call -- 429 for the first, 503 for the others;
 *   - on the free endpoints a second bucket, "global", bounds the function as
 *     a whole, and its refusal also stops the request before the model;
 *   - an allowed request reaches the model, and every model request carries
 *     an output cap;
 *   - our own servers (the service-role key) are not counted.
 * Paid generators refuse a stranger before the model anyway; for them the
 * address allowance is the whole limit, and the same address and fail-closed
 * rules are held.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient() { const db = globalThis.__spendDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: { id: 'user-harness' } }, error: null }) } }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.45.0": CLIENT,
  "https://esm.sh/stripe@18.5.0":
    "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', metadata: { product_type: 'freelance_boost' } }) } }; } }",
  "_shared/supabase-client.ts": "export const getServiceClient = () => { const db = globalThis.__spendDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; };",
};

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);
const POSTING = "We are hiring a senior engineer to own our checkout and fulfilment services end to end, with on-call and mentoring.";
const PAID = "cs_harness_paid";

type Case = {
  fn: string;
  body: Record<string, unknown>;
  perAddress: number;
  window?: number;
  /** The function-wide hourly ceiling, on endpoints a stranger reaches the model through. */
  global?: number;
  /** false where the harness cannot get past the function's own purchase check. */
  reachesModel?: boolean;
};

const CASES: Case[] = [
  { fn: "generate-summary", perAddress: 30, global: 600, body: { atsScore: 71, formatGrade: "B", industry: "tech", experienceLevel: "mid", topStrength: "Clear metrics", redFlagsCount: 2, quickWins: [{ fix: "Quantify the 2023 launch" }], improvementPotential: { estimatedScoreIncrease: 12 }, candidateName: "Jane Doe" } },
  { fn: "generate-interview-coach", perAddress: 20, global: 200, body: { resumeText: RESUME, targetRole: "Engineer", mode: "generate" } },
  { fn: "generate-career-path", perAddress: 20, global: 200, body: { resumeText: RESUME } },
  { fn: "generate-cover-letter", perAddress: 20, global: 200, body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING } },
  { fn: "generate-tailored-resume", perAddress: 20, global: 200, body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING } },
  { fn: "generate-elevator-pitch", perAddress: 20, global: 200, body: { resumeText: RESUME } },
  { fn: "generate-recruiter-view", perAddress: 20, global: 200, body: { resumeText: RESUME } },
  { fn: "generate-resume-roast", perAddress: 20, global: 200, body: { resumeText: RESUME } },
  { fn: "generate-application-answers", perAddress: 30, global: 300, body: { resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING } },
  { fn: "generate-product-preview", perAddress: 20, global: 200, body: { productId: "freelance_transition_pro", resumeText: RESUME } },
  { fn: "nl-search", perAddress: 40, global: 600, body: { query: "remote product roles over 150k" } },
  { fn: "analyze-linkedin-profile", perAddress: 10, global: 100, body: { resumeText: RESUME, linkedinText: RESUME } },
  { fn: "import-freelance-profile", perAddress: 10, window: 1440, global: 100, body: { profileText: RESUME } },
  { fn: "test-ai-fallback", perAddress: 3, global: 30, body: { mode: "quick" } },
  { fn: "parse-resume-structured", perAddress: 15, window: 1440, global: 150, body: { resumeText: RESUME } },
  { fn: "shortlist-evaluate", perAddress: 60, global: 300, body: { roleId: "role-1", jdText: POSTING, resumeText: RESUME } },
  { fn: "generate-keyword-fix", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-career-snapshot", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-graduate-gameplan", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-premium-package", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-premium-package-stream", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-cover-letter-stream", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-tailored-resume-stream", perAddress: 20, body: { resumeText: RESUME, jobDescription: POSTING, jobTitle: "Engineer", sessionId: PAID } },
  { fn: "generate-freelance-boost", perAddress: 20, body: { sessionId: PAID, targetRole: "Product designer", projects: [{ clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "", duration: "3 months" }] } },
];

type RateArgs = { p_function: string; p_ip: string; p_max_requests: number; p_window_minutes: number };
type Verdict = { data: unknown; error: { message: string } | null };

const handlers = new Map<string, EdgeHandler>();
let db: FakeDb;
let rateCalls: RateArgs[];
let aiBodies: Array<Record<string, unknown>>;
let rate: (a: RateArgs) => Verdict;
const SERVICE_KEY = "service-role-harness-key";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    LOVABLE_API_KEY: "lovable_harness",
    STRIPE_SECRET_KEY: "sk_test_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      aiBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ error: "harness stops at the model" }), { status: 400 });
    }
    return new Response("{}", { status: 200 });
  };
  for (const c of CASES) handlers.set(c.fn, await loadEdgeHandler(c.fn, STUBS));
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  db.rows("used_stripe_sessions").push({ session_id: PAID, product_type: null });
  db.rows("shortlist_roles").push({ id: "role-1", jd_version: 1 });
  rateCalls = [];
  aiBodies = [];
  rate = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = (args) => { rateCalls.push(args as RateArgs); return rate(args as RateArgs); };
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__spendDb = db;
});

async function call(c: Case, headers: Record<string, string>) {
  const res = await handlers.get(c.fn)!(new Request(`https://harness.supabase.co/functions/v1/${c.fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", apikey: "anon_harness", ...headers },
    body: JSON.stringify(c.body),
  }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* a stream */ }
  return { status: res.status, body, headers: res.headers };
}

const mine = (fn: string) => rateCalls.filter((a) => a.p_function === fn && a.p_ip !== "global");
const world = (fn: string) => rateCalls.filter((a) => a.p_function === fn && a.p_ip === "global");

describe("the gate is in front of every public model endpoint", () => {
  for (const c of CASES) {
    describe(c.fn, () => {
      it("counts the platform's address in the function's own bucket, never the first forwarded hop", async () => {
        for (const forged of ["6.6.6.6", "7.7.7.7", "8.8.8.8"]) {
          await call(c, { "x-forwarded-for": `${forged}, 203.0.113.9` });
        }
        const seen = mine(c.fn);
        expect(seen.length, `${c.fn} never called check_rate_limit for the address`).toBe(3);
        expect([...new Set(seen.map((a) => a.p_ip))], "three forged first hops bought three buckets").toEqual(["203.0.113.9"]);
        expect(seen[0].p_max_requests).toBe(c.perAddress);
        expect(seen[0].p_window_minutes).toBe(c.window ?? 60);

        rateCalls = [];
        await call(c, { "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
        expect(mine(c.fn).map((a) => a.p_ip)).toEqual(["198.51.100.4"]);
      });

      it("an IPv6 caller rotating inside its /64 stays one bucket", async () => {
        await call(c, { "cf-connecting-ip": "2001:db8:1:2::aaaa" });
        await call(c, { "cf-connecting-ip": "2001:db8:1:2:ffff:ffff:ffff:1" });
        expect([...new Set(mine(c.fn).map((a) => a.p_ip))]).toEqual(["2001:db8:1:2::/64"]);
      });

      it("a refused count stops the request before any model call (429 rate_limited_function)", async () => {
        rate = (a) => ({ data: a.p_ip === "global", error: null });
        const r = await call(c, { "cf-connecting-ip": "198.51.100.4" });
        expect(r.status).toBe(429);
        expect(r.body.code).toBe("rate_limited_function");
        expect(r.headers.get("retry-after")).toMatch(/^\d+$/);
        expect(aiBodies.length, "the model was asked anyway").toBe(0);
      });

      it("a count that errors, or answers nothing, is a refusal (503), never a pass", async () => {
        for (const v of [{ data: null, error: { message: "boom" } }, { data: null, error: null }]) {
          rate = () => v;
          const r = await call(c, { "cf-connecting-ip": "198.51.100.4" });
          expect(r.status, JSON.stringify(v)).toBe(503);
          expect(r.body.code).toBe("limiter_unavailable");
        }
        expect(aiBodies.length, "a limiter that could not count let the model run").toBe(0);
      });

      if (c.global) {
        it(`a function-wide ceiling of ${c.global}/hour bounds a rotating address pool`, async () => {
          rate = (a) => ({ data: a.p_ip !== "global", error: null });
          const r = await call(c, { "cf-connecting-ip": "198.51.100.4" });
          expect(world(c.fn).map((a) => [a.p_max_requests, a.p_window_minutes])).toEqual([[c.global, 60]]);
          expect(r.status).toBe(429);
          expect(r.body.code).toBe("rate_limited_global");
          expect(aiBodies.length).toBe(0);
        });
      } else {
        it("a purchase-gated generator has no function-wide ceiling for strangers to exhaust", async () => {
          await call(c, { "cf-connecting-ip": "198.51.100.4" });
          expect(world(c.fn)).toEqual([]);
        });
      }

      it("an allowed request reaches the model, and every model request carries an output cap", async () => {
        await call(c, { "cf-connecting-ip": "198.51.100.4" });
        expect(aiBodies.length, `${c.fn} never asked the model`).toBeGreaterThan(0);
        for (const b of aiBodies) {
          const cap = (b.max_tokens ?? b.max_completion_tokens) as number | undefined;
          expect(typeof cap, `${c.fn} -> ${String(b.model)} sent no output cap`).toBe("number");
          expect(cap!).toBeLessThanOrEqual(16_000);
        }
      });

      it("our own servers (the service-role key) are not counted", async () => {
        await call(c, { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "cf-connecting-ip": "198.51.100.4" });
        expect(rateCalls.filter((a) => a.p_function === c.fn)).toEqual([]);
        expect(aiBodies.length).toBeGreaterThan(0);
      });

      it("answers its build on the preflight, so a deploy is provable without a model call", async () => {
        const res = await handlers.get(c.fn)!(new Request(`https://harness.supabase.co/functions/v1/${c.fn}`, { method: "OPTIONS" }));
        expect(res.headers.get("x-fn-build")).toBe(`${c.fn}.2026-10-04.1`);
      });
    });
  }
});

describe("a paid delivery is not charged to the free tier's ceiling", () => {
  for (const fn of ["generate-cover-letter", "generate-interview-coach", "generate-career-path", "generate-tailored-resume"]) {
    it(`${fn}: a claimed session skips the global bucket; a made-up one does not`, async () => {
      const c = CASES.find((x) => x.fn === fn)!;
      await call({ ...c, body: { ...c.body, sessionId: PAID } }, { "cf-connecting-ip": "198.51.100.4" });
      expect(mine(fn).length).toBe(1);
      expect(world(fn)).toEqual([]);
      rateCalls = [];
      await call({ ...c, body: { ...c.body, sessionId: "cs_never_paid" } }, { "cf-connecting-ip": "198.51.100.4" });
      expect(world(fn).length).toBe(1);
    });
  }
});

describe("the free cover-letter primary bounds its input like its stream twin", () => {
  it("a résumé over 50,000 characters is refused before the count and the model", async () => {
    const c = CASES.find((x) => x.fn === "generate-cover-letter")!;
    const r = await call({ ...c, body: { ...c.body, resumeText: "x".repeat(50_001) } }, { "cf-connecting-ip": "198.51.100.4" });
    expect(r.status).toBe(400);
    expect(rateCalls).toEqual([]);
    expect(aiBodies).toEqual([]);
  });

  it("a long tone, title or context cannot carry an essay into the prompt", async () => {
    const c = CASES.find((x) => x.fn === "generate-cover-letter")!;
    await call({ ...c, body: { ...c.body, tone: "t".repeat(5000), jobTitle: "j".repeat(5000), personalizationContext: "p".repeat(50_000) } }, { "cf-connecting-ip": "198.51.100.4" });
    const prompt = JSON.stringify(aiBodies[0]?.messages ?? []);
    expect(prompt).not.toMatch(/t{31}/);
    expect(prompt).not.toMatch(/j{201}/);
    expect(prompt).not.toMatch(/p{2001}/);
  });
});
