// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin API key
    const adminApiKey = Deno.env.get('ADMIN_API_KEY');
    const authHeader = req.headers.get('x-admin-key') || req.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!adminApiKey || authHeader !== adminApiKey) {
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

    // Query ab_test_events with service role (bypasses RLS)
    // Note: PostgREST has a default max of 1000 rows per request, so we paginate.
    // We use keyset pagination (created_at + id) to avoid relying on large offsets.
    const batchSize = 1000;
    const maxRows = 50000; // safety cap

    const events: any[] = [];
    let lastCreatedAt: string | null = null;
    let lastId: string | null = null;

    while (events.length < maxRows) {
      let query = supabase
        .from('ab_test_events')
        // visitor_id is REQUIRED to count people rather than events. Without it
        // one visitor reloading forty times reads as forty. It is a pseudonymous
        // UUID and is aggregated below — raw ids never leave this function.
        .select('id, test_name, variant, event_type, metadata, created_at, visitor_id')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(batchSize);

      if (lastCreatedAt && lastId) {
        query = query.or(
          `created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId})`
        );
      }

      const { data: batch, error: batchError } = await query;

      if (batchError) {
        console.error('[Analytics] Query error:', batchError);
        throw batchError;
      }

      if (batch?.length) {
        events.push(...batch);
        const last = batch[batch.length - 1] as any;
        lastCreatedAt = last.created_at;
        lastId = last.id;
      }

      if (!batch || batch.length < batchSize) break;
    }

    if (events.length >= maxRows) {
      console.warn(`[Analytics] Reached maxRows cap (${maxRows}). Some events may be omitted.`);
    }

    console.log(`[Analytics] Found ${events.length} events`);

    // AUDIENCE — the numbers that answer "does anyone use this?". Everything
    // else on this dashboard measures events; these measure PEOPLE.
    const allVisitors = new Set<string>();
    const visitorsByDay = new Map<string, Set<string>>();
    const eventsByDay = new Map<string, number>();
    const visitorFirstSeen = new Map<string, string>(); // id -> earliest day seen
    const surfaceVisitors = new Map<string, Set<string>>(); // test_name -> visitors

    for (const e of events) {
      const vid = (e as { visitor_id?: string }).visitor_id;
      const day = String(e.created_at).slice(0, 10);
      eventsByDay.set(day, (eventsByDay.get(day) ?? 0) + 1);
      if (!vid) continue;
      allVisitors.add(vid);
      if (!visitorsByDay.has(day)) visitorsByDay.set(day, new Set());
      visitorsByDay.get(day)!.add(vid);
      if (!surfaceVisitors.has(e.test_name)) surfaceVisitors.set(e.test_name, new Set());
      surfaceVisitors.get(e.test_name)!.add(vid);
      const prev = visitorFirstSeen.get(vid);
      if (!prev || day < prev) visitorFirstSeen.set(vid, day);
    }

    // A returning visitor is one seen on more than one distinct day — the
    // cheapest honest signal that the product is worth coming back to.
    const daysPerVisitor = new Map<string, Set<string>>();
    for (const [day, ids] of visitorsByDay) {
      for (const id of ids) {
        if (!daysPerVisitor.has(id)) daysPerVisitor.set(id, new Set());
        daysPerVisitor.get(id)!.add(day);
      }
    }
    let returningVisitors = 0;
    for (const days of daysPerVisitor.values()) if (days.size > 1) returningVisitors++;

    const audience = {
      uniqueVisitors: allVisitors.size,
      totalEvents: events.length,
      returningVisitors,
      eventsPerVisitor: allVisitors.size ? Math.round((events.length / allVisitors.size) * 10) / 10 : 0,
      // Ascending by day so the dashboard can render a trend directly.
      daily: [...visitorsByDay.keys()].sort().map((day) => ({
        day,
        visitors: visitorsByDay.get(day)!.size,
        events: eventsByDay.get(day) ?? 0,
        newVisitors: [...visitorsByDay.get(day)!].filter((id) => visitorFirstSeen.get(id) === day).length,
      })),
      bySurface: [...surfaceVisitors.entries()]
        .map(([surface, ids]) => ({ surface, visitors: ids.size }))
        .sort((a, b) => b.visitors - a.visitors)
        .slice(0, 25),
      // Honest caveat the UI must surface: above the cap these are undercounts.
      truncated: events.length >= maxRows,
    };

    // Process events into metrics
    const metrics: Record<string, Record<string, { views: number; conversions: number }>> = {};
    const pageSpecificMetrics: Record<string, Record<string, Record<string, { views: number; conversions: number }>>> = {
      home: {},
      pricing: {},
    };

    events?.forEach(event => {
      const eventPage = (event.metadata as { page?: string })?.page;

      // Track per-page metrics for scroll_depth and time_on_page
      if ((event.test_name === 'scroll_depth' || event.test_name === 'time_on_page') && eventPage) {
        if (pageSpecificMetrics[eventPage]) {
          if (!pageSpecificMetrics[eventPage][event.test_name]) {
            pageSpecificMetrics[eventPage][event.test_name] = {};
          }
          if (!pageSpecificMetrics[eventPage][event.test_name][event.variant]) {
            pageSpecificMetrics[eventPage][event.test_name][event.variant] = { views: 0, conversions: 0 };
          }
          if (event.event_type === 'view') {
            pageSpecificMetrics[eventPage][event.test_name][event.variant].views++;
          } else if (event.event_type === 'conversion') {
            pageSpecificMetrics[eventPage][event.test_name][event.variant].conversions++;
          }
        }
      }

      // For scroll_depth and time_on_page, filter by page if not "all"
      if (pageFilter && pageFilter !== "all" && (event.test_name === 'scroll_depth' || event.test_name === 'time_on_page')) {
        if (eventPage !== pageFilter) return;
      }

      if (!metrics[event.test_name]) {
        metrics[event.test_name] = {};
      }
      if (!metrics[event.test_name][event.variant]) {
        metrics[event.test_name][event.variant] = { views: 0, conversions: 0 };
      }
      if (event.event_type === 'view') {
        metrics[event.test_name][event.variant].views++;
      } else if (event.event_type === 'conversion') {
        metrics[event.test_name][event.variant].conversions++;
      }
    });

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
