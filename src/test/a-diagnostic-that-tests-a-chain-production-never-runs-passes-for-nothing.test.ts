// @vitest-environment node
/**
 * A DIAGNOSTIC THAT TESTS A CHAIN PRODUCTION NEVER RUNS PASSES FOR NOTHING
 * (wave 2 email-ops, register L10-19).
 *
 * WHAT WAS WRONG. test-ai-fallback -- the /health-check "AI Model Fallback
 * Chain" panel -- said it tested "the same" chain as production and tested
 * gpt-5 -> gemini-2.5-pro -> gpt-5-mini, sending max_completion_tokens to every
 * model. Production runs two different chains: the paid deliverables'
 * DEFAULT_MODELS (gemini-2.5-pro -> gemini-2.5-flash -> gpt-5-mini, max_tokens
 * for Google) through the shared callAIWithModelFallback, and the free
 * scanner's flash -> pro -> gpt-4o-mini. A green panel described a
 * configuration nobody used.
 *
 * WHAT HOLDS NOW, by running the shipped handler with the gateway faked: a
 * quick test walks exactly the two production chains, in their order, each
 * model asked with the parameters the shared helper sends it; a model that
 * production does not run is never called; and the scanner's chain is the
 * list free-keyword-scan itself walks.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { DEFAULT_MODELS } from "../../supabase/functions/_shared/ai-fallback";
import { SCAN_MODEL_CHAIN } from "../../supabase/functions/_shared/scan-models";

const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LOVABLE_API_KEY: "lov" };
const asked: Array<Record<string, unknown>> = [];
let failModels = new Set<string>();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  g.__aiDb = db;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.fetch = async (url: string, init: { body: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const b = JSON.parse(init.body);
      asked.push(b);
      if (failModels.has(b.model)) return new Response(JSON.stringify({ error: "down" }), { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "AI fallback test successful" } }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("test-ai-fallback", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__aiDb; }",
  });
}, 60_000);

beforeEach(() => { asked.length = 0; failModels = new Set(); });

const run = (mode: string) => handler(new Request("https://harness.supabase.co/functions/v1/test-ai-fallback", {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ mode }),
}));

describe("the quick test walks the chains production runs", () => {
  it("each chain's first model, in the order production tries them, and nothing production never calls", async () => {
    const j = await (await run("quick")).json();
    expect(j.success).toBe(true);
    expect(asked.map((a) => a.model)).toEqual([DEFAULT_MODELS[0], SCAN_MODEL_CHAIN[0]]);
    expect(j.chains.map((c: { name: string; models: string[] }) => [c.name, c.models])).toEqual([["paid deliverables", [...DEFAULT_MODELS]], ["free scanner", [...SCAN_MODEL_CHAIN]]]);
    expect(asked.some((a) => a.model === "openai/gpt-5"), "the diagnostic called a model no production chain runs").toBe(false);
  });

  it("a failing primary falls through to the next model of the same production chain", async () => {
    failModels = new Set([DEFAULT_MODELS[0]]);
    const j = await (await run("quick")).json();
    expect(j.chains[0]).toMatchObject({ success: true, modelUsed: DEFAULT_MODELS[1], usedFallback: true });
    expect(j.modelUsed).toBe(DEFAULT_MODELS[1]);
  });

  it("each model is asked the way the shared helper asks it: max_tokens for Google, max_completion_tokens for OpenAI", async () => {
    await run("all");
    const seen = new Set(asked.map((a) => a.model));
    expect([...seen].sort()).toEqual([...new Set([...DEFAULT_MODELS, ...SCAN_MODEL_CHAIN])].sort());
    for (const a of asked) {
      if (String(a.model).startsWith("google/")) {
        expect(a, String(a.model)).toHaveProperty("max_tokens", 50);
        expect(a, String(a.model)).not.toHaveProperty("max_completion_tokens");
      } else {
        expect(a, String(a.model)).toHaveProperty("max_completion_tokens", 50);
      }
    }
  });
});

describe("the scanner's chain is the one the scanner walks", () => {
  it("free-keyword-scan builds its fallback order from the shared list", async () => {
    // Run the list through the module the scanner imports, not a copy of it.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const code = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).toMatch(/import \{ SCAN_MODEL_CHAIN \} from "\.\.\/_shared\/scan-models\.ts";/);
    expect(code).toMatch(/const MODEL_FALLBACK_ORDER: string\[\] = \[\.\.\.SCAN_MODEL_CHAIN\];/);
    expect(SCAN_MODEL_CHAIN).toEqual(["google/gemini-2.5-flash", "google/gemini-2.5-pro", "openai/gpt-4o-mini"]);
  });
});
