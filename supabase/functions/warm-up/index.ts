// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stamped } from "../_shared/fn-build.ts";
import { keyMatches } from "../_shared/admin-key.ts";
import { isScheduledCaller } from "../_shared/email-cron.ts";

// The build every response names (x-fn-build); see _shared/fn-build.ts.
// 2026-11-09.1 (cost audit 2026-11-08, lane ai): the full warm-up (every
// function below, from one request) answers only the owner's key, our own
// servers' key or the cron key; anyone else is answered 401 before anything
// is invoked. A warm-up of one named function is unchanged and needs no key.
// The seven model endpoints nothing called are retired, so the two of them
// listed here are no longer warmed. Browsers keep the preflight two hours.
const FN_BUILD = "warm-up.2026-11-09.1";

/**
 * Warm-up function that pings critical edge functions to prevent cold starts.
 *
 * TWO MODES. A request naming one listed function (`{ target }`) warms that
 * one: the scan button's hover sends it, with the publishable key. A request
 * naming none warms the whole list, one invocation per function from one
 * request, so it is for the owner (the /health-check button, once it sends
 * the stored key as x-admin-key, as that page's health-check call does, or
 * in the body, as its AI diagnostic call does), our own servers and a
 * scheduled warm-up that sends the cron key; a stranger's request is refused
 * before anything runs.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  // One preflight per browser per two hours, not one before every hover.
  'Access-Control-Max-Age': '7200',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Functions to keep warm (ordered by priority)
// EXCLUDED: parse-pdf, parse-docx, parse-spreadsheet - they require FormData uploads
const FUNCTIONS_TO_WARM = [
  // Critical user-facing functions
  'health-check',
  'scheduled-health-probe',
  'free-keyword-scan',
  'free-keyword-scan-stream',
  'analyze-resume',
  'track-ab-event',
  // Payment functions
  'create-checkout',
  'create-product-checkout',
  'create-scan-pack-checkout',
  'stripe-webhook',
  // AI generation functions (high cold-start impact)
  'generate-cover-letter',
  'generate-tailored-resume',
  // generate-tailored-resume-stream, generate-cover-letter-stream and
  // generate-summary are retired (each answers 410 and calls nothing), so
  // there is nothing to keep warm.
  'generate-ats-defense',
  'generate-keyword-fix',
  // Verification functions
  'verify-product-purchase',
  'verify-scan-pack-purchase',
];

const WARM_TIMEOUT = 8000; // 8 seconds max per function

const BATCH_SIZE = 5; // Process 5 functions at a time to avoid resource contention

// Helper to chunk array into batches
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

interface WarmResult {
  function: string;
  status: 'warm' | 'cold' | 'error';
  latency_ms: number;
  error?: string;
}

async function warmFunction(
  supabase: any,
  functionName: string
): Promise<WarmResult> {
  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WARM_TIMEOUT);
    
    // Use minimal payload to just trigger function initialization
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { _warmup: true, timestamp: Date.now() },
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    if (error) {
      // Some functions may reject warmup requests - that's OK, they're still warm
      console.log(`[WARM-UP] ${functionName}: ${latency}ms (response: ${error.message?.slice(0, 50) || 'error'})`);
      return {
        function: functionName,
        status: latency < 1000 ? 'warm' : 'cold',
        latency_ms: latency,
      };
    }
    
    console.log(`[WARM-UP] ${functionName}: ${latency}ms (success)`);
    
    return {
      function: functionName,
      status: latency < 1000 ? 'warm' : 'cold',
      latency_ms: latency,
    };
  } catch (e) {
    const latency = Date.now() - start;
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    
    console.log(`[WARM-UP] ${functionName}: ${latency}ms (error: ${errorMessage.slice(0, 50)})`);
    
    return {
      function: functionName,
      status: 'error',
      latency_ms: latency,
      error: errorMessage,
    };
  }
}

serve(stamped(FN_BUILD, async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    // Check if this is a targeted warmup (single function) or full warmup
    let body: { target?: unknown; adminKey?: unknown } = {};
    try {
      const read = await req.json();
      if (read && typeof read === 'object' && !Array.isArray(read)) body = read;
    } catch {
      // No body: the full warm-up, if the caller may ask for it.
    }
    const target = typeof body.target === 'string' && body.target !== '' ? body.target : null;
    if (target !== null && !FUNCTIONS_TO_WARM.includes(target)) {
      // A name off the list warms nothing; it used to fall through to the
      // whole list.
      return json({ success: false, error: 'Unknown warm-up target.', code: 'unknown_target' }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase configuration");
    }

    // THE FULL WARM-UP IS NOT A STRANGER'S (cost audit 2026-11-08, Do first
    // #13). One request with no target invoked every function in the list,
    // so any caller with the publishable key turned one request into
    // seventeen and more. It now answers the owner's ADMIN_API_KEY (as
    // x-admin-key, or as the body's adminKey, which a page published before
    // this build can send without a preflight that refuses the header), the
    // service-role key, or the vault-held cron key; anyone else is answered
    // 401 here, before any function is invoked.
    if (target === null) {
      const presented = req.headers.get('x-admin-key') || (typeof body.adminKey === 'string' ? body.adminKey : '');
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      const allowed = keyMatches(presented, Deno.env.get("ADMIN_API_KEY") ?? "")
        || await isScheduledCaller(req.headers, createClient(supabaseUrl, serviceKey), serviceKey);
      if (!allowed) {
        return json({ success: false, error: 'Unauthorized: the full warm-up needs the admin key. Name one function as target to warm it alone.', code: 'admin_key_required' }, 401);
      }
    }

    // Use anon key for function invocation (same as client would)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // If a target function is specified, only warm that one (fast path for prefetch)
    if (target !== null) {
      console.log(`[WARM-UP] Quick warm for: ${target}`);
      const result = await warmFunction(supabase, target);
      const duration = Date.now() - startTime;
      
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'targeted',
          target,
          duration_ms: duration,
          result,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Full warmup - warm functions in batches
    console.log('[WARM-UP] Starting full warm-up cycle');
    const batches = chunkArray(FUNCTIONS_TO_WARM, BATCH_SIZE);
    const results: WarmResult[] = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[WARM-UP] Processing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);
      
      const batchResults = await Promise.all(
        batch.map(fn => warmFunction(supabase, fn))
      );
      results.push(...batchResults);
    }

    const duration = Date.now() - startTime;
    const warmCount = results.filter(r => r.status === 'warm').length;
    const coldCount = results.filter(r => r.status === 'cold').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const avgLatency = Math.round(
      results.reduce((sum, r) => sum + r.latency_ms, 0) / results.length
    );

    console.log(`[WARM-UP] Complete: ${warmCount} warm, ${coldCount} cold, ${errorCount} errors | avg: ${avgLatency}ms | total: ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        duration_ms: duration,
        summary: {
          warm: warmCount,
          cold: coldCount,
          errors: errorCount,
          avg_latency_ms: avgLatency,
        },
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WARM-UP] Error:', errorMessage);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}));
