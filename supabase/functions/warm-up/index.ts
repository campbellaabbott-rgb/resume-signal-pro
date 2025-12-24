import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Warm-up function that pings critical edge functions to prevent cold starts.
 * Should be called every 5 minutes via cron to keep functions warm.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Functions to keep warm (ordered by priority)
// EXCLUDED: parse-pdf, parse-docx, parse-spreadsheet - they require FormData uploads
const FUNCTIONS_TO_WARM = [
  'health-check',
  'free-keyword-scan',
  'track-ab-event',
  'analyze-resume',
  'create-checkout',
  'create-product-checkout',
];

const WARM_TIMEOUT = 8000; // 8 seconds max per function

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[WARM-UP] Starting warm-up cycle');

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Use anon key for function invocation (same as client would)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Warm functions in parallel for efficiency
    const results = await Promise.all(
      FUNCTIONS_TO_WARM.map(fn => warmFunction(supabase, fn))
    );

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
});
