// deploy-stamp: 2026-10-08T12:00Z
import { getServiceClient } from "../_shared/supabase-client.ts";

// A KEY THAT IS REFUSED IS NOT A HEALTHY SERVICE (register L13-67). The Stripe
// check discarded the response and read a missing key as "ok", so a rolled or
// absent STRIPE_SECRET_KEY failed every checkout while this page said Stripe
// was fine; the AI check counted only a 5xx, so a 401 (bad key) or a 402
// (credits exhausted) read healthy. Stripe now passes only on a 200 from its
// balance endpoint; a missing key or a 401/402/403 from either is an error.
const FN_BUILD = "health-check.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
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

// Relaxed thresholds - edge functions have cold starts
const THRESHOLDS = {
  database: { ok: 3000, slow: 8000 },
  ai_gateway: { ok: 1000, slow: 3000 },
  stripe: { ok: 2000, slow: 5000 },
};

// Pre-initialize at module level with optimized client
const supabase = getServiceClient();

async function checkDatabase(): Promise<CheckResult> {
  if (!supabase) {
    return { status: 'error', latency_ms: 0, message: 'No client' };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const { error } = await supabase.from('heartbeat_results').select('id').limit(1).abortSignal(controller.signal);
    clearTimeout(timeoutId);
    
    const latency = Date.now() - start;
    if (error) return { status: 'error', latency_ms: latency, message: error.message };
    
    return { 
      status: latency < THRESHOLDS.database.ok ? 'ok' : 'slow', 
      latency_ms: latency 
    };
  } catch (e) {
    return { status: 'slow', latency_ms: Date.now() - start, message: 'Timeout' };
  }
}

async function checkAIGateway(): Promise<CheckResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return { status: 'error', latency_ms: 0, message: 'LOVABLE_API_KEY is not set' };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: '{"model":"google/gemini-2.5-flash-lite","messages":[]}',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    if (response.status >= 500) return { status: 'slow', latency_ms: latency, message: `Status ${response.status}` };
    // The probe's empty message list is a 400 for a working key; these mean the key itself is refused.
    if (response.status === 401 || response.status === 403) return { status: 'error', latency_ms: latency, message: `AI key refused (HTTP ${response.status})` };
    if (response.status === 402) return { status: 'error', latency_ms: latency, message: 'AI credits exhausted (HTTP 402)' };
    
    return { 
      status: latency < THRESHOLDS.ai_gateway.ok ? 'ok' : 'slow', 
      latency_ms: latency 
    };
  } catch (e) {
    return { status: 'slow', latency_ms: Date.now() - start, message: 'Timeout' };
  }
}

async function checkStripe(): Promise<CheckResult> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return { status: 'error', latency_ms: 0, message: 'STRIPE_SECRET_KEY is not set' };
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch('https://api.stripe.com/v1/balance', {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    await response.body?.cancel().catch(() => {});

    if (response.status >= 500) return { status: 'slow', latency_ms: latency, message: `Stripe answered HTTP ${response.status}` };
    if (response.status !== 200) return { status: 'error', latency_ms: latency, message: `Stripe refused the secret key (HTTP ${response.status})` };
    return {
      status: latency < THRESHOLDS.stripe.ok ? 'ok' : 'slow',
      latency_ms: latency
    };
  } catch (e) {
    return { status: 'slow', latency_ms: Date.now() - start, message: 'Timeout' };
  }
}

function determineOverallStatus(checks: HealthCheckResult['checks']): 'healthy' | 'degraded' | 'unhealthy' {
  // Only DB error = unhealthy
  if (checks.database.status === 'error') return 'unhealthy';
  
  // Any slow = degraded
  if (Object.values(checks).some(c => c.status === 'slow' || c.status === 'error')) return 'degraded';
  
  return 'healthy';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Warm-up path: avoid external network calls (AI/Stripe) and just warm the DB client
  let isWarmup = false;
  try {
    const body = await req.json();
    isWarmup = body?._warmup === true;
  } catch {
    // ignore
  }

  if (isWarmup) {
    const database = await checkDatabase();
    const ai_gateway: CheckResult = { status: 'ok', latency_ms: 0 };
    const stripe: CheckResult = { status: 'ok', latency_ms: 0 };

    const checks = { database, ai_gateway, stripe };
    const responseTime = Date.now() - startTime;
    const status = determineOverallStatus(checks);

    const result: HealthCheckResult = {
      status,
      timestamp: new Date().toISOString(),
      checks,
      response_time_ms: responseTime,
      version: '2.2.0',
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: status === 'unhealthy' ? 503 : 200,
    });
  }

  try {
    // Run all checks in parallel
    const [database, ai_gateway, stripe] = await Promise.all([
      checkDatabase(),
      checkAIGateway(),
      checkStripe(),
    ]);

    const checks = { database, ai_gateway, stripe };
    const responseTime = Date.now() - startTime;
    const status = determineOverallStatus(checks);

    const result: HealthCheckResult = {
      status,
      timestamp: new Date().toISOString(),
      checks,
      response_time_ms: responseTime,
      version: '2.2.0',
    };

    console.log(`[HEALTH-CHECK] ${status} | DB: ${database.latency_ms}ms | AI: ${ai_gateway.latency_ms}ms | Stripe: ${stripe.latency_ms}ms | Total: ${responseTime}ms`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: status === 'unhealthy' ? 503 : 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return new Response(
      JSON.stringify({ status: 'unhealthy', error: errorMessage, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
    );
  }
});
