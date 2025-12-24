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

const PROBE_TIMEOUT = 10000; // 10 seconds per probe

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
  
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Probe timeout')), timeoutMs)
      )
    ]);
    
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

async function probeDatabase(supabase: any): Promise<ProbeResult> {
  const probe = await probeWithTimeout(
    'database',
    async () => {
      const { data, error } = await supabase
        .from('heartbeat_results')
        .select('id')
        .limit(1);
      if (error) throw error;
      return data;
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'database',
    status: probe.success ? (probe.latency_ms < 500 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
    error: probe.error,
  };
}

async function probeAIGateway(): Promise<ProbeResult> {
  const probe = await probeWithTimeout(
    'ai-gateway',
    async () => {
      // Minimal AI request to test connectivity
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY') || Deno.env.get('AI_GATEWAY_API_KEY') || ''}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`AI Gateway error: ${response.status} - ${text.slice(0, 100)}`);
      }
      
      return await response.json();
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'ai-gateway',
    status: probe.success ? (probe.latency_ms < 3000 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
    error: probe.error,
  };
}

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
      
      if (!response.ok) {
        throw new Error(`Stripe error: ${response.status}`);
      }
      
      return await response.json();
    },
    PROBE_TIMEOUT
  );

  return {
    service: 'stripe',
    status: probe.success ? (probe.latency_ms < 1000 ? 'healthy' : 'degraded') : 'unhealthy',
    latency_ms: probe.latency_ms,
    error: probe.error,
  };
}

async function probeEdgeFunction(
  supabase: any,
  functionName: string,
  testPayload: Record<string, unknown> = {}
): Promise<ProbeResult> {
  const probe = await probeWithTimeout(
    functionName,
    async () => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { ...testPayload, _probe: true },
      });
      
      if (error) throw error;
      return data;
    },
    PROBE_TIMEOUT
  );

  return {
    service: functionName,
    status: probe.success ? (probe.latency_ms < 5000 ? 'healthy' : 'degraded') : 'unhealthy',
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const alerts: string[] = [];

    // Run all probes in parallel
    logStep("Running probes in parallel");
    
    const probePromises = [
      probeDatabase(supabase),
      probeAIGateway(),
      probeStripe(),
      probeEdgeFunction(supabase, 'health-check'),
    ];

    const probes = await Promise.all(probePromises);

    // Determine overall status
    const hasUnhealthy = probes.some(p => p.status === 'unhealthy');
    const hasDegraded = probes.some(p => p.status === 'degraded');
    const overallStatus = hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

    // Log probe results
    for (const probe of probes) {
      logStep(`Probe result: ${probe.service}`, {
        status: probe.status,
        latency_ms: probe.latency_ms,
        error: probe.error,
      });

      // Track alerts for unhealthy services
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

    // Log to heartbeat_results for tracking
    await supabase.rpc('log_heartbeat_result', {
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

    // If there are critical failures, log alerts
    if (alerts.length > 0) {
      logStep("Critical services unhealthy - triggering alerts", { alerts });
      
      // Check if we should send alert (cooldown check)
      const { data: shouldAlert } = await supabase.rpc('should_send_alert', {
        p_metric_name: 'scheduled_health_probe',
        p_alert_type: 'probe_failure',
        p_cooldown_minutes: 15,
      });

      if (shouldAlert) {
        // Log alert to alert_log
        await supabase.rpc('log_alert_sent', {
          p_metric_name: 'scheduled_health_probe',
          p_alert_type: 'probe_failure',
          p_threshold: 0,
          p_actual: alerts.length,
          p_sent_to: 'system',
          p_success: true,
        });

        // Log to error telemetry for visibility
        await supabase.rpc('log_error_telemetry', {
          p_error_code: 'HEALTH_PROBE_FAILURE',
          p_error_type: 'scheduled_probe',
          p_error_message: `${alerts.length} service(s) unhealthy: ${alerts.join(', ')}`,
          p_function_name: 'scheduled-health-probe',
          p_context: report,
        });
      }
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