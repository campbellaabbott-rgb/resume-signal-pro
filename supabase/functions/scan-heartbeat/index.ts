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

    // Check 5: job-board refresh liveness. The board serves stale data
    // gracefully, so a wedged refresh pipeline is invisible to every other
    // check — this is what would have caught the 2026-07-12 death loop
    // (WORKER_RESOURCE_LIMIT re-running the same slice for an hour) before
    // a human noticed. The tiered refresh writes refresh_progress on every
    // slice (~every 30-60s while healthy); 45 minutes of silence means the
    // pipeline is down, not merely slow.
    const boardStart = Date.now();
    try {
      const { data: prog, error } = await supabase
        .from('job_board_meta')
        .select('updated_at')
        .eq('k', 'refresh_progress')
        .maybeSingle();
      const ageMin = prog ? Math.round((Date.now() - new Date(prog.updated_at).getTime()) / 60000) : null;
      const stalled = error != null || ageMin === null || ageMin > 45;
      checks.push({
        name: 'job_board_refresh',
        passed: !stalled,
        responseTimeMs: Date.now() - boardStart,
        error: stalled ? (error?.message ?? `no refresh slice for ${ageMin ?? '∞'} min — postings going stale; check job-board function logs for WORKER_RESOURCE_LIMIT`) : undefined,
      });
      if (stalled) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board refresh stalled (${ageMin ?? 'no meta'} min since last slice)`;
      }

      // Freshness SLA: the slice check above proves the pipeline is MOVING,
      // but not that the whole catalog is actually fresh. The cold tail is
      // fully re-verified once per rotation; if that rotation hasn't
      // completed within the SLA, cold-tail postings are going stale even
      // though slices keep ticking. This measures freshness directly.
      const COLD_ROTATION_SLA_MIN = 90;
      const { data: rot } = await supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'cold_rotation').maybeSingle();
      const rotAgeMin = rot ? Math.round((Date.now() - new Date((rot.v as { completedAt?: string })?.completedAt ?? rot.updated_at).getTime()) / 60000) : null;
      const rotStale = rotAgeMin !== null && rotAgeMin > COLD_ROTATION_SLA_MIN;
      checks.push({
        name: 'job_board_freshness',
        passed: !rotStale,
        responseTimeMs: 0,
        error: rotStale ? `cold-tail last fully re-verified ${rotAgeMin} min ago (SLA ${COLD_ROTATION_SLA_MIN}) — long-tail postings may be stale; check for failing boards or too-slow rotation` : undefined,
      });
      if (rotStale) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board cold-tail freshness behind SLA (${rotAgeMin} min)`;
      }

      // Capacity headroom: the corpus is bounded by the free-tier DB (~100k).
      // Warn BEFORE the governor has to evict live postings — a shrinking
      // headroom is the signal to widen the DB tier or trim the board
      // selection, rather than silently shedding real jobs to stay under cap.
      const { data: cap } = await supabase
        .from('job_board_meta').select('v').eq('k', 'capacity').maybeSingle();
      const capV = (cap?.v ?? {}) as { active?: boolean; headroom?: number; corpusBefore?: number; evicted?: number; ceiling?: number };
      const headroom = typeof capV.headroom === 'number'
        ? capV.headroom
        : (typeof capV.ceiling === 'number' && typeof capV.corpusBefore === 'number' ? capV.ceiling - capV.corpusBefore : null);
      const capTight = capV.active === true || (headroom !== null && headroom < 2000);
      checks.push({
        name: 'job_board_capacity',
        passed: !capTight,
        responseTimeMs: 0,
        error: capTight
          ? (capV.active
              ? `capacity governor active — evicted ${capV.evicted ?? '?'} stalest postings last pass (ceiling ${capV.ceiling ?? '?'}); widen the DB tier or trim board selection`
              : `corpus near cap — headroom ${headroom} below ceiling ${capV.ceiling ?? '?'}`)
          : undefined,
      });
      if (capTight) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board near capacity (${capV.active ? 'governor evicting' : `headroom ${headroom}`})`;
      }
    } catch (e) {
      checks.push({
        name: 'job_board_refresh',
        passed: false,
        responseTimeMs: Date.now() - boardStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Check 6: END-TO-END scan through the real deployed function. The
    // component checks above can all pass while free-keyword-scan itself is
    // crashed or stale-deployed (exactly the July 4 outage) — this is the
    // check that would have caught it. Sends x-heartbeat-secret so the scan
    // function skips per-IP daily limits (see HEARTBEAT_SECRET there); if the
    // secret isn't configured, a 429 counts as alive-but-unverified, not down.
    const e2eStart = Date.now();
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 75000);
      const scanResp = await fetch(`${supabaseUrl}/functions/v1/free-keyword-scan`, {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          ...(heartbeatSecret ? { 'x-heartbeat-secret': heartbeatSecret } : {}),
        },
        body: JSON.stringify({ resumeText: TEST_RESUME }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const e2eTime = Date.now() - e2eStart;

      if (scanResp.status === 429) {
        // Alive (the limiter answered coherently) but the report path is
        // unverified this cycle. Don't page for this.
        checks.push({ name: 'e2e_scan', passed: true, responseTimeMs: e2eTime, error: 'rate-limited: alive but report unverified (set HEARTBEAT_SECRET)' });
      } else if (!scanResp.ok) {
        const bodyText = (await scanResp.text()).substring(0, 200);
        checks.push({ name: 'e2e_scan', passed: false, responseTimeMs: e2eTime, error: `HTTP ${scanResp.status}: ${bodyText}` });
        overallStatus = 'down';
        errorMessage = errorMessage || `E2E scan: HTTP ${scanResp.status}`;
      } else {
        const scanJson = await scanResp.json();
        const anatomyOk = typeof scanJson.atsScoreEstimate === 'number' && !!scanJson.reportMeta?.reportId;
        checks.push({
          name: 'e2e_scan',
          passed: anatomyOk,
          responseTimeMs: e2eTime,
          error: anatomyOk ? undefined : 'Response missing atsScoreEstimate/reportMeta',
        });
        if (!anatomyOk) {
          overallStatus = 'degraded';
          errorMessage = errorMessage || 'E2E scan: 200 but malformed report';
        }
      }
    } catch (e) {
      checks.push({
        name: 'e2e_scan',
        passed: false,
        responseTimeMs: Date.now() - e2eStart,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      overallStatus = 'down';
      errorMessage = errorMessage || `E2E scan: ${e instanceof Error ? e.message : 'Unknown'}`;
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
    // Fallback must be a real inbox: the old admin@resumebooster.com default
    // was a dead letter on a domain we don't even use (.com, site is .work).
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";

    if (!RESEND_API_KEY) return;

    // Durable dedupe, same pattern as free-keyword-scan's alerts: on a 10-min
    // schedule an outage would otherwise mean 6 emails/hour. check_rate_limit
    // is atomic and global across isolates; cap 2/hour. Best-effort — a
    // dedupe failure must never swallow a real alert.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const dedupeClient = createClient(supabaseUrl, serviceKey);
        const { data: allowed } = await dedupeClient.rpc('check_rate_limit', {
          p_function: 'alert:heartbeat',
          p_ip: 'global',
          p_max_requests: 2,
          p_window_minutes: 60,
        });
        if (allowed === false) {
          console.log('[SCAN-HEARTBEAT] Alert suppressed (2/hour global cap)');
          return;
        }
      }
    } catch (_e) { /* fall through and send */ }

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
