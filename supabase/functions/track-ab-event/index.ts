// deploy-stamp: 2026-09-27T20:31Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordEvent, type Rpc } from "./budget.ts";

// Returned in every response so a deploy is provable from the outside: a
// POST that answers without `build`, or with an older one, is the previous
// bundle still serving. The same value rides as a response header on every
// answer INCLUDING the CORS preflight, so a deploy can be checked with an
// OPTIONS request that writes no row and spends no budget.
const BUILD_VERSION = "2026-09-27.2";

// OPTIMIZATION: Removed alert system - not needed for tracking events
// Removed EdgeRuntime dependency for simpler, faster execution

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': `track-ab-event.${BUILD_VERSION}`,
};

// The budget itself — both tiers and their numbers — lives in ./budget.ts so
// a Deno test can drive it with a fake RPC. This file parses, validates and
// answers; it holds no rate number and calls no RPC of its own.

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

const rpc: Rpc = (fn, args) => getSupabase().rpc(fn, args);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ ...body, build: BUILD_VERSION }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { testName, variant, eventType, visitorId, metadata } = await req.json();

    // Fast validation (no DB calls)
    if (!testName || !variant || !eventType || !visitorId) {
      return json({ error: 'Missing required fields' }, 400);
    }

    if (!['view', 'conversion'].includes(eventType)) {
      return json({ error: 'Invalid event type' }, 400);
    }

    // Length guards. visitorId was `!== 36` (exact UUID) — which silently 400'd
    // EVERY event from three different client id formats and left the funnel
    // recording nothing for months (diagnosed 2026-07-24: the board sent
    // "unknown", the error hooks sent `v_<epoch>_<rand>`). The client now always
    // sends a UUID, but this stays a RANGE so a future format change degrades
    // into slightly messier data instead of total, invisible data loss.
    if (testName.length > 50 || variant.length > 30 || visitorId.length < 8 || visitorId.length > 64) {
      return json({ error: 'Invalid input format' }, 400);
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('cf-connecting-ip') || 'unknown';

    const outcome = await recordEvent(rpc, { testName, variant, eventType, visitorId, metadata, clientIp });

    if (outcome.status === 'error') {
      console.error('Error tracking A/B event:', outcome.error);
      return json({ error: 'Failed to track event' }, 500);
    }

    // OPTIMIZATION: Minimal logging for success cases
    if (outcome.status !== 'recorded') {
      console.log(`[TRACK-AB] ${outcome.status}: ${testName}/${eventType}`);
    }

    // `success` stays true for every non-error outcome — the shape every
    // client already ignores — and `status` now says what actually happened
    // to the row, which is what the 2026-09-27 audit could not see: a
    // duplicate or a rate-limited event used to answer exactly like a
    // recorded one.
    return json({ success: true, status: outcome.status });
  } catch (error) {
    console.error('Unexpected error:', error instanceof Error ? error.message : error);
    return json({ error: 'Internal server error' }, 500);
  }
});
