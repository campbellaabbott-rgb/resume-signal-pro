import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

// Performance monitoring
const SLOW_REQUEST_THRESHOLD = 2000;
const VERY_SLOW_THRESHOLD = 5000;

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
  
  if (level === 'CRITICAL' || !success) {
    EdgeRuntime.waitUntil(sendAlert(
      success ? `${operation}_slow` : `${operation}_error`,
      success ? `${operation} CRITICAL (${duration}ms)` : `${operation} Error`,
      { operation, duration, level, success, ip: clientIp || 'unknown', ...details }
    ));
  }
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limits
const RATE_LIMIT = 50; // max events per IP per hour
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

    // Validate inputs
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

    // Validate testName and variant (prevent injection)
    if (!/^[a-z_]{1,50}$/.test(testName)) {
      return new Response(
        JSON.stringify({ error: 'Invalid test name format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Allow lowercase with underscores for A/B variants, camelCase for product IDs,
    // and formats like "25%", "30s", "2m" for scroll depth / time on page tracking
    if (!/^[a-zA-Z0-9_%]{1,30}$/.test(variant)) {
      return new Response(
        JSON.stringify({ error: 'Invalid variant format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate visitorId format (should be UUID)
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

    // Rate limiting check
    const { data: isAllowed, error: rateLimitError } = await supabase.rpc('check_rate_limit', {
      p_function: 'track-ab-event',
      p_ip: clientIp,
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
      // Continue anyway - don't block on rate limit errors
    } else if (!isAllowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIp}`);
      // Silently accept but don't record (don't alert attackers)
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplication: Check if this exact event was already recorded recently
    // For views: only one view per visitor per test per day
    // For conversions: only one conversion per visitor per test ever
    const { data: existingEvent, error: checkError } = await supabase
      .from('ab_test_events')
      .select('id')
      .eq('test_name', testName)
      .eq('visitor_id', visitorId)
      .eq('event_type', eventType)
      .gte('created_at', eventType === 'view' 
        ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // last 24h for views
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() // last 90 days for conversions
      )
      .limit(1);

    if (checkError) {
      console.error('Dedup check error:', checkError);
      // Continue anyway - don't block on dedup errors
    } else if (existingEvent && existingEvent.length > 0) {
      console.log(`Duplicate ${eventType} for visitor ${visitorId.slice(0, 8)}... on test "${testName}" - skipping`);
      // Silently accept but don't record duplicate
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Record the event
    const { error: insertError } = await supabase.rpc('track_ab_event', {
      p_test_name: testName,
      p_variant: variant,
      p_event_type: eventType,
      p_visitor_id: visitorId,
      p_metadata: metadata || {}
    });

    if (insertError) {
      console.error('Error tracking A/B event:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to track event' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    trackPerformance(requestStartTime, 'track-ab-event', true, { testName, eventType }, clientIp);
    console.log(`Tracked ${eventType} for test "${testName}", variant "${variant}", IP: ${clientIp.slice(0, 10)}...`);

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
