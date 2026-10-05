// deploy-stamp: 2026-10-04T13:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callAIWithModelFallback } from "../_shared/ai-fallback.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { modelSpendGate } from "../_shared/model-spend-gate.ts";
import {
  servableSummary, summaryCacheKey, summaryFacts, summaryPrompt,
  SUMMARY_MAX_TOKENS, SUMMARY_MODELS,
} from "./prompt.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "generate-summary.2026-10-04.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': FN_BUILD,
};

// Cache configuration
const CACHE_FUNCTION_NAME = 'generate-summary';
const CACHE_TTL_HOURS = 24;

// The only public model endpoint that had no limiter at all (defect sweep
// 1.06). Thirty an hour is far above one visitor's scans; the function-wide
// ceiling bounds a rotating address pool. A cache hit spends nothing and is
// not counted.
const SUMMARY_LIMITS = { perAddress: 30, globalPerHour: 600 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  const startTime = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: unknown;
    try { body = await req.json(); } catch { body = null; }

    // Input guard first, before the database or the model: every real scan
    // result carries a numeric atsScore, and every other field is coerced to a
    // bounded value (see prompt.ts), so the prompt cannot carry a caller's essay.
    const facts = summaryFacts(body);
    if (!facts) return json({ error: "Scan data (atsScore) is required", summary: null }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase configuration missing");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The cache key is the prompt: nothing that changes the output can leave it out.
    const prompt = summaryPrompt(facts);
    const cacheKey = await summaryCacheKey(prompt);

    const { data: cachedResponse, error: cacheError } = await supabase.rpc('get_cached_response', {
      p_cache_key: cacheKey,
      p_function_name: CACHE_FUNCTION_NAME
    });
    if (!cacheError && servableSummary(cachedResponse?.summary)) {
      console.log(`[GENERATE-SUMMARY] Cache HIT in ${Date.now() - startTime}ms for key ${cacheKey.substring(0, 8)}...`);
      return json({ summary: servableSummary(cachedResponse.summary), cached: true });
    }
    console.log(`[GENERATE-SUMMARY] Cache MISS for key ${cacheKey.substring(0, 8)}...`);

    const refused = await modelSpendGate(supabase, req, "generate-summary", SUMMARY_LIMITS, corsHeaders);
    if (refused) return refused;

    const { response } = await callAIWithModelFallback(LOVABLE_API_KEY, {
      messages: [{ role: "user", content: prompt }],
      models: SUMMARY_MODELS,
      maxTokens: SUMMARY_MAX_TOKENS,
      context: "GENERATE-SUMMARY",
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 429) {
        console.log(`[GENERATE-SUMMARY] Rate limited after ${duration}ms`);
        return json({ error: "Rate limited", summary: null }, 429);
      }
      if (response.status === 402) {
        console.log(`[GENERATE-SUMMARY] Payment required after ${duration}ms`);
        return json({ error: "Payment required", summary: null }, 402);
      }
      const errorText = await response.text();
      console.error(`[GENERATE-SUMMARY] AI gateway error after ${duration}ms:`, response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    // A completion that is not a summary is neither served nor cached.
    const summary = servableSummary(raw);
    if (!summary && typeof raw === "string" && raw.trim()) {
      console.warn(`[GENERATE-SUMMARY] Dropped an off-spec completion of ${raw.trim().length} chars`);
    }

    console.log(`[GENERATE-SUMMARY] Success in ${duration}ms`);

    if (summary) {
      (async () => {
        try {
          const { error } = await supabase.rpc('store_cached_response', {
            p_cache_key: cacheKey,
            p_function_name: CACHE_FUNCTION_NAME,
            p_response: { summary },
            p_ttl_hours: CACHE_TTL_HOURS
          });
          if (error) console.error(`[GENERATE-SUMMARY] Cache store error:`, error.message);
        } catch (err) {
          console.error(`[GENERATE-SUMMARY] Cache store exception:`, err);
        }
      })();
    }

    return json({ summary });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[GENERATE-SUMMARY] Error after ${duration}ms:`, error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('AbortError');

    return json({
      error: isTimeout ? "Request timed out. Please try again." : errorMessage,
      summary: null,
      retryable: isTimeout
    }, isTimeout ? 504 : 500);
  }
});
