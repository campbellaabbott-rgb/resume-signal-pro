/**
 * SEVEN PAID GENERATORS WERE FREE TO ANYONE ON THE INTERNET.
 *
 * Measured against production 2026-08-06 with an empty-body probe and no
 * credential at all. Two endpoints refused it — generate-keyword-fix (402
 * "requires a completed purchase") and generate-ats-defense (401) — which is
 * what proves the probe detects gating rather than merely finding a validation
 * error. Every other paid generator answered 400 "Resume text is required":
 * past the gate, into input validation. Supply resumeText and the product comes
 * out, on our AI spend.
 *
 * THE SHAPE OF THE BUG. Every STREAMING variant was gated in July and recorded
 * as closed. The NON-STREAM primary of the same product was not — and per this
 * project's own architecture, non-stream is the PRIMARY path and stream is the
 * fallback. The fix landed on the fallback and missed the main road.
 *
 * WHY THIS FILE ENUMERATES INSTEAD OF LISTING. A hand-written list of gated
 * endpoints is exactly what already existed, informally, and it went stale the
 * moment a product was added. This derives the paid product types from
 * stripe-webhook's own dispatch — the thing that decides what a purchase turns
 * into — so a new paid product with no gate fails here rather than in the wild.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const F = (p: string) => readFileSync(resolve(__dirname, "../../supabase/functions", p), "utf8");
const webhook = F("stripe-webhook/index.ts");
const retry = F("retry-failed-deliveries/index.ts");
const verify = F("verify-product-purchase/index.ts");

/**
 * Endpoints the public product ALSO offers free, where an unconditional gate
 * would break a working feature rather than close a leak.
 *
 * This is an allow-list on purpose: an exception has to be written down with a
 * reason, and anything not named here must be gated. Silence is not consent.
 */
const DUAL_USE: Record<string, string> = {
  "generate-cover-letter":
    "the public job board calls this free from Jobs.tsx with an identical body shape, so the function cannot tell a buyer from a board user",
  "generate-interview-coach":
    "Jobs.tsx calls it free for likely-interview-questions; only isPremium:true is the paid tier",
  "generate-career-path":
    "has a free tier via isPremium:false; only the premium path is sold",
};

/** product_type -> generator endpoint, read from the webhook's own switch. */
function paidRoutes(): Array<{ productType: string; endpoint: string }> {
  const out: Array<{ productType: string; endpoint: string }> = [];
  const re = /case\s+'([a-z_]+)':\s*endpoint\s*=\s*'([a-z-]+)'/g;
  for (const m of webhook.matchAll(re)) out.push({ productType: m[1], endpoint: m[2] });
  return out;
}

describe("the webhook's paid products all reach a gated generator", () => {
  const routes = paidRoutes();

  it("parses the dispatch at all — an empty list would pass every test below", () => {
    expect(routes.length, "no product routes parsed; the regex broke, not the code")
      .toBeGreaterThanOrEqual(6);
  });

  for (const { productType, endpoint } of routes) {
    it(`${productType} -> ${endpoint} verifies payment`, () => {
      const path = `${endpoint}/index.ts`;
      expect(existsSync(resolve(__dirname, "../../supabase/functions", path)),
        `${endpoint} does not exist`).toBe(true);
      const src = F(path);

      // Either the shared gate, or its own payment verification (ats-defense
      // does a real Stripe session lookup; freelance-boost checks entitlement).
      const gated = src.includes("assertPaidSession")
        || /Payment verification|payment_status|checkout\.sessions\.retrieve/.test(src);

      if (DUAL_USE[endpoint]) {
        expect(gated, `${endpoint} is listed DUAL_USE but now gates — remove it from the list`)
          .toBe(false);
        return;
      }
      expect(gated, `${endpoint} generates a PAID product with no payment check`).toBe(true);
    });
  }
});

describe("every caller hands the generator its proof of purchase", () => {
  // The gate reads used_stripe_sessions by sessionId. A gated endpoint whose
  // caller omits sessionId 402s a real buyer — which is the failure mode the
  // webhook already documents for ats_defense, and the reason this is threaded
  // in ONE place per caller rather than per product branch.
  it("stripe-webhook puts sessionId in the shared generator body", () => {
    const body = webhook.slice(webhook.indexOf("const body: Record<string, unknown> = {"));
    expect(body.slice(0, 900)).toMatch(/\bsessionId\b/);
  });

  it("retry-failed-deliveries passes the delivery's own session", () => {
    const body = retry.slice(retry.indexOf("const body: Record<string, unknown> = {"));
    expect(body.slice(0, 900)).toMatch(/sessionId: delivery\.stripe_session_id/);
  });

  it("verify-product-purchase passes it for each gated product", () => {
    for (const ep of ["generate-premium-package", "generate-graduate-gameplan", "generate-career-snapshot"]) {
      const i = verify.indexOf(`endpoint: '${ep}'`);
      expect(i, `${ep} not routed in verify-product-purchase`).toBeGreaterThan(-1);
      expect(verify.slice(i, i + 260), `${ep} must receive sessionId`).toMatch(/\bsessionId\b/);
    }
  });

  it("ProductSuccess sets it once for every product, not per branch", () => {
    // Per-branch assignment is how the original leak survived: keyword-fix got
    // its sessionId line and the branches beside it did not.
    const ui = readFileSync(resolve(__dirname, "../pages/ProductSuccess.tsx"), "utf8");
    expect(ui).toMatch(/let body: Record<string, unknown> = \{ resumeText, sessionId \}/);
  });
});

describe("the streaming twins stay gated", () => {
  // These were the ones fixed in July. If a refactor ever drops the gate here,
  // the same hole reopens on the fallback path.
  for (const ep of ["generate-cover-letter-stream", "generate-premium-package-stream", "generate-tailored-resume-stream"]) {
    it(`${ep} still calls assertPaidSession`, () => {
      expect(F(`${ep}/index.ts`)).toContain("assertPaidSession");
    });
  }
});
