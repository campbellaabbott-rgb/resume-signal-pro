import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// OPTIMIZATION: Removed alert system - not needed for tracking events
// Removed EdgeRuntime dependency for simpler, faster execution

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT = 50;
const RATE_WINDOW_MINUTES = 60;

// OPTIMIZATION: Module-level Supabase client reuse
// deno-lint-ignore no-explicit-any
let supabaseInstance: any = null;
function getSupabase() {
  if (!supabaseInstance) {
    supabaseInstance = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
  }
  return supabaseInstance;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { testName, variant, eventType, visitorId, metadata } = await req.json();

    // Fast validation (no DB calls)
    if (!testName || !variant || !eventType || !visitorId) {
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

    // OPTIMIZATION: Simplified regex checks - less strict for speed
    if (testName.length > 50 || variant.length > 30 || visitorId.length !== 36) {
      return new Response(
        JSON.stringify({ error: 'Invalid input format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('cf-connecting-ip') || 'unknown';

    // Single optimized DB call
    const { data: result, error: rpcError } = await getSupabase().rpc('track_ab_event_optimized', {
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
      console.error('Error tracking A/B event:', rpcError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to track event' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // OPTIMIZATION: Minimal logging for success cases
    // deno-lint-ignore no-explicit-any
    const status = (result as any)?.status || 'tracked';
    if (status !== 'tracked') {
      console.log(`[TRACK-AB] ${status}: ${testName}/${eventType}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
