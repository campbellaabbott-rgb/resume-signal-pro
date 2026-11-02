// deploy-stamp: 2026-10-09T14:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { keyMatches } from "../_shared/admin-key.ts";
import { createRollup, type AnalyticsEvent } from "./rollup.ts";

// THE DASHBOARD COULD NEVER REACH THIS (register L1-03). Its page sends the
// owner's key as x-admin-key, and this preflight did not allow that header,
// so the browser refused the request before it left: the dashboard was dead
// whatever key was entered. The header is allowed now, and the key is
// compared in constant time.
// 2026-11-03.1 (audit-rest, account; S13-070): every row of the range is read,
// newest first, and folded into the counts as it arrives (./rollup.ts); a run
// that spends its time budget leaves the oldest days partial and says from
// where (audience.coveredFrom), never the newest.
const FN_BUILD = "get-analytics.2026-11-03.1";
/** Nothing new is asked for after this long (the isolate dies near 150 s). */
const READ_BUDGET_MS = 110_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Expose-Headers': 'x-fn-build',
  'x-fn-build': FN_BUILD,
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin API key
    const adminApiKey = Deno.env.get('ADMIN_API_KEY') ?? '';
    const authHeader = req.headers.get('x-admin-key') || req.headers.get('authorization')?.replace('Bearer ', '') || '';
    
    if (!keyMatches(authHeader, adminApiKey)) {
      console.log('[Analytics] Unauthorized access attempt');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { startDate, endDate, pageFilter } = await req.json();

    console.log('[Analytics] Fetching data:', { startDate, endDate, pageFilter });

    // Validate inputs
    if (!startDate || !endDate) {
      return new Response(
        JSON.stringify({ error: 'startDate and endDate are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Query ab_test_events with service role (bypasses RLS).
    // NEWEST FIRST, EVERY ROW (S13-070, ./rollup.ts). PostgREST answers at
    // most 1,000 rows a request, so the read pages by keyset (created_at,
    // id), newest first, and folds each page into the counts before asking
    // for the next. It used to read oldest first and stop at 50,000 rows,
    // which dropped the newest days of a busy range. Only a run out of time
    // stops early now, and then the oldest days are the partial ones.
    const batchSize = 1000;
    const startedAt = Date.now();
    const rollup = createRollup(pageFilter);
    let lastCreatedAt: string | null = null;
    let lastId: string | null = null;
    let truncated = false;

    for (;;) {
      if (Date.now() - startedAt > READ_BUDGET_MS) { truncated = true; break; }
      let query = supabase
        .from('ab_test_events')
        // visitor_id is REQUIRED to count people rather than events. Without it
        // one visitor reloading forty times reads as forty. It is a pseudonymous
        // UUID and is aggregated below — raw ids never leave this function.
        // Of metadata only the page is read.
        .select('id, test_name, variant, event_type, page:metadata->>page, created_at, visitor_id')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(batchSize);

      if (lastCreatedAt && lastId) {
        query = query.or(
          `created_at.lt."${lastCreatedAt}",and(created_at.eq."${lastCreatedAt}",id.lt.${lastId})`
        );
      }

      const { data: batch, error: batchError } = await query;

      if (batchError) {
        console.error('[Analytics] Query error:', batchError);
        throw batchError;
      }

      if (batch?.length) {
        for (const e of batch as AnalyticsEvent[]) rollup.add(e);
        const last = batch[batch.length - 1] as { created_at: string; id: string };
        lastCreatedAt = last.created_at;
        lastId = last.id;
      }

      if (!batch || batch.length < batchSize) break;
    }

    if (truncated) {
      console.warn(`[Analytics] Read budget spent after ${rollup.totalEvents} events; days before ${lastCreatedAt} are partial.`);
    }

    console.log(`[Analytics] Found ${rollup.totalEvents} events`);

    // AUDIENCE — the numbers that answer "does anyone use this?". Everything
    // else on this dashboard measures events; these measure PEOPLE.
    const audience = rollup.audience(truncated, lastCreatedAt);
    const metrics = rollup.metrics;
    const pageSpecificMetrics = rollup.pageSpecificMetrics;

    // Transform to MetricData arrays
    const transformMetrics = (testName: string, source?: Record<string, { views: number; conversions: number }>) => {
      const testMetrics = source || metrics[testName] || {};
      return Object.entries(testMetrics)
        .map(([variant, counts]) => ({
          variant,
          views: counts.views,
          conversions: counts.conversions,
          conversionRate: counts.views > 0 ? (counts.conversions / counts.views) * 100 : 0,
        }))
        .sort((a, b) => {
          const aNum = parseFloat(a.variant.replace(/[^0-9.]/g, '')) || 0;
          const bNum = parseFloat(b.variant.replace(/[^0-9.]/g, '')) || 0;
          return aNum - bNum;
        });
    };

    // Get A/B test names
    const abTestNames = Object.keys(metrics).filter(
      name => !['scroll_depth', 'time_on_page', 'product_conversion'].includes(name)
    );

    const abTests: Record<string, any[]> = {};
    abTestNames.forEach(name => {
      abTests[name] = transformMetrics(name);
    });

    // Build page metrics for comparison
    const pageMetrics: Record<string, any> = {};
    Object.keys(pageSpecificMetrics).forEach(page => {
      pageMetrics[page] = {
        scrollDepth: transformMetrics('scroll_depth', pageSpecificMetrics[page]['scroll_depth']),
        timeOnPage: transformMetrics('time_on_page', pageSpecificMetrics[page]['time_on_page']),
      };
    });

    const result = {
      audience, // people, not events — see the AUDIENCE block above
      scrollDepth: transformMetrics('scroll_depth'),
      timeOnPage: transformMetrics('time_on_page'),
      conversions: transformMetrics('product_conversion'),
      abTests,
      pageMetrics,
    };

    console.log('[Analytics] Processed metrics successfully');

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch analytics';
    console.error('[Analytics] Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
