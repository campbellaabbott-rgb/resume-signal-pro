// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Test resume for heartbeat checks
const TEST_RESUME = `John Smith
Software Engineer | john.smith@email.com | (555) 123-4567

PROFESSIONAL SUMMARY
Experienced software engineer with 5+ years developing scalable web applications.

EXPERIENCE
Senior Software Engineer, Tech Corp - 2020-Present
- Developed microservices architecture serving 1M+ daily users
- Led team of 4 engineers to deliver features 20% faster
- Reduced API latency by 40% through optimization

Software Engineer, StartupXYZ - 2018-2020
- Built React frontend with 95% test coverage
- Implemented CI/CD pipeline reducing deploy time by 60%

EDUCATION
BS Computer Science, State University, 2018

SKILLS
JavaScript, TypeScript, React, Node.js, Python, AWS, Docker, PostgreSQL`;

// Thresholds for health determination
const HEALTHY_RESPONSE_TIME_MS = 30000; // 30s
const DEGRADED_RESPONSE_TIME_MS = 60000; // 60s
const AI_MODEL = 'google/gemini-2.5-flash';

interface HealthCheckResult {
  name: string;
  passed: boolean;
  responseTimeMs?: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheckResult[] = [];
  let overallStatus = 'healthy';
  let errorMessage: string | null = null;

  // Initialize Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Check 1: Database connectivity
    const dbStart = Date.now();
    try {
      const { error } = await supabase.from('daily_scan_stats').select('date').limit(1);
      checks.push({
        name: 'database',
        passed: !error,
        responseTimeMs: Date.now() - dbStart,
        error: error?.message
      });
      if (error) {
        overallStatus = 'degraded';
        errorMessage = `Database: ${error.message}`;
      }
    } catch (e) {
      checks.push({
        name: 'database',
        passed: false,
        responseTimeMs: Date.now() - dbStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      overallStatus = 'down';
      errorMessage = `Database: ${e instanceof Error ? e.message : 'Unknown'}`;
    }

    // Check 2: AI Gateway availability with actual scan
    const aiStart = Date.now();
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        throw new Error('LOVABLE_API_KEY not configured');
      }

      // Make a lightweight AI call to verify gateway is responsive
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { 
              role: "system", 
              content: "You are a resume analyzer. Respond with a JSON object containing: industry (string), atsScore (number 0-100)." 
            },
            { 
              role: "user", 
              content: `Analyze this resume briefly:\n\n${TEST_RESUME.substring(0, 500)}\n\nRespond only with JSON.` 
            }
          ],
          max_tokens: 100,
          temperature: 0
        }),
      });

      const aiTime = Date.now() - aiStart;
      
      if (!aiResponse.ok) {
        const errorBody = await aiResponse.text();
        throw new Error(`AI Gateway error ${aiResponse.status}: ${errorBody.substring(0, 100)}`);
      }

      const aiResult = await aiResponse.json();
      const hasContent = aiResult.choices?.[0]?.message?.content;
      
      checks.push({
        name: 'ai_gateway',
        passed: !!hasContent,
        responseTimeMs: aiTime,
        error: hasContent ? undefined : 'No content in response'
      });

      if (!hasContent) {
        overallStatus = 'degraded';
        errorMessage = errorMessage || 'AI Gateway: No content in response';
      }
    } catch (e) {
      const aiTime = Date.now() - aiStart;
      checks.push({
        name: 'ai_gateway',
        passed: false,
        responseTimeMs: aiTime,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      overallStatus = 'down';
      errorMessage = errorMessage || `AI Gateway: ${e instanceof Error ? e.message : 'Unknown'}`;
    }

    // Check 3: Cache system
    const cacheStart = Date.now();
    try {
      const { error } = await supabase.rpc('get_cached_response', {
        p_cache_key: 'heartbeat_test_key',
        p_function_name: 'scan-heartbeat'
      });
      
      checks.push({
        name: 'cache_system',
        passed: !error,
        responseTimeMs: Date.now() - cacheStart,
        error: error?.message
      });
      
      if (error) {
        // Cache error is not critical
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }
    } catch (e) {
      checks.push({
        name: 'cache_system',
        passed: false,
        responseTimeMs: Date.now() - cacheStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }

    // Check 4: Metrics logging system
    const metricsStart = Date.now();
    try {
      const { error } = await supabase.from('scan_metrics').select('id').limit(1);
      checks.push({
        name: 'metrics_system',
        passed: !error,
        responseTimeMs: Date.now() - metricsStart,
        error: error?.message
      });
    } catch (e) {
      checks.push({
        name: 'metrics_system',
        passed: false,
        responseTimeMs: Date.now() - metricsStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }

    // Calculate total response time and adjust status based on latency
    const totalTime = Date.now() - startTime;
    if (overallStatus === 'healthy' && totalTime > DEGRADED_RESPONSE_TIME_MS) {
      overallStatus = 'degraded';
      errorMessage = `High latency: ${totalTime}ms`;
    } else if (overallStatus === 'healthy' && totalTime > HEALTHY_RESPONSE_TIME_MS) {
      // Just log as info, not degraded
      console.log(`[SCAN-HEARTBEAT] Response time elevated: ${totalTime}ms`);
    }

    // Log heartbeat result to database
    const allPassed = checks.every(c => c.passed);
    const checksPassedJson = checks.reduce((acc, c) => {
      acc[c.name] = { passed: c.passed, time_ms: c.responseTimeMs, error: c.error };
      return acc;
    }, {} as Record<string, any>);

    await supabase.rpc('log_heartbeat_result', {
      p_function_name: 'free-keyword-scan',
      p_status: overallStatus,
      p_response_time_ms: totalTime,
      p_test_passed: allPassed && overallStatus !== 'down',
      p_error_message: errorMessage,
      p_checks_passed: checksPassedJson,
      p_metadata: { ai_model: AI_MODEL, test_time: new Date().toISOString() }
    });

    console.log(`[SCAN-HEARTBEAT] ${overallStatus} | Total: ${totalTime}ms | Checks: ${checks.map(c => `${c.name}:${c.passed}`).join(', ')}`);

    // Send alert if status is not healthy
    if (overallStatus !== 'healthy') {
      EdgeRuntime.waitUntil(sendHeartbeatAlert(overallStatus, errorMessage, checks, totalTime));
    }

    return new Response(
      JSON.stringify({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        responseTimeMs: totalTime,
        checks,
        errorMessage
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error("[SCAN-HEARTBEAT] Fatal error:", error);

    // Log failure
    await supabase.rpc('log_heartbeat_result', {
      p_function_name: 'free-keyword-scan',
      p_status: 'down',
      p_response_time_ms: totalTime,
      p_test_passed: false,
      p_error_message: error instanceof Error ? error.message : 'Unknown error',
      p_checks_passed: {},
      p_metadata: {}
    });

    EdgeRuntime.waitUntil(sendHeartbeatAlert('down', error instanceof Error ? error.message : 'Unknown', checks, totalTime));

    return new Response(
      JSON.stringify({
        status: 'down',
        timestamp: new Date().toISOString(),
        responseTimeMs: totalTime,
        checks,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Send alert email for heartbeat failures
async function sendHeartbeatAlert(
  status: string, 
  errorMessage: string | null, 
  checks: HealthCheckResult[],
  responseTime: number
): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@resumebooster.com";
    
    if (!RESEND_API_KEY) return;

    const failedChecks = checks.filter(c => !c.passed);
    const statusEmoji = status === 'down' ? '🔴' : '🟡';

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `${statusEmoji} Scan Heartbeat Alert: ${status.toUpperCase()}`,
        html: `
          <h2>Free Scan Heartbeat Alert</h2>
          <p><strong>Status:</strong> ${status.toUpperCase()}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p><strong>Response Time:</strong> ${responseTime}ms</p>
          ${errorMessage ? `<p><strong>Error:</strong> ${errorMessage}</p>` : ''}
          
          <h3>Check Results:</h3>
          <ul>
            ${checks.map(c => `
              <li>
                ${c.passed ? '✅' : '❌'} <strong>${c.name}</strong>: 
                ${c.responseTimeMs}ms 
                ${c.error ? `- ${c.error}` : ''}
              </li>
            `).join('')}
          </ul>
          
          ${failedChecks.length > 0 ? `
            <h3>Failed Checks:</h3>
            <ul>
              ${failedChecks.map(c => `<li>${c.name}: ${c.error}</li>`).join('')}
            </ul>
          ` : ''}
        `,
      }),
    });
    
    console.log(`[SCAN-HEARTBEAT] Alert email sent for status: ${status}`);
  } catch (e) {
    console.error("[SCAN-HEARTBEAT] Failed to send alert:", e);
  }
}
