// deploy-stamp: 2026-10-08T12:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { keyMatches } from "../_shared/admin-key.ts";

// THE DASHBOARD COULD NEVER REACH THIS (register L1-03). Its page sends the
// owner's key as x-admin-key, and this preflight did not allow that header,
// so the browser refused the request before it left: the dashboard was dead
// whatever key was entered. The header is allowed now, and the key is
// compared in constant time.
const FN_BUILD = "get-error-telemetry.2026-10-08.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Expose-Headers': 'x-fn-build',
  'x-fn-build': FN_BUILD,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin API key — error_telemetry has no SELECT RLS policy (only an
    // anonymous-insert policy for logging), so this function uses the service role
    // client to read it, gated the same way get-analytics gates ab_test_events.
    const adminApiKey = Deno.env.get('ADMIN_API_KEY') ?? '';
    const authHeader = req.headers.get('x-admin-key') || req.headers.get('authorization')?.replace('Bearer ', '') || '';

    if (!keyMatches(authHeader, adminApiKey)) {
      console.log('[GET-ERROR-TELEMETRY] Unauthorized access attempt');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { sinceIso, limit } = await req.json();

    if (!sinceIso) {
      return new Response(
        JSON.stringify({ error: 'sinceIso is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase
      .from('error_telemetry')
      .select('*')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit || 1000, 1000));

    if (error) {
      console.error('[GET-ERROR-TELEMETRY] Query error:', error.message);
      return new Response(
        JSON.stringify({ error: 'Failed to query error telemetry' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[GET-ERROR-TELEMETRY] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
