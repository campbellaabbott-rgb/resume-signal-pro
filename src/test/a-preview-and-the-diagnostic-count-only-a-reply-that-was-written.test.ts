// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A PREVIEW AND THE DIAGNOSTIC COUNT ONLY A REPLY THAT WAS WRITTEN (S13-065).
 *
 * generate-product-preview asked gemini-2.5-flash for its four fields inside
 * max_tokens 600, with flash's thinking counted against the cap, and turned
 * an empty or unparsable reply into a 500 from the first model, the rest of
 * the chain unused. test-ai-fallback called a chain healthy on any 200: a
 * reply cut off by thinking inside its 50 tokens, with no text at all, was a
 * pass.
 *
 * Held here:
 *   - the preview's cap is re-measured from its fields, with at most 10%
 *     headroom, and those fields are the JSON its prompt asks for;
 *   - a preview reply cut off at its cap, empty, not JSON or with no body goes
 *     to the next model; when none writes one, the person is told to try
 *     again in words, not in model names;
 *   - the diagnostic passes a chain only when a model wrote text, says which
 *     model did, and sizes its cap for the thinking production allows.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { WritingWorld, chatReply, loadWriter, post, type AiCall } from "./helpers/writing-harness";
import { PREVIEW_FIELDS, PREVIEW_FORMAT, PREVIEW_OUTPUT_TOKENS, readPreviewReply } from "../../supabase/functions/generate-product-preview/preview-reply";
import { DEFAULT_MODELS, THINKING_TOKENS } from "../../supabase/functions/_shared/ai-fallback";
import { SCAN_MODEL_CHAIN } from "../../supabase/functions/_shared/scan-models";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work at Acme Corp. Led a team of five. ".repeat(3);
const PREVIEW = { heading: "A stronger first bullet", body: "Led a five-person payments team at Acme Corp, shipping TypeScript and Postgres services.", before: "Worked on payments.", note: null };
const cutOff = (content: string) => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content } }] }), { status: 200 });

describe("the preview's cap is measured from its fields", () => {
  it("the largest legitimate reply, at 3 characters a token, with at most 10% headroom", () => {
    const largest = JSON.stringify(Object.fromEntries(Object.entries(PREVIEW_FIELDS).map(([k, n]) => [k, "x".repeat(n)]))).length;
    const measured = Math.ceil(largest / 3);
    expect(PREVIEW_OUTPUT_TOKENS).toBeGreaterThanOrEqual(measured);
    expect(PREVIEW_OUTPUT_TOKENS).toBeLessThanOrEqual(Math.ceil(measured * 1.1));
    // 600 with thinking in it was the old cap; the measured reply alone is more than half of it.
    expect(measured * 2).toBeGreaterThan(600);
  });

  it("the fields are the JSON the prompt asks for", () => {
    expect([...PREVIEW_FORMAT.matchAll(/"([a-z]+)":/g)].map((m) => m[1]).sort()).toEqual(Object.keys(PREVIEW_FIELDS).sort());
  });

  it("no product's task asks for a body longer than 2-3 sentences, the length the body is measured at", () => {
    const code = readFileSync(resolve(__dirname, "../../supabase/functions/generate-product-preview/index.ts"), "utf8");
    const instructions = [...code.matchAll(/instruction:\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(instructions.length).toBeGreaterThan(8);
    for (const text of instructions) {
      expect(text, text.slice(0, 60)).not.toMatch(/\b([4-9]|\d{2,})(\s*-\s*\d+)?\s+sentences|\bparagraphs\b|\bfull letter\b(?!\.)/i);
      for (const m of text.matchAll(/(\d+)\s*-\s*(\d+)\s+sentences/gi)) expect(Number(m[2]), text.slice(0, 60)).toBeLessThanOrEqual(3);
    }
  });
});

describe("readPreviewReply", () => {
  const data = (content: unknown) => ({ choices: [{ message: { content } }] });
  it("takes JSON with a body, or the JSON inside prose; refuses the rest", () => {
    expect(readPreviewReply(data(JSON.stringify(PREVIEW)))).toEqual({ heading: PREVIEW.heading, body: PREVIEW.body, before: PREVIEW.before, note: null });
    expect(readPreviewReply(data(`Sure: ${JSON.stringify(PREVIEW)}`))?.body).toBe(PREVIEW.body);
    for (const bad of ["", "  ", "no json here", '{"heading":"x","body":""}', '{"heading":"x","body":"null"}', '{"heading":"Stronger', "[1,2]", null, 7]) {
      expect(readPreviewReply(data(bad)), String(bad)).toBeNull();
    }
  });
});

let world: WritingWorld;
const modelsAsked = () => world.ai.map((c) => c.model);
const capOf = (c: AiCall) => Number(c.body.max_tokens ?? c.body.max_completion_tokens);

describe("generate-product-preview, run as shipped", () => {
  let handler: EdgeHandler;
  beforeAll(async () => {
    new WritingWorld().install();
    handler = await loadWriter("generate-product-preview");
  }, 240_000);
  beforeEach(() => {
    world = new WritingWorld();
    world.install();
  });
  const ask = () => post(handler, "generate-product-preview", { productId: "full_analysis", resumeText: RESUME }, "anon");

  it("asks flash with the measured cap plus its thinking, and the prompt asks for the measured fields", async () => {
    world.reply = () => chatReply(JSON.stringify(PREVIEW));
    const r = await ask();
    expect(r.status).toBe(200);
    expect(r.body.preview).toMatchObject({ heading: PREVIEW.heading, body: PREVIEW.body, before: PREVIEW.before, note: null, productId: "full_analysis" });
    expect(modelsAsked()).toEqual(["google/gemini-2.5-flash"]);
    expect(capOf(world.ai[0])).toBe(PREVIEW_OUTPUT_TOKENS + THINKING_TOKENS);
    expect(String((world.ai[0].body.messages as Array<{ content: string }>)[0].content)).toContain(PREVIEW_FORMAT);
  });

  for (const [what, reply] of [
    ["a reply cut off at its cap", () => cutOff('{"heading":"A stronger first bullet","body":"Led a five')],
    ["an empty message", () => chatReply("")],
    ["prose with no JSON", () => chatReply("Here is a great preview for you!")],
    ["JSON with no body", () => chatReply(JSON.stringify({ ...PREVIEW, body: "" }))],
  ] as const) {
    it(`${what} is not a preview: the next model is asked`, async () => {
      world.reply = (c) => (c.model === "google/gemini-2.5-flash" ? reply() : chatReply(JSON.stringify(PREVIEW)));
      const r = await ask();
      expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
      expect(modelsAsked()).toEqual(["google/gemini-2.5-flash", "google/gemini-2.5-pro"]);
      expect((r.body.preview as { body: string }).body).toBe(PREVIEW.body);
    });
  }

  it("when no model writes one, the person is asked to try again in words, not model names", async () => {
    world.reply = () => cutOff('{"heading":"');
    const r = await ask();
    expect(r.status).toBe(500);
    expect(modelsAsked()).toEqual(["google/gemini-2.5-flash", "google/gemini-2.5-pro", "openai/gpt-5-mini"]);
    expect(String(r.body.error)).toMatch(/try again/i);
    expect(String(r.body.error)).not.toMatch(/gemini|gpt|finish_reason|token/i);
  });
});

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
