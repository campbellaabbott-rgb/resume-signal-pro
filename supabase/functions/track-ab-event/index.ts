import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring - increased thresholds since we're now optimized
const SLOW_REQUEST_THRESHOLD = 3000;
const VERY_SLOW_THRESHOLD = 6000;

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@resumebooster.com";
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const alertLastSent: Record<string, number> = {};

async function sendAlert(alertType: string, subject: string, details: Record<string, unknown>) {
  const now = Date.now();
  if (now - (alertLastSent[alertType] || 0) < ALERT_COOLDOWN_MS) return;
  alertLastSent[alertType] = now;
  
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return;
    
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `⚠️ ${subject}`,
        html: `<h2>Edge Function Alert</h2><p><strong>Type:</strong> ${alertType}</p><p><strong>Time:</strong> ${new Date().toISOString()}</p><pre style="background:#f4f4f4;padding:15px;">${JSON.stringify(details, null, 2)}</pre>`,
      }),
    });
    console.log(`[ALERT] Sent ${alertType}`);
  } catch (e) { console.error("[ALERT] Error:", e); }
}

const trackPerformance = (startTime: number, operation: string, success: boolean, details?: Record<string, unknown>, clientIp?: string) => {
  const duration = Date.now() - startTime;
  const level = duration > VERY_SLOW_THRESHOLD ? 'CRITICAL' : duration > SLOW_REQUEST_THRESHOLD ? 'SLOW' : 'OK';
  console.log(`[PERF] ${operation} | ${duration}ms | ${level} | success=${success}${details ? ` | ${JSON.stringify(details)}` : ''}`);
  
  // Only alert on critical issues or errors - not slow requests for tracking
  if (!success) {
    EdgeRuntime.waitUntil(sendAlert(
      `${operation}_error`,
      `${operation} Error`,
      { operation, duration, level, success, ip: clientIp || 'unknown', ...details }
    ));
  }
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limits
const RATE_LIMIT = 50;
const RATE_WINDOW_MINUTES = 60;

// Get client IP from request headers
const getClientIp = (req: Request): string => {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown';
};

serve(async (req) => {
  const requestStartTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);

  try {
    const { testName, variant, eventType, visitorId, metadata } = await req.json();

    // Validate inputs (fast, no DB calls)
    if (!testName || !variant || !eventType || !visitorId) {
      console.error('Missing required fields:', { testName, variant, eventType, visitorId });
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['view', 'conversion'].includes(eventType)) {
      return new Response(
        JSON.stringify({ error: 'Invalid event type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[a-z_]{1,50}$/.test(testName)) {
      return new Response(
        JSON.stringify({ error: 'Invalid test name format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[a-zA-Z0-9_%]{1,30}$/.test(variant)) {
      return new Response(
        JSON.stringify({ error: 'Invalid variant format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitorId)) {
      return new Response(
        JSON.stringify({ error: 'Invalid visitor ID format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // OPTIMIZED: Single database call handles rate limiting, deduplication, and insertion
    const { data: result, error: rpcError } = await supabase.rpc('track_ab_event_optimized', {
      p_test_name: testName,
      p_variant: variant,
      p_event_type: eventType,
      p_visitor_id: visitorId,
      p_metadata: metadata || {},
      p_client_ip: clientIp,
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rpcError) {
      console.error('Error tracking A/B event:', rpcError);
      trackPerformance(requestStartTime, 'track-ab-event', false, { error: rpcError.message }, clientIp);
      return new Response(
        JSON.stringify({ error: 'Failed to track event' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const status = result?.status || 'unknown';
    
    // Log the outcome
    if (status === 'rate_limited') {
      console.log(`Rate limited IP: ${clientIp.slice(0, 10)}...`);
    } else if (status === 'duplicate') {
      console.log(`Duplicate ${eventType} for visitor ${visitorId.slice(0, 8)}... on test "${testName}" - skipped`);
    } else {
      console.log(`Tracked ${eventType} for test "${testName}", variant "${variant}", IP: ${clientIp.slice(0, 10)}...`);
    }

    trackPerformance(requestStartTime, 'track-ab-event', true, { testName, eventType, status }, clientIp);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    trackPerformance(requestStartTime, 'track-ab-event', false, { error: error instanceof Error ? error.message : 'Unknown' }, clientIp);
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
