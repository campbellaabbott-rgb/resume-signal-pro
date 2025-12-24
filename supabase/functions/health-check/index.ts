import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: CheckResult;
    ai_gateway: CheckResult;
    stripe: CheckResult;
  };
  response_time_ms: number;
  version: string;
}

interface CheckResult {
  status: 'ok' | 'slow' | 'error';
  latency_ms: number;
  message?: string;
}

// Thresholds in ms (relaxed for cold start scenarios)
const THRESHOLDS = {
  database: { ok: 800, slow: 2000 },
  ai_gateway: { ok: 3000, slow: 6000 },
  stripe: { ok: 800, slow: 2000 },
};

// Cached Supabase client to avoid re-initialization
let cachedSupabase: any = null;

function getSupabaseClient() {
  if (!cachedSupabase) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseServiceKey) {
      cachedSupabase = createClient(supabaseUrl, supabaseServiceKey);
    }
  }
  return cachedSupabase;
}

async function checkDatabase(supabase: any): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Use count query which is faster than selecting data
    const { count, error } = await supabase
      .from('daily_scan_stats')
      .select('*', { count: 'exact', head: true });
    
    const latency = Date.now() - start;
    
    if (error) {
      return { status: 'error', latency_ms: latency, message: error.message };
    }
    
    const status = latency <= THRESHOLDS.database.ok ? 'ok' : 
                   latency <= THRESHOLDS.database.slow ? 'slow' : 'error';
    
    return { status, latency_ms: latency };
  } catch (e) {
    return { 
      status: 'error', 
      latency_ms: Date.now() - start, 
      message: e instanceof Error ? e.message : 'Unknown error' 
    };
  }
}

async function checkAIGateway(): Promise<CheckResult> {
  const start = Date.now();
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return { status: 'error', latency_ms: 0, message: 'LOVABLE_API_KEY not configured' };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    
    // Use the fastest, cheapest model with minimal request
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: "1" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    // 200 = success, 429 = rate limited but gateway is up
    if (response.ok || response.status === 429) {
      const status = latency <= THRESHOLDS.ai_gateway.ok ? 'ok' : 
                     latency <= THRESHOLDS.ai_gateway.slow ? 'slow' : 'error';
      return { status, latency_ms: latency };
    }
    
    return { status: 'error', latency_ms: latency, message: `HTTP ${response.status}` };
  } catch (e) {
    const latency = Date.now() - start;
    const isTimeout = e instanceof Error && (e.name === 'AbortError' || e.message.includes('timeout'));
    return { 
      status: 'error', 
      latency_ms: latency, 
      message: isTimeout ? 'Timeout' : (e instanceof Error ? e.message : 'Unknown error')
    };
  }
}

async function checkStripe(): Promise<CheckResult> {
  const start = Date.now();
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  
  if (!stripeKey) {
    return { status: 'error', latency_ms: 0, message: 'STRIPE_SECRET_KEY not configured' };
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    
    // Minimal Stripe API call to check connectivity
    const response = await fetch("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    // Even 401 means Stripe is reachable
    if (response.ok || response.status === 401) {
      const status = latency <= THRESHOLDS.stripe.ok ? 'ok' : 
                     latency <= THRESHOLDS.stripe.slow ? 'slow' : 'error';
      return { status, latency_ms: latency };
    }
    
    return { status: 'error', latency_ms: latency, message: `HTTP ${response.status}` };
  } catch (e) {
    const latency = Date.now() - start;
    const isTimeout = e instanceof Error && (e.name === 'AbortError' || e.message.includes('timeout'));
    return { 
      status: 'error', 
      latency_ms: latency, 
      message: isTimeout ? 'Timeout' : (e instanceof Error ? e.message : 'Unknown error')
    };
  }
}

function determineOverallStatus(checks: HealthCheckResult['checks']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = Object.values(checks).map(c => c.status);
  
  if (statuses.every(s => s === 'ok')) {
    return 'healthy';
  }
  
  if (statuses.includes('error')) {
    // If database is down, it's unhealthy
    if (checks.database.status === 'error') {
      return 'unhealthy';
    }
    // Other service errors = degraded
    return 'degraded';
  }
  
  if (statuses.includes('slow')) {
    return 'degraded';
  }
  
  return 'healthy';
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = getSupabaseClient();
    
    if (!supabase) {
      return new Response(
        JSON.stringify({ 
          status: 'unhealthy', 
          error: 'Supabase not configured',
          timestamp: new Date().toISOString()
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Run all checks in parallel - this is already optimal
    const [database, ai_gateway, stripe] = await Promise.all([
      checkDatabase(supabase),
      checkAIGateway(),
      checkStripe(),
    ]);

    const checks = { database, ai_gateway, stripe };
    const overallStatus = determineOverallStatus(checks);
    const responseTime = Date.now() - startTime;

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
      response_time_ms: responseTime,
      version: '1.1.0',
    };

    console.log(`[HEALTH-CHECK] ${overallStatus} | DB: ${database.latency_ms}ms | AI: ${ai_gateway.latency_ms}ms | Stripe: ${stripe.latency_ms}ms | Total: ${responseTime}ms`);

    const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;

    return new Response(JSON.stringify(result, null, 2), {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[HEALTH-CHECK] Critical error:', error);
    
    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        response_time_ms: Date.now() - startTime,
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
