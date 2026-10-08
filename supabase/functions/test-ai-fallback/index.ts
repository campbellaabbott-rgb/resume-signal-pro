// deploy-stamp: 2026-10-08T12:00Z
//
// THE CHAINS PRODUCTION RUNS, CALLED THE WAY PRODUCTION CALLS THEM (register
// L10-19). This diagnostic claimed to test "the same" model chain as
// production and tested gpt-5 -> gemini-2.5-pro -> gpt-5-mini with
// max_completion_tokens for every model -- a chain no production path runs,
// with a parameter Google models do not take from our callers. Production has
// two chains: the paid deliverables' DEFAULT_MODELS through the shared
// callAIWithModelFallback (_shared/ai-fallback.ts), and the free scanner's
// SCAN_MODEL_CHAIN (_shared/scan-models.ts). Both are imported here and both
// are walked through the shared helper, so a pass means what it says.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { modelSpendGate } from "../_shared/model-spend-gate.ts";
import { callAIWithModelFallback, DEFAULT_MODELS } from "../_shared/ai-fallback.ts";
import { SCAN_MODEL_CHAIN } from "../_shared/scan-models.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "test-ai-fallback.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

const TEST_LIMITS = { perAddress: 3, globalPerHour: 30 };
/** Each chain's whole budget: a diagnostic must answer well inside the platform's limit. */
const CHAIN_BUDGET_MS = 40_000;

/** The production chains, by the name the dashboard prints. */
export const PRODUCTION_CHAINS: ReadonlyArray<{ name: string; models: readonly string[] }> = [
  { name: "paid deliverables", models: DEFAULT_MODELS },
  { name: "free scanner", models: SCAN_MODEL_CHAIN },
];

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[TEST-AI-FALLBACK] ${step}`, details ? JSON.stringify(details) : "");
};

const TEST_MESSAGES = [
  { role: "system", content: "You are a helpful assistant. Respond briefly." },
  { role: "user", content: "Say 'AI fallback test successful' and nothing else." },
];

type ChainResult = { name: string; models: string[]; success: boolean; modelUsed: string | null; usedFallback: boolean; totalTime: number; status?: number; error?: string };

async function testChain(apiKey: string, name: string, models: readonly string[]): Promise<ChainResult> {
  const start = Date.now();
  try {
    const { response, modelUsed } = await callAIWithModelFallback(apiKey, {
      messages: TEST_MESSAGES,
      maxTokens: 50,
      models: [...models],
      context: `TEST-AI-FALLBACK ${name}`,
      deadlineMs: CHAIN_BUDGET_MS,
    });
    const ok = response.ok;
    if (!ok) await response.body?.cancel().catch(() => {});
    else await response.json().catch(() => null);
    return {
      name, models: [...models], success: ok, modelUsed, usedFallback: modelUsed !== models[0],
      totalTime: Date.now() - start, status: response.status,
      ...(ok ? {} : { error: `HTTP ${response.status} from ${modelUsed}` }),
    };
  } catch (e) {
    return { name, models: [...models], success: false, modelUsed: null, usedFallback: false, totalTime: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // RATE LIMITED, because every call here is N PAID model invocations on the
  // project's own key. Three an hour is ample for a health probe and useless
  // as a drain; the shared gate fails closed.
  const refused = await modelSpendGate(
    createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
    req, "test-ai-fallback", TEST_LIMITS, corsHeaders,
  );
  if (refused) return refused;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { mode = "quick" } = await req.json().catch(() => ({ mode: "quick" }));
    logStep("Starting AI fallback test", { mode });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return json({ success: false, error: "LOVABLE_API_KEY not configured", fallbackConfig: [...DEFAULT_MODELS] }, 500);
    }

    if (mode === "all") {
      // Every model either chain can reach, each alone, called the way the
      // shared helper calls it (max_tokens for Google, max_completion_tokens
      // for OpenAI).
      const models = [...new Set(PRODUCTION_CHAINS.flatMap((c) => [...c.models]))];
      const results: Array<{ model: string; success: boolean; responseTime: number; statusCode?: number; error?: string }> = [];
      for (const model of models) {
        const r = await testChain(apiKey, model, [model]);
        results.push({ model, success: r.success, responseTime: r.totalTime, statusCode: r.status, ...(r.error ? { error: r.error } : {}) });
      }
      const ok = results.filter((r) => r.success);
      return json({
        success: PRODUCTION_CHAINS.every((c) => c.models.some((m) => ok.some((r) => r.model === m))),
        mode: "all",
        fallbackConfig: models,
        chains: PRODUCTION_CHAINS.map((c) => ({ name: c.name, models: [...c.models] })),
        results,
        summary: {
          totalModels: results.length,
          successfulModels: ok.length,
          failedModels: results.length - ok.length,
          fastestModel: [...ok].sort((a, b) => a.responseTime - b.responseTime)[0]?.model || null,
          averageResponseTime: ok.length > 0 ? Math.round(ok.reduce((acc, r) => acc + r.responseTime, 0) / ok.length) : null,
        },
      });
    }

    // Quick mode: each production chain once, as production walks it.
    const start = Date.now();
    const chains: ChainResult[] = [];
    for (const c of PRODUCTION_CHAINS) chains.push(await testChain(apiKey, c.name, c.models));
    const paid = chains[0];
    const success = chains.every((c) => c.success);
    logStep("Fallback test complete", { chains: chains.map((c) => ({ name: c.name, modelUsed: c.modelUsed, success: c.success })) });
    return json({
      success,
      mode: "quick",
      // The paid chain fills the fields the dashboard already prints.
      fallbackConfig: paid.models,
      modelUsed: paid.modelUsed,
      usedFallback: paid.usedFallback,
      totalTime: Date.now() - start,
      chains,
      ...(success ? {} : { error: chains.filter((c) => !c.success).map((c) => `${c.name}: ${c.error ?? "failed"}`).join("; ") }),
    }, success ? 200 : 500);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TEST-AI-FALLBACK] Error:", errorMessage);
    return json({ success: false, error: errorMessage, fallbackConfig: [...DEFAULT_MODELS] }, 500);
  }
});
