import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Relaxed thresholds for realistic cold-start scenarios
const THRESHOLDS = {
  database: { healthy: 1500, degraded: 4000 },
  ai_gateway: { healthy: 2000, degraded: 5000 },
  stripe: { healthy: 1500, degraded: 4000 },
};

// Cached Supabase client
let cachedSupabase: any = null;

function getSupabaseClient() {
  if (!cachedSupabase) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseKey) {
      cachedSupabase = createClient(supabaseUrl, supabaseKey);
    }
  }
  return cachedSupabase;
}

function logStep(step: string, details?: Record<string, unknown>) {
  const detailsStr = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[HEALTH-PROBE] ${step}${detailsStr}`);
}

// Generic probe with timeout - simplified
async function probeWithTimeout<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<{ success: boolean; result?: T; error?: string; latency_ms: number }> {
  const start = Date.now();
  
  try {
    // Create a timeout promise that rejects
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${name} timeout`)), timeoutMs);
    });
    
    // Race the actual function against the timeout
    const result = await Promise.race([fn(), timeoutPromise]);
    
    return {
      success: true,
      result,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      latency_ms: Date.now() - start,
    };
  }
}

// Fast database check - use simple RPC call
async function probeDatabase(supabase: any): Promise<ProbeResult> {
  const probe = await probeWithTimeout(
    'database',
    async () => {
      const { data, error } = await supabase.rpc('get_today_scan_count');
      if (error) throw error;
      return data;
    },
    4000
  );

  const latency = probe.latency_ms;
  let status: 'healthy' | 'degraded' | 'unhealthy';
  
  if (!probe.success) {
    status = 'unhealthy';
  } else if (latency < THRESHOLDS.database.healthy) {
    status = 'healthy';
  } else if (latency < THRESHOLDS.database.degraded) {
    status = 'degraded';
  } else {
    status = 'degraded'; // Very slow but still working
  }

  return {
    service: 'database',
    status,
    latency_ms: latency,
    error: probe.error,
  };
}

// FAST AI gateway check - don't do actual inference, just check reachability
async function probeAIGateway(): Promise<ProbeResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  
  if (!LOVABLE_API_KEY) {
    return {
      service: 'ai-gateway',
      status: 'unhealthy',
      latency_ms: 0,
      error: 'LOVABLE_API_KEY not configured',
    };
  }

  const probe = await probeWithTimeout(
    'ai-gateway',
    async () => {
      // Use empty messages for FAST validation error - gateway still responds
      // This proves gateway is reachable without waiting for actual AI inference
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [], // Empty = fast validation error, but gateway responds
        }),
      });
      
      // Gateway is UP if it responds at all (200, 400, 429 all mean reachable)
      // Only 5xx or network errors indicate gateway problems
      if (response.status >= 500) {
        throw new Error(`AI Gateway error: ${response.status}`);
      }
      
      return true;
    },
    3000 // 3 second timeout - validation should be very fast
  );

  const latency = probe.latency_ms;
  let status: 'healthy' | 'degraded' | 'unhealthy';
  
  if (!probe.success) {
    // Check if it's a timeout vs real error
    const isTimeout = probe.error?.includes('timeout');
    status = isTimeout ? 'degraded' : 'unhealthy';
  } else if (latency < THRESHOLDS.ai_gateway.healthy) {
    status = 'healthy';
  } else if (latency < THRESHOLDS.ai_gateway.degraded) {
    status = 'degraded';
  } else {
    status = 'degraded';
  }

  return {
    service: 'ai-gateway',
    status,
    latency_ms: latency,
    error: probe.error,
  };
}

// Stripe check with relaxed thresholds
async function probeStripe(): Promise<ProbeResult> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  
  if (!stripeKey) {
    return {
      service: 'stripe',
      status: 'unhealthy',
      latency_ms: 0,
      error: 'Stripe key not configured',
    };
  }

  const probe = await probeWithTimeout(
    'stripe',
    async () => {
      const response = await fetch('https://api.stripe.com/v1/balance', {
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
        },
      });
      
      // 401 still means Stripe is reachable
      if (!response.ok && response.status !== 401) {
        throw new Error(`Stripe error: ${response.status}`);
      }
      
      return true;
    },
    4000
  );

  const latency = probe.latency_ms;
  let status: 'healthy' | 'degraded' | 'unhealthy';
  
  if (!probe.success) {
    const isTimeout = probe.error?.includes('timeout');
    status = isTimeout ? 'degraded' : 'unhealthy';
  } else if (latency < THRESHOLDS.stripe.healthy) {
    status = 'healthy';
  } else if (latency < THRESHOLDS.stripe.degraded) {
    status = 'degraded';
  } else {
    status = 'degraded';
  }

  return {
    service: 'stripe',
    status,
    latency_ms: latency,
    error: probe.error,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  logStep("Starting scheduled health probe");

  try {
    const supabase = getSupabaseClient();

    if (!supabase) {
      throw new Error("Missing Supabase configuration");
    }

    // Run ALL probes in parallel - no sequential waiting
    logStep("Running probes in parallel");
    
    const probes = await Promise.all([
      probeDatabase(supabase),
      probeAIGateway(),
      probeStripe(),
    ]);

    // Determine overall status - only unhealthy if DATABASE is down
    const dbProbe = probes.find(p => p.service === 'database');
    const hasUnhealthy = dbProbe?.status === 'unhealthy'; // Only DB down = unhealthy
    const hasDegraded = probes.some(p => p.status === 'degraded' || (p.status === 'unhealthy' && p.service !== 'database'));
    
    const overallStatus = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

    // Collect alerts only for truly unhealthy services
    const alerts: string[] = [];
    for (const probe of probes) {
      logStep(`Probe result: ${probe.service}`, {
        status: probe.status,
        latency_ms: probe.latency_ms,
      });

      if (probe.status === 'unhealthy') {
        alerts.push(`${probe.service}: ${probe.error || 'Probe failed'}`);
      }
    }

    const duration = Date.now() - startTime;

    // Create report
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      overall_status: overallStatus,
      probes,
      duration_ms: duration,
      alerts_triggered: alerts,
    };

    // Log heartbeat result in background (non-blocking)
    const logPromise = supabase.rpc('log_heartbeat_result', {
      p_function_name: 'scheduled-health-probe',
      p_status: overallStatus,
      p_test_passed: overallStatus !== 'unhealthy',
      p_response_time_ms: duration,
      p_checks_passed: probes.reduce((acc, p) => {
        acc[p.service] = p.status !== 'unhealthy';
        return acc;
      }, {} as Record<string, boolean>),
      p_metadata: {
        probes: probes.map(p => ({
          service: p.service,
          status: p.status,
          latency_ms: p.latency_ms,
        })),
        alerts: alerts,
      },
    });

    // Only do extra work if there are critical failures (DB down)
    if (hasUnhealthy) {
      logStep("Critical service unhealthy", { alerts });
      
      const [, alertResult] = await Promise.all([
        logPromise,
        supabase.rpc('should_send_alert', {
          p_metric_name: 'scheduled_health_probe',
          p_alert_type: 'probe_failure',
          p_cooldown_minutes: 15,
        }),
      ]);

      if (alertResult.data) {
        // Log alert and error telemetry in parallel
        await Promise.all([
          supabase.rpc('log_alert_sent', {
            p_metric_name: 'scheduled_health_probe',
            p_alert_type: 'probe_failure',
            p_threshold: 0,
            p_actual: alerts.length,
            p_sent_to: 'system',
            p_success: true,
          }),
          supabase.rpc('log_error_telemetry', {
            p_error_code: 'HEALTH_PROBE_FAILURE',
            p_error_type: 'scheduled_probe',
            p_error_message: `${alerts.length} service(s) unhealthy: ${alerts.join(', ')}`,
            p_function_name: 'scheduled-health-probe',
            p_context: report,
          }),
        ]);
      }
    } else {
      // No critical alerts - fire and forget the log
      logPromise.catch((e: Error) => console.error('Log failed:', e.message));
    }

    logStep(`Probe complete: ${overallStatus}`, { duration_ms: duration });

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: overallStatus === 'unhealthy' ? 503 : 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Probe error", { error: errorMessage });

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
