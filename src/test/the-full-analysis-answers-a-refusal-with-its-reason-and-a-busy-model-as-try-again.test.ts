// @vitest-environment node
/**
 * THE FULL ANALYSIS ANSWERS A REFUSAL WITH ITS REASON, AND A BUSY MODEL AS
 * "TRY AGAIN" (RC-S13-048, S14X-110; bug round 2026-11-12).
 *
 * WHAT WAS WRONG.
 * - RC-S13-048: every refusal that ends a purchase (refunded, not a Full
 *   Analysis, a purchase Stripe cannot find, one already used) answered a
 *   bare English sentence and nothing a page could read. The success page
 *   took any of them for "the résumé is missing" and asked a refunded buyer to
 *   paste their résumé, then showed the English sentence and "contact
 *   support".
 * - S14X-110: the model gateway's 429 was answered 429 "Too many requests",
 *   its 402 as a bare 503, and the function's other 503s carried no retryable
 *   flag, so the page told a buyer whose purchase was untouched to contact
 *   support.
 *
 * NOW every terminal refusal carries a code the page reads (purchase_refunded,
 * payment_required, purchase_not_found, session_used); a Stripe outage while
 * reading the purchase is a retryable 503, never "not found"; the gateway's
 * 429 is a 503 model_busy with Retry-After, its 402 a 503 ai_unavailable, and
 * every 503 says retryable: true. Nothing is redeemed by any of them.
 *
 * The shipped handler runs (helpers/analyze-resume-harness.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";

let h: Harness;
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  h = await analyzeResumeHarness();
}, 240_000);

beforeEach(() => {
  h.reset();
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});

const buy = (id: string, over = {}) => h.sessions.set(id, fullAnalysisSession(id, over));
const nothingRedeemed = () => {
  expect(h.db.rows("purchased_content"), "a refusal redeemed the purchase").toHaveLength(0);
  expect(h.db.rows("resume_analyses")).toHaveLength(0);
};

describe("a refusal that ends the purchase names why (RC-S13-048)", () => {
  it("a refunded purchase answers 402 purchase_refunded", async () => {
    buy("cs_live_refunded1");
    h.db.rows("payment_revocations").push({ stripe_session_id: "cs_live_refunded1", reason: "refund" });
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_refunded1" });
    expect(r.status).toBe(402);
    expect(r.json.code).toBe("purchase_refunded");
    expect(r.json.retryable).toBeUndefined();
    nothingRedeemed();
  });

  it("a paid session for another product answers 402 payment_required", async () => {
    buy("cs_live_coverletter1", { metadata: { product_type: "cover_letter", originalCurrency: "usd", baseAmountUSD: "5" } });
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_coverletter1" });
    expect(r.status).toBe(402);
    expect(r.json.code).toBe("payment_required");
    nothingRedeemed();
  });

  it("a reference that is no purchase, and a session Stripe does not know, answer 401 purchase_not_found", async () => {
    const notARef = await h.call({ resumeText: RESUME, sessionId: "not-a-purchase" });
    expect(notARef.status).toBe(401);
    expect(notARef.json.code).toBe("purchase_not_found");
    const unknown = await h.call({ resumeText: RESUME, sessionId: "cs_live_nobodyboughtthis" });
    expect(unknown.status).toBe(401);
    expect(unknown.json.code).toBe("purchase_not_found");
    nothingRedeemed();
  });

  it("a session another product already used answers 409 session_used", async () => {
    buy("cs_live_usedelsewhere");
    h.db.rows("used_stripe_sessions").push({ session_id: "cs_live_usedelsewhere", product_type: "cover_letter", ip_address: null });
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_usedelsewhere" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("session_used");
  });

  it("a delivered analysis whose stored copy is gone answers 409 session_used", async () => {
    buy("cs_live_copygone");
    h.db.rows("purchased_content").push({ stripe_session_id: "cs_live_copygone", product_type: "full_analysis", generated_content: { shareId: "0123456789abcdef01234567" } });
    const r = await h.call({ resumeText: "", sessionId: "cs_live_copygone" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("session_used");
  });

  it("Stripe unreachable while reading the purchase is a retryable 503, never 'not found'", async () => {
    buy("cs_live_stripedown");
    const real = g.__fakeStripe as { retrieve: (id: string) => Promise<unknown> };
    g.__fakeStripe = { retrieve: async () => { throw Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" }); } };
    try {
      const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_stripedown" });
      expect(r.status, "a Stripe outage told a paying buyer their purchase does not exist").toBe(503);
      expect(r.json.code).toBe("stripe_unavailable");
      expect(r.json.retryable).toBe(true);
      nothingRedeemed();
    } finally {
      g.__fakeStripe = real;
    }
  });
});

describe("a busy or unavailable model is a retryable 503 (S14X-110)", () => {
  it("the gateway's 429 on every model is 503 model_busy with Retry-After, not the caller's 429", async () => {
    buy("cs_live_busy1");
    h.aiPlan.push(429);
    const res = await h.handler(new Request("https://harness.supabase.co/functions/v1/analyze-resume", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ resumeText: RESUME, sessionId: "cs_live_busy1" }),
    }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    const body = await res.json();
    expect(body).toMatchObject({ code: "model_busy", retryable: true });
    nothingRedeemed();
  });

  it("the gateway's 402 is 503 ai_unavailable, retryable", async () => {
    buy("cs_live_credits1");
    h.aiPlan.push(402);
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_credits1" });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: "ai_unavailable", retryable: true });
    nothingRedeemed();
  });

  it("a gateway 500 stays a 500 with no retryable flag", async () => {
    buy("cs_live_broken1");
    h.aiPlan.push(500);
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_broken1" });
    expect(r.status).toBe(500);
    expect(r.json.retryable).toBeUndefined();
  });

  it("the function's own 503s say retryable: the redemption lookup failing, and the store refusing the copy", async () => {
    buy("cs_live_dbdown1");
    h.db.faults.push({ table: "purchased_content", op: "select", error: { message: "connection reset" } });
    const lookup = await h.call({ resumeText: RESUME, sessionId: "cs_live_dbdown1" });
    expect(lookup.status).toBe(503);
    expect(lookup.json.retryable).toBe(true);

    h.reset();
    buy("cs_live_storefull");
    h.db.faults.push({ table: "resume_analyses", op: "insert", error: { message: "disk full" } });
    const store = await h.call({ resumeText: RESUME, sessionId: "cs_live_storefull" });
    expect(store.status).toBe(503);
    expect(store.json.retryable).toBe(true);
    nothingRedeemed();
  });
});
