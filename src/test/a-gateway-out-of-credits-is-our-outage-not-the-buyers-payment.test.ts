// @vitest-environment node
/**
 * A GATEWAY OUT OF CREDITS IS OUR OUTAGE, NOT THE BUYER'S PAYMENT (S14X-109).
 *
 * When the AI gateway answered 402 (our account's credits ran out), the
 * Cover Letter answered the buyer 402 "AI service credits depleted", final;
 * the Premium Package answered 402 "credits depleted, contact support" for
 * the résumé and threw a bare 500 for the letter; ATS Defense answered 500.
 * The success page reads a 402 as a purchase it cannot find, so a paid buyer
 * was told, in effect, that they had not paid, and nothing said to try again.
 *
 * Each now answers a retryable 503 with code ai_unavailable and a
 * Retry-After, and says the purchase is safe. Run as shipped with only the
 * network faked; the gateway answers 402 to every model asked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { post, WritingWorld, WRITING_STUBS } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const RESUME = "Maria Lopez\nRegistered Nurse (RN), BSN\nSt. Mary's Hospital, Staff Nurse, 2018-2024: cared for 6 patients a shift.\nSkills: patient assessment, EHR charting.";
const POSTING = "We are looking for an experienced ICU nurse to join our team in Denver. You will care for critically ill patients.";
const handlers = new Map<string, EdgeHandler>();
let world: WritingWorld;

beforeAll(async () => {
  new WritingWorld().install();
  const paid = "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', status: 'complete', amount_total: 1500, customer_details: { email: 'b@example.com' }, metadata: { product_type: 'ats_defense' } }) } }; } }";
  for (const fn of ["generate-cover-letter", "generate-premium-package", "generate-ats-defense"]) {
    handlers.set(fn, await loadEdgeHandler(fn, { ...WRITING_STUBS, "https://esm.sh/stripe@18.5.0": paid }));
  }
}, 240_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.db.rows("used_stripe_sessions").push(
    { session_id: "cs_live_letter", product_type: "cover_letter" },
    { session_id: "cs_live_premium", product_type: "premium_package" },
  );
  world.reply = () => new Response(JSON.stringify({ error: "insufficient credits" }), { status: 402 });
});

const CALLS: Array<{ fn: string; who: string; body: Record<string, unknown> }> = [
  { fn: "generate-cover-letter", who: "anon", body: { resumeText: RESUME, jobTitle: "ICU Nurse", jobDescription: POSTING, sessionId: "cs_live_letter" } },
  { fn: "generate-premium-package", who: "service", body: { resumeText: RESUME, jobTitle: "ICU Nurse", jobCompany: "Denver Health", jobDescription: POSTING, sessionId: "cs_live_premium" } },
  { fn: "generate-ats-defense", who: "service", body: { resumeText: RESUME, sessionId: "cs_live_ats" } },
];

describe.each(CALLS)("$fn, when the gateway is out of credits", ({ fn, who, body }) => {
  it("answers a retryable 503 ai_unavailable with a Retry-After, never a 402 or a final refusal", async () => {
    const r = await post(handlers.get(fn)!, fn, body, who);
    expect(world.ai.length, "the model was never asked").toBeGreaterThan(0);
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body).toMatchObject({ code: "ai_unavailable", retryable: true });
    expect(r.headers.get("retry-after")).toBe("300");
    expect(String(r.body.error)).toMatch(/purchase is safe/);
    expect(JSON.stringify(r.body)).not.toMatch(/credits depleted|contact support/i);
  });
});
