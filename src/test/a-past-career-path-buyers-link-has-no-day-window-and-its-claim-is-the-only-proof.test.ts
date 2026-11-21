// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A PAST CAREER PATH BUYER'S LINK HAS NO DAY WINDOW, AND ITS CLAIM IS THE ONLY
 * PROOF (S14X-143, the owner's pick B of 2026-11-18).
 *
 * WHAT WAS WRONG. The cut-product sentence promised a past buyer's link for 90
 * days, and generate-career-path kept a second way in that counted them: when
 * a session had no claim, it asked Stripe whether the session was a paid
 * Career Path purchase made inside 90 days, behind two buckets and a table of
 * buyers Stripe had confirmed. Its premise, that a claim is purged after 30
 * days, was false: a claim is kept forever, and verify-product-purchase writes
 * one, with no age limit, before the success page asks for a path. Pick B
 * dropped the day count from the copy (ca11d1c66); this drops it from the code.
 *
 * WHAT HOLDS NOW (the shipped handlers, with only their network faked):
 *   - a Career Path claim written 400 days ago is served with the paid budget;
 *     a refunded purchase (its claim names 'refunded') and a purchase of
 *     another product are refused 402, however old;
 *   - TEETH: a session with no claim is refused without a Stripe read or a
 *     count, even one Stripe calls a paid Career Path purchase of ten days ago
 *     (2026-11-12.1 asked Stripe and served it);
 *   - TEETH: the source imports no Stripe module and declares no day count;
 *   - verify-product-purchase, the success page's first call, writes the
 *     Career Path claim for a paid, unrefunded session bought 400 days ago,
 *     and the generator then serves it; a refunded one is refused at both and
 *     claimed nowhere.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT =
  "export function createClient() { const db = globalThis.__cpwDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t), auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; } export class SupabaseClient {}";
// Every Stripe read is logged. Stripe has the sessions in __cpwSessions and no others.
const STRIPE = `export default class Stripe { constructor() {
  this.checkout = { sessions: { retrieve: async (id) => {
    globalThis.__cpwStripeReads.push(id);
    const s = globalThis.__cpwSessions[id];
    if (!s) { const e = new Error("No such checkout.session: " + id); e.type = "StripeInvalidRequestError"; e.code = "resource_missing"; e.statusCode = 404; throw e; }
    return s;
  } } };
} }`;
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  // Only verify-product-purchase still imports Stripe; generate-career-path at
  // 2026-11-12.1 did too, which is what the TEETH cases below run against.
  "https://esm.sh/stripe@18.5.0": STRIPE,
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: { id: 'm' }, error: null }) }; } }",
};

const RESUME = "Product manager with seven years in fintech, payments and lending. Led a team of six. ".repeat(4);
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

let generator: EdgeHandler;
let verify: EdgeHandler;
let db: FakeDb;
let stripeReads: string[];
let sessions: Record<string, Record<string, unknown>>;
let rateCalls: Array<Record<string, unknown>>;
let aiBodies: Array<Record<string, unknown>>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
    STRIPE_SECRET_KEY: "sk_test_harness", LOVABLE_API_KEY: "lovable_harness", RESEND_API_KEY: "re_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (input: string | URL | Request, init?: { body?: string }) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("ai.gateway.lovable.dev")) {
      aiBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ paths: [], actionPlan90Days: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };
  generator = await loadEdgeHandler("generate-career-path", STUBS);
  verify = await loadEdgeHandler("verify-product-purchase", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb({ used_stripe_sessions: ["session_id"] });
  stripeReads = [];
  sessions = {};
  rateCalls = [];
  aiBodies = [];
  db.rpcs.check_rate_limit = (a) => { rateCalls.push(a); return { data: true, error: null }; };
  db.rpcs.get_cached_response = () => ({ data: null, error: null });
  db.rpcs.store_cached_response = () => ({ data: null, error: null });
  db.rpcs.log_delivery_step = () => ({ data: "pd-1", error: null });
  db.rpcs.get_purchased_content_by_session = () => ({ data: [], error: null });
  const g = globalThis as Record<string, unknown>;
  g.__cpwDb = db;
  g.__cpwStripeReads = stripeReads;
  g.__cpwSessions = sessions;
});

/** What the success page's widget sends: the paid tier, with the purchase's session id. */
async function askForAPath(sessionId: string) {
  const res = await generator(new Request("https://harness.supabase.co/functions/v1/generate-career-path", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", apikey: "anon_harness", "cf-connecting-ip": "198.51.100.61" },
    body: JSON.stringify({ resumeText: RESUME, isPremium: true, sessionId, language: "en" }),
  }));
  return res.status;
}

/** What the success page asks first, before any widget renders. */
async function openTheLink(sessionId: string) {
  const res = await verify(new Request("https://harness.supabase.co/functions/v1/verify-product-purchase", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.62" },
    body: JSON.stringify({ sessionId, generateContent: false }),
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.clone().json(); } catch { /* not json */ }
  return { status: res.status, json };
}

const budgetOf = (b: Record<string, unknown>) => Number(b.max_tokens ?? b.max_completion_tokens);
const claim = (session_id: string, product_type: string, age: number) =>
  db.rows("used_stripe_sessions").push({ session_id, product_type, ip_address: null, used_at: daysAgo(age) });
/** A Checkout session Stripe holds: paid, for the Career Path, made `age` days ago. */
const careerPathSession = (id: string, age: number) => ({
  id, object: "checkout.session", mode: "payment", payment_status: "paid", status: "complete", livemode: true,
  amount_total: 500, currency: "usd", created: Math.floor((Date.now() - age * DAY) / 1000),
  customer_email: null, customer_details: { email: "buyer@example.com" },
  metadata: { product_type: "career_path_simulator", product_name: "Career Path Simulator" },
});

const OLD_BUYER = "cs_live_CareerPathBoughtFourHundredDaysAgo01";
const REFUNDED = "cs_live_CareerPathRefundedFourHundredDays01";
const COVER_LETTER = "cs_live_CoverLetterBoughtFourHundredDays01";
const UNCLAIMED = "cs_live_CareerPathPaidTenDaysAgoNeverClaim1";

describe("a Career Path claim is served however old it is, and only a Career Path claim", () => {
  it("a paid, unrefunded Career Path claim written 400 days ago reaches the model with the paid budget", async () => {
    claim(OLD_BUYER, "career_path_simulator", 400);
    expect(await askForAPath(OLD_BUYER)).toBe(200);
    expect(aiBodies.length).toBeGreaterThan(0);
    expect(budgetOf(aiBodies[0])).toBe(5500);
    expect(stripeReads).toEqual([]);
  });

  it("a refunded purchase 400 days old is refused 402: its claim names 'refunded', not the Career Path", async () => {
    claim(REFUNDED, "refunded", 400);
    db.rows("payment_revocations").push({ stripe_session_id: REFUNDED, reason: "refunded" });
    expect(await askForAPath(REFUNDED)).toBe(402);
    expect(aiBodies).toEqual([]);
  });

  it("another product's purchase 400 days old is refused 402, as a new one is", async () => {
    claim(COVER_LETTER, "cover_letter", 400);
    claim("cs_live_ScanPackBoughtFourHundredDaysAgo0001", "scan_pack", 400);
    claim("cs_live_CoverLetterBoughtYesterday000000001", "cover_letter", 1);
    for (const id of [COVER_LETTER, "cs_live_ScanPackBoughtFourHundredDaysAgo0001", "cs_live_CoverLetterBoughtYesterday000000001"]) {
      expect(await askForAPath(id), id).toBe(402);
    }
    expect(aiBodies).toEqual([]);
  });
});

describe("TEETH: nothing but the claim is proof, and nothing counts days", () => {
  it("a session with no claim is refused 402 without a Stripe read or a count, even one Stripe calls a paid Career Path purchase of ten days ago", async () => {
    sessions[UNCLAIMED] = careerPathSession(UNCLAIMED, 10);
    expect(await askForAPath(UNCLAIMED)).toBe(402);
    expect(stripeReads, "the generator asked Stripe about a session with no claim").toEqual([]);
    expect(rateCalls.filter((a) => String(a.p_function).includes(":stripe")), "a Stripe read bucket was counted").toEqual([]);
    expect(aiBodies).toEqual([]);
  });

  it("the source imports no Stripe module, reads no table of confirmed buyers and declares no day count", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "supabase/functions/generate-career-path/index.ts"), "utf8"));
    expect(code, "the paid tier still asks the claim").toContain("assertPaidSession(supabase, sessionId, CAREER_PATH_PRODUCTS)");
    expect(code).not.toMatch(/esm\.sh\/stripe@/);
    expect(code).not.toMatch(/checkout\.sessions\.retrieve/);
    expect(code).not.toMatch(/career_path_past_buyers/);
    expect(code).not.toMatch(/\b[A-Z_]*DAYS\s*=\s*\d/);
    expect(code).not.toMatch(/86_?400_?000/);
  });
});

describe("the success page's first call writes the claim with no age limit, and the generator serves it", () => {
  const BOUGHT_LONG_AGO = "cs_live_CareerPathPaidFourHundredDaysNoClaim";
  const REFUNDED_LONG_AGO = "cs_live_CareerPathRefundedFourHundredNoClaim";

  it("a paid, unrefunded Career Path session bought 400 days ago, with no claim, is claimed for the Career Path and then served", async () => {
    sessions[BOUGHT_LONG_AGO] = careerPathSession(BOUGHT_LONG_AGO, 400);
    const opened = await openTheLink(BOUGHT_LONG_AGO);
    expect(opened.status, JSON.stringify(opened.json)).toBe(200);
    expect(db.rows("used_stripe_sessions")).toEqual([expect.objectContaining({ session_id: BOUGHT_LONG_AGO, product_type: "career_path_simulator" })]);
    expect(await askForAPath(BOUGHT_LONG_AGO)).toBe(200);
    expect(budgetOf(aiBodies[0])).toBe(5500);
    // One read, by verify-product-purchase; the generator asked only the claim.
    expect(stripeReads).toEqual([BOUGHT_LONG_AGO]);
  });

  it("a refunded one, bought 400 days ago, is refused at both and claimed nowhere", async () => {
    sessions[REFUNDED_LONG_AGO] = careerPathSession(REFUNDED_LONG_AGO, 400);
    db.rows("payment_revocations").push({ stripe_session_id: REFUNDED_LONG_AGO, reason: "refunded" });
    const opened = await openTheLink(REFUNDED_LONG_AGO);
    expect(opened.status).toBe(402);
    expect(opened.json.refunded).toBe(true);
    expect(db.rows("used_stripe_sessions")).toEqual([]);
    expect(await askForAPath(REFUNDED_LONG_AGO)).toBe(402);
    expect(aiBodies).toEqual([]);
  });
});
