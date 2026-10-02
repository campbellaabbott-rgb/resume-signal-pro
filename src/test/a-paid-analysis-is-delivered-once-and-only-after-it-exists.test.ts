// @vitest-environment node
/**
 * A PAID ANALYSIS IS DELIVERED ONCE, AND ONLY AFTER IT EXISTS.
 *
 * WHAT WAS WRONG, three ways at once, all live since December 2025:
 *
 *   1. analyze-resume refused any session worth less than $20 unless a
 *      discount was applied. The floor was written when the analysis cost $25;
 *      the price was cut to $5 a week later and the floor never moved. Every
 *      full-price buyer, in every currency, got 402.
 *   2. stripe-webhook claims every paid session in used_stripe_sessions before
 *      it looks at the product, then has nothing to deliver for this one; the
 *      success page's call then found the claim and answered 409.
 *   3. analyze-resume wrote its own claim BEFORE the AI call, so a single
 *      gateway failure turned every retry with the same session into a 409.
 *
 * So the one product sold from the homepage could not be delivered by any
 * path, and the sweep that should have noticed (product_deliveries) read 0.
 *
 * THE PROPERTY, exercised against the shipped handler (helpers/edge-harness):
 * a paid full-analysis session is judged by WHAT IT BOUGHT; it yields exactly
 * one analysis, written only once that analysis exists; asking again returns
 * that same analysis rather than a second one or an error; a failure before
 * the analysis exists leaves the session redeemable; and nothing the
 * redemption records can be presented as a purchase of another product.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertPaidSession } from "../../supabase/functions/_shared/paid-session";
import { analyzeResumeHarness, fullAnalysisSession, RESUME, type Harness } from "./helpers/analyze-resume-harness";

let h: Harness;
beforeAll(async () => { h = await analyzeResumeHarness(); }, 60_000);
beforeEach(() => { h.reset(); });

const buy = (id: string, over = {}) => { h.sessions.set(id, fullAnalysisSession(id, over)); return id; };

describe("a paid full analysis is delivered", () => {
  it("to a buyer who paid the $5 list price", async () => {
    const id = buy("cs_live_list_price");
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, `a $5 purchase was answered ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`).toBe(200);
    expect(r.json.optimizedBullets).toBeTruthy();
    expect(typeof r.json.shareId).toBe("string");
    expect(h.aiCalls()).toBe(1);
  });

  it("when the webhook has already claimed the session for this same product", async () => {
    const id = buy("cs_live_webhook_first");
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: "full_analysis", ip_address: null });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, "the webhook's claim is proof of payment, not a redemption").toBe(200);
  });

  it("when a webhook from before claims named their product claimed it (no product, no address)", async () => {
    // The live webhook carries no build marker, so nothing proves it is newer
    // than 20260827180000. If analyze-resume deploys first, this is the claim
    // every buyer of that window meets; it is a payment claim, not a redemption.
    const id = buy("cs_live_old_webhook_first");
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: null, ip_address: null });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status, `an old webhook's claim was answered ${r.status}: ${JSON.stringify(r.json).slice(0, 120)}`).toBe(200);
    await h.settle();
    expect(h.db.rows("used_stripe_sessions").find((c) => c.session_id === id)?.product_type,
      "the unnamed claim was left a key to every paid generator").toBe("full_analysis");
  });

  it("and, when no delivery row exists, opens exactly one -- delivered, for this product", async () => {
    // product_deliveries read 0 for 365 days: the webhook is not reaching its
    // insert. This row is then the only record that the purchase arrived.
    const id = buy("cs_live_row_missing");
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status).toBe(200);
    await h.settle();
    const rows = h.db.rows("product_deliveries").filter((d) => d.stripe_session_id === id);
    expect(rows.map((d) => [d.status, d.product_type, d.generation_success]), "a delivered purchase left no delivery record").toEqual([["delivered", "full_analysis", true]]);
  });

  it("and the webhook's open delivery row is closed as delivered", async () => {
    const id = buy("cs_live_row_open");
    h.db.rows("product_deliveries").push({ id: "pd-open", stripe_session_id: id, product_type: "full_analysis", status: "payment_received", retry_count: 0, max_retries: 3, next_retry_at: "infinity" });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status).toBe(200);
    await h.settle();
    const rows = h.db.rows("product_deliveries").filter((d) => d.stripe_session_id === id);
    expect(rows.map((d) => d.status)).toEqual(["delivered"]);
  });
});

describe("a failure before the analysis exists leaves the session redeemable", () => {
  // Both prices: the pre-fix floor let a promotion-code purchase through, so
  // that row is where the claim-before-the-analysis defect showed by itself.
  for (const [label, over] of [
    ["list price", {}],
    ["a promotion code", { amount_total: 100, total_details: { amount_discount: 400 } }],
  ] as const) {
    it(`an AI gateway failure, then a retry with the same session, delivers (${label})`, async () => {
      const id = buy(`cs_live_ai_flake_${label.replace(/\W+/g, "_")}`, over);
      h.aiPlan.push(500);
      const first = await h.call({ resumeText: RESUME, sessionId: id });
      expect(first.status).toBe(500);
      const retry = await h.call({ resumeText: RESUME, sessionId: id });
      expect(retry.status, `the retry after a failed AI call was answered ${retry.status}: ${JSON.stringify(retry.json).slice(0, 120)}`).toBe(200);
      expect(retry.json.optimizedBullets).toBeTruthy();
    });
  }

  it("a transient failure writing the redemption refuses, and the retry delivers", async () => {
    const id = buy("cs_live_db_flake");
    h.db.faults.push({ table: "purchased_content", op: "insert", error: { message: "fake: statement timeout" } });
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status, "nothing was redeemed, so nothing may be handed out").toBe(503);
    expect(h.db.rows("resume_analyses"), "the copy that was not redeemed is not left behind").toHaveLength(0);
    const retry = await h.call({ resumeText: RESUME, sessionId: id });
    expect(retry.status).toBe(200);
  });
});

describe("one session, one analysis", () => {
  it("asking again returns the SAME analysis, with no second AI call", async () => {
    const id = buy("cs_live_refresh");
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status).toBe(200);
    const again = await h.call({ resumeText: `${RESUME} A DIFFERENT RESUME ENTIRELY.`, sessionId: id });
    expect(again.status, `the second ask was answered ${again.status}`).toBe(200);
    expect(again.json.shareId).toBe(first.json.shareId);
    expect(again.json.marker, "a second analysis was produced for one purchase").toBe(first.json.marker);
    expect(again.json.alreadyDelivered).toBe(true);
    expect(h.aiCalls()).toBe(1);
  });

  it("two requests racing on one session hand back one analysis between them", async () => {
    const id = buy("cs_live_race");
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    h.aiPlan.push(gate, gate);
    const a = h.call({ resumeText: RESUME, sessionId: id });
    const b = h.call({ resumeText: `${RESUME} second tab`, sessionId: id });
    for (let i = 0; i < 200 && h.aiCalls() < 2; i++) await new Promise((r) => setImmediate(r));
    expect(h.aiCalls(), "both requests must be inside the AI call at once for this to be a race").toBe(2);
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(ra.json.shareId).toBe(rb.json.shareId);
    expect(ra.json.marker).toBe(rb.json.marker);
    expect(h.db.rows("purchased_content")).toHaveLength(1);
    expect(h.db.rows("resume_analyses"), "the losing request's analysis must not survive as a second deliverable").toHaveLength(1);
  });

  it("a cached analysis is redeemed through the same single gate", async () => {
    const id = buy("cs_live_cached");
    h.cache.value = { marker: "from-cache", optimizedBullets: [{}], actionVerbs: [], keywords: {}, redFlags: [] };
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status).toBe(200);
    const again = await h.call({ resumeText: RESUME, sessionId: id });
    expect(again.status).toBe(200);
    expect(again.json.shareId).toBe(first.json.shareId);
    expect(h.db.rows("resume_analyses")).toHaveLength(1);
    expect(h.aiCalls()).toBe(0);
  });

  it("a session the pre-fix code already redeemed (a claim with no product, beside the caller's address) is not redeemed again", async () => {
    const id = buy("cs_live_legacy_redeemed");
    h.db.rows("used_stripe_sessions").push({ session_id: id, product_type: null, ip_address: "198.51.100.1" });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status).toBe(409);
    expect(h.aiCalls()).toBe(0);
  });

  it("a redeemed session whose analysis has since been deleted is refused, never re-analysed", async () => {
    const id = buy("cs_live_deleted");
    const first = await h.call({ resumeText: RESUME, sessionId: id });
    expect(first.status).toBe(200);
    h.db.tables.resume_analyses = [];
    const again = await h.call({ resumeText: RESUME, sessionId: id });
    expect(again.status).toBe(409);
    expect(h.aiCalls()).toBe(1);
  });
});

describe("a session is judged by what it bought", () => {
  it("a paid session for another product is refused, at any price", async () => {
    h.sessions.set("cs_live_scan_pack", fullAnalysisSession("cs_live_scan_pack", { amount_total: 9900, metadata: { product_type: "scan_pack" } }));
    const r = await h.call({ resumeText: RESUME, sessionId: "cs_live_scan_pack" });
    expect(r.status).toBe(402);
    expect(h.aiCalls()).toBe(0);
  });

  it("an unpaid full-analysis session is refused", async () => {
    const id = buy("cs_live_unpaid", { payment_status: "unpaid" });
    const r = await h.call({ resumeText: RESUME, sessionId: id });
    expect(r.status).toBe(402);
    expect(h.aiCalls()).toBe(0);
  });

  it("no session, or one Stripe does not know, is refused before any spend", async () => {
    expect((await h.call({ resumeText: RESUME })).status).toBe(401);
    expect((await h.call({ resumeText: RESUME, sessionId: "cs_live_never_minted" })).status).toBe(401);
    expect(h.aiCalls()).toBe(0);
  });
});

describe("nothing the redemption records unlocks another product", () => {
  for (const [label, over] of [
    ["list price", {}],
    ["a promotion code", { amount_total: 100, total_details: { amount_discount: 400 } }],
  ] as const) {
    it(`a full-analysis session bought at ${label} is not proof of purchase for the premium package`, async () => {
      const id = buy(`cs_live_unlock_${label.replace(/\W+/g, "_")}`, over);
      const r = await h.call({ resumeText: RESUME, sessionId: id });
      expect(r.status).toBe(200);
      await h.settle();
      const claim = h.db.rows("used_stripe_sessions").find((c) => c.session_id === id);
      expect(claim?.product_type, "a claim with no product is accepted by every paid generator").toBe("full_analysis");
      expect(await assertPaidSession(h.db, id, ["premium_package"]), "a $5 receipt opened the $12 package").not.toBeNull();
      const redeemed = h.db.rows("purchased_content").find((c) => c.stripe_session_id === id);
      expect(redeemed?.product_type).toBe("full_analysis");
    });
  }
});

describe("the redemption verdict, case by case (the pure rule the handler applies)", () => {
  // Imported lazily so the handler tests above stay runnable on a tree where
  // this module does not exist yet -- which is how they were shown red.
  it("reads a claim for this product -- or an unnamed one with no address -- as paid-not-delivered, and every other prior row as a refusal", async () => {
    const { priorRedemptionOf, fullAnalysisRefusal } = await import("../../supabase/functions/_shared/full-analysis");
    expect(priorRedemptionOf(null, null)).toEqual({ state: "none" });
    expect(priorRedemptionOf(null, { product_type: "full_analysis" })).toEqual({ state: "none" });
    expect(priorRedemptionOf(null, { product_type: null }).state).toBe("refused");
    expect(priorRedemptionOf(null, { product_type: null, ip_address: "198.51.100.1" }).state).toBe("refused");
    expect(priorRedemptionOf(null, { product_type: null, ip_address: null })).toEqual({ state: "none" });
    expect(priorRedemptionOf(null, { product_type: "scan_pack" }).state).toBe("refused");
    expect(priorRedemptionOf({ product_type: "full_analysis", generated_content: { shareId: "abc" } }, { product_type: null }))
      .toEqual({ state: "delivered", shareId: "abc" });
    expect(priorRedemptionOf({ product_type: "full_analysis", generated_content: {} }, null)).toEqual({ state: "delivered", shareId: null });
    expect(priorRedemptionOf({ product_type: "premium_package", generated_content: {} }, null).state).toBe("refused");
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: { product_type: "full_analysis" } })).toBeNull();
    expect(fullAnalysisRefusal({ payment_status: "paid", metadata: {} })).toMatch(/names no product/);
    expect(fullAnalysisRefusal({ payment_status: "no_payment_required", metadata: { product_type: "full_analysis" } })).toMatch(/payment_status/);
    expect(fullAnalysisRefusal(null)).toBe("no session");
  });
});
