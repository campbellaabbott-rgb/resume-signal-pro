// @vitest-environment node
/**
 * A FAILED FREELANCE GENERATION IS WRITTEN ON THE ORDER (RC-S12-104).
 *
 * generate-freelance-boost answered a 503, 429 or 502 when no model wrote a
 * usable section, and wrote nothing anywhere: the order read as if the buyer
 * had never pressed Generate, and the owner's view of a paid order that is
 * not delivered had no reason to show. The failure is now written on the
 * order before the page is answered. The order's status is left alone (the
 * buyer can press Generate again), a delivered order is not marked failed,
 * and a write that fails never changes the buyer's answer.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { chatReply, post, WritingWorld, WRITING_STUBS } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const PAID = "cs_boost_failing_order";
let handler: EdgeHandler;
let world: WritingWorld;

beforeAll(async () => {
  new WritingWorld().install();
  handler = await loadEdgeHandler("generate-freelance-boost", {
    ...WRITING_STUBS,
    "https://esm.sh/stripe@18.5.0":
      "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', customer_details: { email: 'b@example.com' }, metadata: { product_type: 'freelance_boost' } }) } }; } }",
  });
}, 180_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.db.rpcs.save_purchased_content = () => ({ data: null, error: null });
  world.db.rows("product_deliveries").push({ stripe_session_id: PAID, status: "pending" });
});

const project = { clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "bookings doubled", duration: "3 months" };
const order = () => world.db.rows("product_deliveries").find((r) => r.stripe_session_id === PAID)!;

describe("a Freelance Boost generation that fails", () => {
  it("every model unusable: the order says draft_unusable, keeps its status, and the page gets its 502", async () => {
    world.reply = () => chatReply("{ not json");
    const r = await post(handler, "generate-freelance-boost", { sessionId: PAID, targetRole: "UX designer", projects: [project] }, "anon");
    expect(r.status).toBe(502);
    expect(order()).toMatchObject({ status: "pending", generation_success: false, generation_error: "draft_unusable" });
  });

  it("the gateway out of credits: the order says model_credits and the page gets its 503", async () => {
    world.reply = () => new Response("{}", { status: 402 });
    const r = await post(handler, "generate-freelance-boost", { sessionId: PAID, targetRole: "UX designer", projects: [project] }, "anon");
    expect(r.status).toBe(503);
    expect(order()).toMatchObject({ status: "pending", generation_error: "model_credits" });
  });

  it("an order already delivered is not marked failed by a later try", async () => {
    Object.assign(order(), { status: "delivered", generation_success: true });
    world.reply = () => chatReply("{ not json");
    const r = await post(handler, "generate-freelance-boost", { sessionId: PAID, targetRole: "UX designer", projects: [project] }, "anon");
    expect(r.status).toBe(502);
    expect(order()).toMatchObject({ status: "delivered", generation_success: true });
    expect(order().generation_error).toBeUndefined();
  });

  it("a write that fails still answers the buyer the same 502", async () => {
    world.db.faults.push({ table: "product_deliveries", op: "update", error: { message: "statement timeout" } });
    world.reply = () => chatReply("{ not json");
    const r = await post(handler, "generate-freelance-boost", { sessionId: PAID, targetRole: "UX designer", projects: [project] }, "anon");
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: "draft_unusable", retryable: true });
  });
});
