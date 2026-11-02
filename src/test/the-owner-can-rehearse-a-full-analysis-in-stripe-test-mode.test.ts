// @vitest-environment node
/**
 * THE OWNER CAN REHEARSE A FULL ANALYSIS IN STRIPE TEST MODE (audit
 * 2026-10-31, S13-043; create-checkout and analyze-resume 2026-11-03.1).
 *
 * WHAT WAS WRONG. Nothing minted a test-mode Full Analysis session, and
 * analyze-resume read every session with the live key, so a cs_test_ session
 * failed as "Invalid Stripe session": the owner could not watch the $5 sale
 * deliver end to end without spending real money.
 *
 * WHAT HOLDS NOW (the shipped handlers, Stripe faked by key):
 *   - create-checkout mints the session on the test account only for the
 *     owner's key with testMode true; a visitor's testMode is ignored and
 *     the session is live; without an sk_test_ key the rehearsal says so;
 *   - analyze-resume reads a cs_test_ session with STRIPE_TEST_SECRET_KEY and
 *     delivers it, its order row marked livemode false; with no test key, or
 *     a test id that answers as a live session, it refuses as before; a live
 *     session is still read with the live key.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";
import { freshWorld, installDeno, post, W4B_ENV, W4B_STUBS } from "./helpers/w4b-checkout-harness";
import { sessionKeyFor } from "../../supabase/functions/analyze-resume/stripe-mode";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const LIVE = "sk_live_harness";
const TEST = "sk_test_rehearsal";
const ADMIN = "admin-key-harness-0123456789";

describe("analyze-resume reads a test session with the test key (S13-043)", () => {
  let h: Harness;
  const keysUsed: string[] = [];
  const extra: Record<string, string | undefined> = {};

  beforeAll(async () => {
    h = await analyzeResumeHarness({
      "https://esm.sh/stripe@18.5.0":
        "export default class Stripe { constructor(key) { this.checkout = { sessions: { retrieve: (id, opts) => globalThis.__fakeStripe.retrieve(id, opts, key) } }; } }",
    });
    const g = globalThis as Record<string, unknown>;
    const base = (g.Deno as { env: { get: (k: string) => string | undefined } }).env.get;
    g.Deno = { env: { get: (k: string) => (k in extra ? extra[k] : base(k)) } };
    const fake = g.__fakeStripe as { retrieve: (id: string, opts?: unknown) => Promise<unknown> };
    const retrieve = fake.retrieve;
    g.__fakeStripe = {
      // A test session exists only on the test account, and a live one only on the live account.
      retrieve: async (id: string, opts: unknown, key: string) => {
        keysUsed.push(key);
        if (id.startsWith("cs_test_") !== key.startsWith("sk_test_")) throw new Error(`No such checkout.session: '${id}'`);
        return retrieve(id, opts);
      },
    };
  }, 180_000);

  beforeEach(() => {
    h.reset();
    keysUsed.length = 0;
    extra.STRIPE_SECRET_KEY = LIVE;
    extra.STRIPE_TEST_SECRET_KEY = TEST;
  });

  it("delivers a cs_test_ session read with the test key, and marks its order livemode false", async () => {
    const id = "cs_test_rehearsal_0001";
    h.sessions.set(id, { ...fullAnalysisSession(id), livemode: false } as ReturnType<typeof fullAnalysisSession>);
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, JSON.stringify(r.json).slice(0, 200)).toBe(200);
    expect(keysUsed).toEqual([TEST]);
    await h.settle();
    const order = h.db.rows("product_deliveries").find((o) => o.stripe_session_id === id);
    expect((order?.metadata as Record<string, unknown> | undefined)?.livemode).toBe(false);
  });

  it("refuses a cs_test_ session when no sk_test_ key is set, and makes no model call", async () => {
    extra.STRIPE_TEST_SECRET_KEY = undefined;
    const id = "cs_test_rehearsal_0002";
    h.sessions.set(id, { ...fullAnalysisSession(id), livemode: false } as ReturnType<typeof fullAnalysisSession>);
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status).toBe(401);
    expect(h.aiCalls()).toBe(0);
  });

  it("refuses a test id that answers as a live session", async () => {
    const id = "cs_test_rehearsal_0003";
    h.sessions.set(id, { ...fullAnalysisSession(id), livemode: true } as ReturnType<typeof fullAnalysisSession>);
    expect((await h.call({ resumeText: RESUME, sessionId: id })).status).toBe(401);
    expect(h.aiCalls()).toBe(0);
  });

  it("still reads a live session with the live key", async () => {
    const id = "cs_live_paid_0004";
    h.sessions.set(id, fullAnalysisSession(id));
    expect((await h.call({ resumeText: RESUME, sessionId: id })).status).toBe(200);
    expect(keysUsed).toEqual([LIVE]);
  });

  it("chooses the key by the session id alone", () => {
    const env = (m: Record<string, string>) => (k: string) => m[k];
    expect(sessionKeyFor("cs_test_x", env({ STRIPE_SECRET_KEY: LIVE, STRIPE_TEST_SECRET_KEY: TEST }))).toEqual({ key: TEST, testMode: true });
    expect(sessionKeyFor("cs_test_x", env({ STRIPE_SECRET_KEY: LIVE, STRIPE_TEST_SECRET_KEY: "sk_live_wrong" }))).toEqual({ key: undefined, testMode: true });
    expect(sessionKeyFor("cs_live_x", env({ STRIPE_SECRET_KEY: LIVE, STRIPE_TEST_SECRET_KEY: TEST }))).toEqual({ key: LIVE, testMode: false });
  });
});

describe("create-checkout mints a test session for the owner only (S13-043)", () => {
  let checkout: EdgeHandler;
  const env: Record<string, string | undefined> = { ...W4B_ENV, STRIPE_SECRET_KEY: LIVE, STRIPE_TEST_SECRET_KEY: TEST, ADMIN_API_KEY: ADMIN };
  let minted: string[];

  beforeAll(async () => {
    installDeno(env);
    const g = globalThis as Record<string, unknown>;
    g.__mintKeys = () => minted;
    checkout = await loadEdgeHandler("create-checkout", {
      ...W4B_STUBS,
      "https://esm.sh/stripe@18.5.0": `export default class Stripe { constructor(key) {
        this.promotionCodes = { list: async () => ({ data: [] }) };
        this.checkout = { sessions: { create: async (p) => {
          globalThis.__mintKeys().push(key);
          const id = (key.startsWith("sk_test_") ? "cs_test_" : "cs_live_") + "mint" + globalThis.__mintKeys().length;
          return { id, url: "https://checkout.stripe.com/c/" + id, amount_total: 500, currency: "usd", mode: p.mode };
        } } };
      } }`,
    });
  }, 180_000);

  beforeEach(() => {
    installDeno(env);
    freshWorld();
    minted = [];
    env.STRIPE_TEST_SECRET_KEY = TEST;
  });

  const buy = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    post(checkout, "create-checkout", { tempSessionId: "00000000-0000-4000-8000-0000000000ac", currency: "usd", ...body }, { headers });

  it("the owner's key with testMode true mints on the test account", async () => {
    const res = await buy({ testMode: true }, { "x-admin-key": ADMIN });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/cs_test_/);
    expect(minted).toEqual([TEST]);
  });

  it("a visitor's testMode is ignored: the session is live", async () => {
    const res = await buy({ testMode: true });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/cs_live_/);
    expect(minted).toEqual([LIVE]);
    const wrong = await buy({ testMode: true }, { "x-admin-key": "not-the-key" });
    expect((await wrong.json()).url).toMatch(/cs_live_/);
  });

  it("without an sk_test_ key the rehearsal says so and mints nothing", async () => {
    env.STRIPE_TEST_SECRET_KEY = "sk_live_not_a_test_key";
    const res = await buy({ testMode: true }, { "x-admin-key": ADMIN });
    expect(res.status).toBe(503);
    expect(minted).toEqual([]);
  });
});
