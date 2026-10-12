// @vitest-environment node
/**
 * A PAID FREELANCE SECTION SURVIVES A BAD REPLY, AND IS WHOLE BEFORE IT IS DELIVERED.
 *
 * S12-055: one gemini-2.5-pro call capped at 3,000 tokens (its thinking
 * included) truncated the JSON for a buyer with three to five projects; the
 * truncated reply was a 500, no other model was tried, and the $59 buyer
 * looped on errors. Now 8,000 tokens, each model in the chain in turn, and a
 * retryable 502 only when every reply was unusable.
 *
 * S12-105: a Transition Pro reply with no cover letter or LinkedIn About was
 * saved and the order closed as delivered. Those two texts are part of what a
 * reply must hold to be a delivery at all.
 *
 * S12-107: the structure table never gave a buyer freelancing alongside a job
 * (the page's default) the Projects section its own note described.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { chatReply, loadWriter, post, WritingWorld, WRITING_STUBS } from "./helpers/writing-harness";
import { loadEdgeHandler } from "./helpers/edge-harness";
import { BOOST_MAX_TOKENS, decideStructure, readBoostReply } from "../../supabase/functions/generate-freelance-boost/boost";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const project = (i: number) => ({ clientType: `client ${i}`, problem: "no bookings", deliverable: "a booking site", toolsSkills: "Figma", outcome: "bookings doubled", duration: "3 months" });

describe("the structure table (S12-107)", () => {
  it("one to three projects alongside a job get the Projects section; four or more the part-time role", () => {
    for (const n of [1, 2, 3]) {
      const s = decideStructure({ projects: Array.from({ length: n }, (_, i) => project(i)), overlapsEmployment: true });
      expect(s.structure, `${n} projects`).toBe("projects_section");
      expect(s.note).toMatch(/alongside a job/);
    }
    const four = decideStructure({ projects: [1, 2, 3, 4].map(project), overlapsEmployment: true });
    expect(four.structure).toBe("consolidated_part_time");
  });

  it("a note says only what is true of the buyer: no 'alongside employment' for someone who is not", () => {
    const primaryTwo = decideStructure({ projects: [1, 2].map(project), freelanceWasPrimary: true });
    expect(primaryTwo.structure).toBe("projects_section");
    expect(primaryTwo.note).not.toMatch(/alongside/i);
  });
});

const goodReply = (transitionPro: boolean) => JSON.stringify({
  roleTitle: "Independent UX Consultant",
  scopeStatement: "",
  projects: [{ index: 0, clientLabel: "dental practice", relevance: 8, bullets: ["Designed and shipped a booking site that doubled bookings"], keywordsCovered: [] }],
  transitionParagraph: "I moved into UX through client work.",
  gapHandling: "Show dates.",
  ...(transitionPro ? {
    transitionCoverLetter: Array.from({ length: 200 }, () => "word").join(" "),
    linkedinAbout: Array.from({ length: 90 }, () => "word").join(" "),
  } : {}),
});

describe("readBoostReply", () => {
  it("a truncated reply is not a deliverable", () => {
    const full = goodReply(false);
    for (const cut of [10, 40, 100, full.length - 5]) expect(readBoostReply(full.slice(0, cut), { transitionPro: false }).ok, `cut at ${cut}`).toBe(false);
    expect(readBoostReply(full, { transitionPro: false }).ok).toBe(true);
  });

  it("a Transition Pro reply without its cover letter or LinkedIn About is not a deliverable (S12-105)", () => {
    expect(readBoostReply(goodReply(false), { transitionPro: true })).toMatchObject({ ok: false });
    expect(readBoostReply(goodReply(true), { transitionPro: true }).ok).toBe(true);
  });

  it("a reply whose every bullet is a banned phrasing has nothing to deliver", () => {
    const banned = JSON.stringify({ projects: [{ bullets: ["Worked on various clients"] }] });
    expect(readBoostReply(banned, { transitionPro: false }).ok).toBe(false);
  });
});

const PAID_BOOST = "cs_boost_paid";
const PAID_TRANSITION = "cs_transition_paid";
let handler: EdgeHandler;
let world: WritingWorld;

beforeAll(async () => {
  new WritingWorld().install();
  handler = await loadEdgeHandler("generate-freelance-boost", {
    ...WRITING_STUBS,
    "https://esm.sh/stripe@18.5.0":
      "export default class Stripe { constructor() { this.checkout = { sessions: { retrieve: async (id) => ({ id, payment_status: 'paid', customer_details: { email: 'b@example.com' }, metadata: { product_type: id.includes('transition') ? 'freelance_transition_pro' : 'freelance_boost' } }) } }; } }",
  });
}, 180_000);

beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.db.rpcs.save_purchased_content = () => ({ data: null, error: null });
  world.db.rows("product_deliveries").push(
    { stripe_session_id: PAID_BOOST, status: "pending" },
    { stripe_session_id: PAID_TRANSITION, status: "pending" },
  );
});

const delivered = (session: string) => world.db.rows("product_deliveries").find((r) => r.stripe_session_id === session)?.status;
const body = (sessionId: string, n = 5) => ({ sessionId, targetRole: "UX designer", projects: Array.from({ length: n }, (_, i) => project(i)), overlapsEmployment: true });

describe("generate-freelance-boost, run as shipped", () => {
  it("asks for 8,000 tokens, and a truncated first reply moves on to the next model instead of failing", async () => {
    world.reply = (call) => chatReply(call.model === "google/gemini-2.5-pro" ? goodReply(false).slice(0, 60) : goodReply(false));
    const r = await post(handler, "generate-freelance-boost", body(PAID_BOOST), "anon");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.ai.map((c) => c.model)).toEqual(["google/gemini-2.5-pro", "google/gemini-2.5-flash"]);
    for (const c of world.ai) expect(c.body.max_tokens ?? c.body.max_completion_tokens).toBe(BOOST_MAX_TOKENS);
    expect(delivered(PAID_BOOST)).toBe("delivered");
  });

  it("every reply unusable: a retryable 502, and the order is not marked delivered", async () => {
    world.reply = () => chatReply(goodReply(false).slice(0, 60));
    const r = await post(handler, "generate-freelance-boost", body(PAID_BOOST), "anon");
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ code: "draft_unusable", retryable: true });
    expect(world.ai.length).toBe(3);
    expect(delivered(PAID_BOOST)).toBe("pending");
  });

  it("a Transition Pro reply missing its letter is not delivered; the next model's whole reply is", async () => {
    world.reply = (call) => chatReply(goodReply(call.model !== "google/gemini-2.5-pro"));
    const r = await post(handler, "generate-freelance-boost", body(PAID_TRANSITION), "anon");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const data = r.body.data as Record<string, string>;
    expect(data.transitionCoverLetter.split(" ").length).toBeGreaterThanOrEqual(150);
    expect(data.linkedinAbout.length).toBeGreaterThan(0);
    expect(delivered(PAID_TRANSITION)).toBe("delivered");
  });

  it("a Transition Pro buyer whose every reply lacks the letter gets a 502 and an open order", async () => {
    world.reply = () => chatReply(goodReply(false));
    const r = await post(handler, "generate-freelance-boost", body(PAID_TRANSITION), "anon");
    expect(r.status).toBe(502);
    expect(delivered(PAID_TRANSITION)).toBe("pending");
  });

  it("an 'alongside' buyer with one project is written a Projects section", async () => {
    world.reply = () => chatReply(goodReply(false));
    const r = await post(handler, "generate-freelance-boost", body(PAID_BOOST, 1), "anon");
    expect((r.body.data as Record<string, string>).structure).toBe("projects_section");
  });
});
