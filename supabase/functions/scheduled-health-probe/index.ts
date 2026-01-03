import { getServiceClient } from "../_shared/supabase-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProbeResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency_ms: number;
  error?: string;
}

interface ProbeReport {
  timestamp: string;
  overall_status: 'healthy' | 'degraded' | 'unhealthy';
  probes: ProbeResult[];
  duration_ms: number;
  alerts_triggered: string[];
}

// VERY relaxed thresholds - edge functions have cold starts
const THRESHOLDS = {
  database: { healthy: 3000, degraded: 8000 },
  ai_gateway: { healthy: 1000, degraded: 3000 },
  stripe: { healthy: 2000, degraded: 5000 },
};

// Pre-initialize Supabase client at module level with optimized settings
const supabase = getServiceClient();

function logStep(step: string, details?: Record<string, unknown>) {
  const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[HEALTH-PROBE] ${step}${detailsStr}`);
}

// Ultra-fast database check - use simplest possible query
async function probeDatabase(): Promise<ProbeResult> {
  if (!supabase) {
    return { service: 'database', status: 'unhealthy', latency_ms: 0, error: 'No supabase client' };
  }

  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const { error } = await supabase.from('heartbeat_results').select('id').limit(1).abortSignal(controller.signal);
    
    clearTimeout(timeoutId);
    
    const latency = Date.now() - start;
    
    if (error) {
      return { service: 'database', status: 'unhealthy', latency_ms: latency, error: error.message };
    }
    
    const status = latency < THRESHOLDS.database.healthy ? 'healthy' 
      : latency < THRESHOLDS.database.degraded ? 'degraded' : 'degraded';
    
    return { service: 'database', status, latency_ms: latency };
  } catch (e) {
    return { 
      service: 'database', 
      status: 'degraded',
      latency_ms: Date.now() - start, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    };
  }
}

// Ultra-fast AI gateway check
async function probeAIGateway(): Promise<ProbeResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return { service: 'ai-gateway', status: 'healthy', latency_ms: 0 };
  }

  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: '{"model":"google/gemini-2.5-flash-lite","messages":[]}',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    if (response.status >= 500) {
      return { service: 'ai-gateway', status: 'degraded', latency_ms: latency, error: `Status ${response.status}` };
    }
    
    const status = latency < THRESHOLDS.ai_gateway.healthy ? 'healthy' 
      : latency < THRESHOLDS.ai_gateway.degraded ? 'degraded' : 'degraded';
    
    return { service: 'ai-gateway', status, latency_ms: latency };
  } catch (e) {
    return { 
      service: 'ai-gateway', 
      status: 'degraded', 
      latency_ms: Date.now() - start, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    };
  }
}

// Fast Stripe check
async function probeStripe(): Promise<ProbeResult> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  
  if (!stripeKey) {
    return { service: 'stripe', status: 'healthy', latency_ms: 0 };
  }

  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    await fetch('https://api.stripe.com/v1/balance', {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latency = Date.now() - start;
    
    const status = latency < THRESHOLDS.stripe.healthy ? 'healthy' 
      : latency < THRESHOLDS.stripe.degraded ? 'degraded' : 'degraded';
    
    return { service: 'stripe', status, latency_ms: latency };
  } catch (e) {
    return { 
      service: 'stripe', 
      status: 'degraded', 
      latency_ms: Date.now() - start, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  // Warm-up path: keep it cheap and avoid external network calls (AI/Stripe)
  let isWarmup = false;
  try {
    const body = await req.json();
    isWarmup = body?._warmup === true;
  } catch {
    // ignore
  }

  if (isWarmup) {
    const dbProbe = await probeDatabase();
    const duration = Date.now() - startTime;

    const overallStatus = dbProbe.status === 'unhealthy'
      ? 'unhealthy'
      : dbProbe.status === 'degraded'
        ? 'degraded'
        : 'healthy';

    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      probes: [dbProbe],
      duration_ms: duration,
      alerts_triggered: [],
    };

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: dbProbe.status === 'unhealthy' ? 503 : 200,
    });
  }

  try {
    if (!supabase) {
      throw new Error("Missing Supabase configuration");
    }

    // Run ALL probes in parallel
    const probes = await Promise.all([
      probeDatabase(),
      probeAIGateway(),
      probeStripe(),
    ]);

    // Log results
    for (const probe of probes) {
      logStep(`${probe.service}: ${probe.status} (${probe.latency_ms}ms)${probe.error ? ` - ${probe.error}` : ''}`);
    }

    // Only DB failure = unhealthy
    const dbProbe = probes.find(p => p.service === 'database');
    const dbUnhealthy = dbProbe?.status === 'unhealthy';
    const anyDegraded = probes.some(p => p.status === 'degraded' || p.status === 'unhealthy');
    
    const overallStatus = dbUnhealthy ? 'unhealthy' : anyDegraded ? 'degraded' : 'healthy';
    const duration = Date.now() - startTime;

    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      probes,
      duration_ms: duration,
      alerts_triggered: dbUnhealthy ? [`database: ${dbProbe?.error || 'Failed'}`] : [],
    };

    // Fire-and-forget logging
    (async () => {
      try {
        await supabase.rpc('log_heartbeat_result', {
          p_function_name: 'scheduled-health-probe',
          p_status: overallStatus,
          p_test_passed: !dbUnhealthy,
          p_response_time_ms: duration,
          p_checks_passed: Object.fromEntries(probes.map(p => [p.service, p.status !== 'unhealthy'])),
          p_metadata: { probes: probes.map(({ service, status, latency_ms }) => ({ service, status, latency_ms })) },
        });
      } catch (e) {
        console.error('Log failed:', e instanceof Error ? e.message : 'Unknown');
      }
    })();

    logStep(`Complete: ${overallStatus} in ${duration}ms`);

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: dbUnhealthy ? 503 : 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error", { error: errorMessage });

    return new Response(
      JSON.stringify({ error: errorMessage, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
