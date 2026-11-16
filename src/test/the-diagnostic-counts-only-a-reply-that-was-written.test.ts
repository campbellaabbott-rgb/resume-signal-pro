// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE DIAGNOSTIC COUNTS ONLY A REPLY THAT WAS WRITTEN (S13-065).
 *
 * test-ai-fallback called a chain healthy on any 200: a reply cut off by
 * thinking inside its 50 tokens, with no text at all, was a pass.
 *
 * Held here: the diagnostic passes a chain only when a model wrote text, says
 * which model did, and sizes its cap for the thinking production allows.
 *
 * The free product preview this suite also held is retired (NB-10): it
 * answers 410 and calls nothing
 * (the-product-preview-endpoint-is-retired-and-no-page-asks-it).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { WritingWorld, chatReply, loadWriter, post, type AiCall } from "./helpers/writing-harness";
import { DEFAULT_MODELS, THINKING_TOKENS } from "../../supabase/functions/_shared/ai-fallback";
import { SCAN_MODEL_CHAIN } from "../../supabase/functions/_shared/scan-models";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const cutOff = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content } }] }), { status: 200 });

let world: WritingWorld;
const capOf = (c: AiCall) => Number(c.body.max_tokens ?? c.body.max_completion_tokens);

describe("test-ai-fallback, run as shipped", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("test-ai-fallback");
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
  });
  // The diagnostic answers only the admin key or our own servers (M-S14-056).
  const ask = (mode = "quick") => post(handler, "test-ai-fallback", { mode }, "service");

  it("a chain whose every model answered 200 with no text is not healthy", async () => {
    world.reply = () => cutOff("");
    const r = await ask();
    expect(r.status).toBe(500);
    expect(r.body.success).toBe(false);
    const chains = r.body.chains as Array<{ name: string; success: boolean }>;
    expect(chains.map((c) => c.success)).toEqual([false, false]);
  });

  it("a primary that wrote nothing falls to the next model, and the model that wrote the text is named, with the text as proof", async () => {
    world.reply = (c) => (c.model === DEFAULT_MODELS[0] ? chatReply("   ") : chatReply("AI fallback test successful"));
    const r = await ask();
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const [paid, scan] = r.body.chains as Array<{ success: boolean; modelUsed: string; usedFallback: boolean; reply?: string }>;
    expect(paid).toMatchObject({ success: true, modelUsed: DEFAULT_MODELS[1], usedFallback: true, reply: "AI fallback test successful" });
    expect(scan).toMatchObject({ success: true, modelUsed: SCAN_MODEL_CHAIN[0], usedFallback: false, reply: "AI fallback test successful" });
  });

  it("each model alone (mode all) passes only when it wrote text", async () => {
    world.reply = (c) => (c.model === "google/gemini-2.5-pro" ? cutOff("") : chatReply("AI fallback test successful"));
    const r = await ask("all");
    const results = r.body.results as Array<{ model: string; success: boolean }>;
    expect(results.find((x) => x.model === "google/gemini-2.5-pro")?.success).toBe(false);
    expect(results.filter((x) => x.model !== "google/gemini-2.5-pro").every((x) => x.success)).toBe(true);
  });

  it("its cap leaves room for the thinking production allows", async () => {
    world.reply = () => chatReply("AI fallback test successful");
    await ask();
    for (const c of world.ai) expect(capOf(c), c.model).toBe(50 + THINKING_TOKENS);
  });
});
