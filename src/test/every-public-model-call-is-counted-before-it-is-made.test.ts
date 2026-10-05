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
 *   - our own servers (the service-role key) are not counted by address or
 *     ceiling; a purchase they name still is.
 * Paid generators refuse a stranger before the model anyway. The review of
 * 2026-10-04 added what this file now also runs: a purchase-gated generator
 * counts nothing until the call is about to reach the model (a warm-up ping,
 * which anyone can make our egress address send, and an unpaid stranger spend
 * no slot), and one purchase has a daily allowance of its own on every
 * generator; on the free ones a purchase is off the ceiling only for a product
 * the function delivers (a $2 scan pack is not), and the retired
 * tailored-resume stream answers 410 without reading anything.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { createHash } from "node:crypto";

/** The purchase's bucket, computed here independently of the gate: "sess:" and 32 hex of a hash, never the id. */
const sessionBucket = async (id: string) => `sess:${createHash("sha256").update(`spend-session:${id}`).digest("hex").slice(0, 32)}`;

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
  { fn: "generate-freelance-boost", perAddress: 20, body: { sessionId: PAID, targetRole: "Product designer", projects: [{ clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "", duration: "3 months" }] } },
];
/** The generators whose own purchase check (assertPaidSession) runs before the gate. */
const CHECKED_FIRST = ["generate-keyword-fix", "generate-career-snapshot", "generate-graduate-gameplan", "generate-premium-package", "generate-premium-package-stream", "generate-cover-letter-stream"];

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
  handlers.set("generate-tailored-resume-stream", await loadEdgeHandler("generate-tailored-resume-stream", STUBS));
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

const NOT_AN_ADDRESS = /^(global|proven|sess:|user:|pass:)/;
const mine = (fn: string) => rateCalls.filter((a) => a.p_function === fn && !NOT_AN_ADDRESS.test(a.p_ip));
const world = (fn: string) => rateCalls.filter((a) => a.p_function === fn && a.p_ip === "global");
const purchase = (fn: string) => rateCalls.filter((a) => a.p_function === fn && a.p_ip.startsWith("sess:"));

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

      it("our own servers (the service-role key) are not counted by address or ceiling", async () => {
        await call(c, { authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "cf-connecting-ip": "198.51.100.4" });
        const seen = rateCalls.filter((a) => a.p_function === c.fn);
        expect(seen.filter((a) => !a.p_ip.startsWith("sess:")), "a server call was counted by address or ceiling").toEqual([]);
        // A purchase the server names (every paid generator's body carries one) still counts.
        expect(seen.length).toBe(typeof c.body.sessionId === "string" ? 1 : 0);
        expect(aiBodies.length).toBeGreaterThan(0);
      });

      it("answers its build on the preflight, so a deploy is provable without a model call", async () => {
        const res = await handlers.get(c.fn)!(new Request(`https://harness.supabase.co/functions/v1/${c.fn}`, { method: "OPTIONS" }));
        // That build or a later one: a later change to the same function
        // (the 2026-10-05 payments wave rebuilt two of these) carries the
        // gate forward under its own build string.
        expect(res.headers.get("x-fn-build")).toMatch(new RegExp(`^${c.fn}\\.2026-10-(0[4-9]|[1-3]\\d)\\.\\d+$`));
      });
    });
  }
});

describe("a purchase is off a free generator's ceiling only for a product that generator delivers", () => {
  const DELIVERS: Record<string, string[]> = {
    "generate-cover-letter": ["cover_letter", "apply_assistant"],
    "generate-interview-coach": ["interview_coach"],
    "generate-career-path": ["career_path_simulator"],
  };
  for (const [fn, products] of Object.entries(DELIVERS)) {
    for (const product of products) {
      it(`${fn}: a ${product} purchase skips the ceiling and spends its own daily allowance`, async () => {
        db.rows("used_stripe_sessions").push({ session_id: "cs_bought", product_type: product });
        const c = CASES.find((x) => x.fn === fn)!;
        rate = (a) => ({ data: a.p_ip !== "global", error: null }); // the anonymous ceiling is spent
        const r = await call({ ...c, body: { ...c.body, sessionId: "cs_bought" } }, { "cf-connecting-ip": "198.51.100.4" });
        expect(r.status, JSON.stringify(r.body)).not.toBe(429);
        expect(world(fn)).toEqual([]);
        expect(purchase(fn).map((a) => [a.p_ip, a.p_window_minutes])).toEqual([[await sessionBucket("cs_bought"), 1440]]);
        expect(aiBodies.length).toBeGreaterThan(0);
      });
    }
    it(`${fn}: a scan pack, a NULL product or a made-up session is charged to the ceiling like anyone`, async () => {
      db.rows("used_stripe_sessions").push({ session_id: "cs_scan", product_type: "scan_pack" });
      db.rows("used_stripe_sessions").push({ session_id: "cs_null", product_type: null });
      const c = CASES.find((x) => x.fn === fn)!;
      rate = (a) => ({ data: a.p_ip !== "global", error: null });
      for (const sessionId of ["cs_scan", "cs_null", "cs_never_paid"]) {
        rateCalls = [];
        const r = await call({ ...c, body: { ...c.body, sessionId } }, { "cf-connecting-ip": "198.51.100.4" });
        expect(r.status, sessionId).toBe(429);
        expect(r.body.code).toBe("rate_limited_global");
        expect(purchase(fn), `${sessionId} was given a purchase allowance`).toEqual([]);
      }
      expect(aiBodies).toEqual([]);
    });
  }

  it("generate-tailored-resume delivers no purchase, so no session is ever off its ceiling", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_kit", product_type: "apply_assistant" });
    const c = CASES.find((x) => x.fn === "generate-tailored-resume")!;
    rate = (a) => ({ data: a.p_ip !== "global", error: null });
    const r = await call({ ...c, body: { ...c.body, sessionId: "cs_kit" } }, { "cf-connecting-ip": "198.51.100.4" });
    expect(r.body.code).toBe("rate_limited_global");
    expect(aiBodies).toEqual([]);
  });

  it("ATTACK (review of 2026-10-04): a $2 scan-pack session, isPremium, fifty addresses, ceiling spent -- not one call reaches the model", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_live_scanpack", product_type: "scan_pack" });
    rate = (a) => ({ data: a.p_ip !== "global", error: null });
    const c = CASES.find((x) => x.fn === "generate-interview-coach")!;
    const statuses: number[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await call({ ...c, body: { ...c.body, isPremium: true, sessionId: "cs_live_scanpack" } }, { "cf-connecting-ip": `198.51.100.${i + 1}` });
      statuses.push(r.status);
    }
    expect([...new Set(statuses)]).toEqual([429]);
    expect(world("generate-interview-coach").length).toBe(50);
    expect(aiBodies).toEqual([]);
  });

  it("one real purchase cannot feed a pool: past its daily allowance it is charged to the ceiling", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_coach", product_type: "interview_coach" });
    const sess = await sessionBucket("cs_coach");
    rate = (a) => ({ data: a.p_ip !== "global" && a.p_ip !== sess, error: null }); // its day spent, the ceiling spent
    const c = CASES.find((x) => x.fn === "generate-interview-coach")!;
    const r = await call({ ...c, body: { ...c.body, sessionId: "cs_coach" } }, { "cf-connecting-ip": "198.51.100.77" });
    expect(r.body.code).toBe("rate_limited_global");
    expect(aiBodies).toEqual([]);
  });
});

describe("a purchase-gated generator counts only a call that is about to reach the model", () => {
  for (const fn of CHECKED_FIRST) {
    const c = () => CASES.find((x) => x.fn === fn)!;

    it(`${fn}: a warm-up ping and an unpaid stranger spend no slot at all`, async () => {
      for (const body of [{ _warmup: true, timestamp: 1 }, { ...c().body, sessionId: "cs_never_paid" }, { ...c().body, sessionId: undefined }]) {
        const r = await handlers.get(fn)!(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.4" },
          body: JSON.stringify(body),
        }));
        expect([400, 402], JSON.stringify(body)).toContain(r.status);
      }
      expect(rateCalls, "a call that was never going to reach the model spent a slot").toEqual([]);
      expect(aiBodies).toEqual([]);
    });
  }

  for (const c of CASES.filter((x) => x.global === undefined)) {
    it(`${c.fn}: one purchase has a daily allowance of its own, and past it the call is refused before the model`, async () => {
      await call(c, { "cf-connecting-ip": "198.51.100.4" });
      expect(purchase(c.fn).map((a) => [a.p_ip, a.p_max_requests, a.p_window_minutes])).toEqual([[await sessionBucket(PAID), 10, 1440]]);
      rateCalls = [];
      aiBodies = [];
      rate = (a) => ({ data: !a.p_ip.startsWith("sess:"), error: null });
      const r = await call(c, { "cf-connecting-ip": "198.51.100.5" });
      expect(r.status).toBe(429);
      expect(r.body.code).toBe("rate_limited_session");
      expect(aiBodies).toEqual([]);
    });
  }
});

describe("the warm-up spends nothing on any function it pings", () => {
  // warm-up posts {_warmup:true} with the publishable key from our own egress
  // address, and anyone can ask it to. Read its list from its source so a
  // function added there is held here too.
  const src = readFileSync(resolve(__dirname, "../../supabase/functions/warm-up/index.ts"), "utf8");
  const list = src.slice(src.indexOf("const FUNCTIONS_TO_WARM = ["), src.indexOf("];", src.indexOf("const FUNCTIONS_TO_WARM = [")));
  const warmed = [...list.matchAll(/^\s*'([a-z0-9-]+)',/gm)].map((m) => m[1]);
  const gated = warmed.filter((fn) => handlers.has(fn) || CASES.some((c) => c.fn === fn));

  it("parses the list (a broken regex would hold nothing)", () => {
    expect(warmed).toContain("generate-cover-letter");
    expect(warmed).toContain("generate-keyword-fix");
    expect(warmed, "the retired stream is still being warmed").not.toContain("generate-tailored-resume-stream");
    expect(gated.length).toBeGreaterThanOrEqual(5);
  });

  for (const fn of ["generate-cover-letter", "generate-cover-letter-stream", "generate-tailored-resume", "generate-summary", "generate-keyword-fix"]) {
    it(`${fn}: a warm-up ping is refused before any count or model call`, async () => {
      expect(warmed).toContain(fn);
      const r = await handlers.get(fn)!(new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.4" },
        body: JSON.stringify({ _warmup: true, timestamp: 1 }),
      }));
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(rateCalls).toEqual([]);
      expect(aiBodies).toEqual([]);
    });
  }
});

describe("the retired tailored-resume stream does nothing at all", () => {
  it("answers 410 to a request carrying a claimed session, without a count, a database read or a model call", async () => {
    db.rows("used_stripe_sessions").push({ session_id: "cs_live_scanpack", product_type: "scan_pack" });
    const reads = vi.spyOn(db, "from");
    const res = await handlers.get("generate-tailored-resume-stream")!(new Request("https://harness.supabase.co/functions/v1/generate-tailored-resume-stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.4" },
      body: JSON.stringify({ resumeText: RESUME, jobTitle: "Engineer", jobDescription: POSTING, sessionId: "cs_live_scanpack" }),
    }));
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("retired");
    expect(rateCalls).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(aiBodies).toEqual([]);
  });

  it("still answers its build on the preflight", async () => {
    const res = await handlers.get("generate-tailored-resume-stream")!(new Request("https://harness.supabase.co/functions/v1/generate-tailored-resume-stream", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("generate-tailored-resume-stream.2026-10-04.1");
  });
});

describe("the free cover-letter primary bounds its input like its stream twin", () => {
  it("a résumé over 50,000 characters is refused before the count and the model", async () => {
    const c = CASES.find((x) => x.fn === "generate-cover-letter")!;
    const r = await call({ ...c, body: { ...c.body, resumeText: "x".repeat(50_001) } }, { "cf-connecting-ip": "198.51.100.4" });
    expect(r.status).toBe(400);
    expect(rateCalls).toEqual([]);
    expect(aiBodies).toEqual([]);
  });

  it("a posting over 20,000 characters is cut, not refused: a board listing or a stored posting may be that long", async () => {
    const c = CASES.find((x) => x.fn === "generate-cover-letter")!;
    const r = await call({ ...c, body: { ...c.body, jobDescription: `${"q".repeat(30_000)}` } }, { "cf-connecting-ip": "198.51.100.4" });
    expect(r.status).not.toBe(400);
    const prompt = JSON.stringify(aiBodies[0]?.messages ?? []);
    expect(prompt).toMatch(/q{20000}/);
    expect(prompt).not.toMatch(/q{20001}/);
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
