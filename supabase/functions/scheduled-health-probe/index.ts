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

// Reduced timeout for faster probes
const PROBE_TIMEOUT = 6000;

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

async function probeWithTimeout<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<{ success: boolean; result?: T; error?: string; latency_ms: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await fn();
    clearTimeout(timeoutId);
    
    return {
      success: true,
      result,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return {
      success: false,
      error: isTimeout ? 'Probe timeout' : (error instanceof Error ? error.message : String(error)),
      latency_ms: Date.now() - start,
    };
  }
}

// Direct database check - no nested function call
async function probeDatabase(supabase: any): Promise<ProbeResult> {
  const probe = await probeWithTimeout(
    'database',
    async () => {
      const { count, error } = await supabase
        .from('heartbeat_results')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count;
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'database',
    status: probe.success ? (probe.latency_ms < 800 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
    error: probe.error,
  };
}

// Direct AI gateway check - no nested function call
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
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
      
      if (!response.ok && response.status !== 429) {
        throw new Error(`AI Gateway error: ${response.status}`);
      }
      
      return true;
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'ai-gateway',
    status: probe.success ? (probe.latency_ms < 4000 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
    error: probe.error,
  };
}

// Direct Stripe check
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      
      const response = await fetch('https://api.stripe.com/v1/balance', {
        headers: {
          'Authorization': `Bearer ${stripeKey}`,
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // 401 still means Stripe is reachable
      if (!response.ok && response.status !== 401) {
        throw new Error(`Stripe error: ${response.status}`);
      }
      
      return true;
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'stripe',
    status: probe.success ? (probe.latency_ms < 800 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
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

    // Run all probes in parallel - removed nested health-check call
    logStep("Running probes in parallel");
    
    const probes = await Promise.all([
      probeDatabase(supabase),
      probeAIGateway(),
      probeStripe(),
    ]);

    // Determine overall status
    const hasUnhealthy = probes.some(p => p.status === 'unhealthy');
    const hasDegraded = probes.some(p => p.status === 'degraded');
    const overallStatus = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

    // Collect alerts for unhealthy services
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

    // OPTIMIZED: Single RPC call to log heartbeat result
    // Only log to DB if there's something important to track
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

    // Only do extra DB calls if there are critical failures
    if (alerts.length > 0) {
      logStep("Critical services unhealthy", { alerts });
      
      // Run alert checks in parallel with the main log
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
      // No alerts - just wait for the main log to complete
      await logPromise;
    }

    logStep(`Probe complete: ${overallStatus}`, { duration_ms: duration, unhealthy_count: alerts.length });

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
