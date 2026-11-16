// @vitest-environment node
/**
 * THE APPLY KIT ASKS THE NEXT MODEL FOR A REPLY IT CANNOT READ, UNDER A CAP
 * (S14X-266).
 *
 * The kit writer asked the shared chain only to step past a 429: a 200 with no
 * submit_apply_package call (or arguments that do not parse) answered a 500
 * on the first model, and no request carried a token cap, so a model could
 * write to its own ceiling on the project's key. Now an unusable reply asks the
 * next model, and every request carries a cap that fits the largest kit plus
 * the reasoning the pro and gpt-5 legs spend against the same cap.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { THINKING_TOKENS } from "../../supabase/functions/_shared/ai-fallback";
import { WritingWorld, chatReply, loadWriter, post, tokenFor, PRO_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME, groundedKit, kitReply } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let kit: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  kit = await loadWriter("generate-apply-package");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/**
 * The largest kit a 20,000-character résumé gives: 15 roles of 8 bullets as
 * a structured résumé, with its metadata, gaps and checklist. Its tokens are
 * counted at three characters each, generous for JSON.
 */
function largestKitTokens(): number {
  const bullet = "Led a cross-functional team that rebuilt the order pipeline, cutting failed payments by a third and saving the support desk hours every week.";
  const experience = Array.from({ length: 15 }, (_, i) => ({
    company: `Employer number ${i + 1} Limited`, title: "Senior software engineer", location: "London, United Kingdom",
    startDate: `${2000 + i}`, endDate: `${2001 + i}`, bullets: Array.from({ length: 8 }, () => bullet),
  }));
  const big = groundedKit({
    summary: bullet.repeat(4),
    experience,
    education: [{ school: "University of Somewhere", degree: "BSc Computer Science", year: "1999" }],
    skills: Array.from({ length: 30 }, (_, i) => `Skill ${i}`),
  });
  (big as Record<string, unknown>).skillGaps = Array.from({ length: 10 }, (_, i) => `Gap ${i}`);
  (big as Record<string, unknown>).checklist = Array.from({ length: 6 }, () => bullet);
  return Math.ceil(JSON.stringify(big, null, 2).length / 3);
}

describe("a model whose reply carries no kit", () => {
  it("hands the request to the next model, and the kit it writes is delivered", async () => {
    world.reply = (call) => (call.model === "google/gemini-2.5-pro"
      ? chatReply("Here is your application package: a tailored résumé and a checklist.")
      : kitReply(groundedKit()));
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(PRO_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.modelUsed).toBe("openai/gpt-5");
    expect(world.ai.map((c) => c.model).slice(0, 2)).toEqual(["google/gemini-2.5-pro", "openai/gpt-5"]);
  });

  it("asks every model under a cap that fits the largest kit and the model's reasoning", async () => {
    world.reply = (call) => (call.model === "openai/gpt-5-mini" ? kitReply(groundedKit()) : chatReply("no tool call"));
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(PRO_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const floor = largestKitTokens() + THINKING_TOKENS;
    expect(world.ai.length).toBe(3);
    for (const call of world.ai) {
      const cap = Number(call.body.max_tokens ?? call.body.max_completion_tokens);
      expect(cap, `${call.model} carried no usable cap`).toBeGreaterThanOrEqual(floor);
    }
  });
});
