// @vitest-environment node
/**
 * SCORING A FREE ACCOUNT'S ANSWER RUNS ON THE FREE CHAIN (S14X-268).
 *
 * Every other writing call a free account makes runs on Flash; scoring an
 * interview answer asked gemini-2.5-pro first for everyone, so the free path
 * cost the quality chain's price on every submitted answer. A free account's
 * score now runs on the free chain and a paid plan's on the quality chain.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WritingWorld, chatReply, loadWriter, post, tokenFor, FREE_USER, PRO_USER } from "./helpers/writing-harness";
import { KIT_RESUME } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let coach: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  coach = await loadWriter("generate-interview-coach");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  world.reply = () => chatReply(JSON.stringify({ score: 7, strengths: ["Clear"], improvements: ["Add a figure"], improvedAnswer: "I led the payments team." }));
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const EVALUATE = { mode: "evaluate", resumeText: KIT_RESUME, question: "Tell me about a time you led a team.", answer: "I led the payments team of five engineers at Initech.", category: "Behavioral" };

describe("scoring an answer", () => {
  it("a free account's runs on gemini-2.5-flash first", async () => {
    const r = await post(coach, "generate-interview-coach", EVALUATE, tokenFor(FREE_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.ai[0]?.model).toBe("google/gemini-2.5-flash");
  });

  it("a Pro account's runs on gemini-2.5-pro first", async () => {
    const r = await post(coach, "generate-interview-coach", EVALUATE, tokenFor(PRO_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(world.ai[0]?.model).toBe("google/gemini-2.5-pro");
  });

  it("takes nothing from the account's writing allowance", async () => {
    await post(coach, "generate-interview-coach", EVALUATE, tokenFor(FREE_USER));
    expect(world.takes).toEqual([]);
    expect(world.refunds).toEqual([]);
  });
});
