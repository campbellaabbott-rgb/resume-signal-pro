import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CohortStats {
  cohort_value: string;
  landing_view: number;
  upload_started: number;
  upload_completed: number;
  scan_started: number;
  scan_completed: number;
  results_viewed: number;
  product_clicked: number;
  checkout_started: number;
  purchase_completed: number;
  upload_rate: number;
  scan_rate: number;
  view_rate: number;
  checkout_rate: number;
  conversion_rate: number;
}

interface TopPerformer {
  cohort_value: string;
  metric: string;
  value: number;
  visitors: number;
  conversions: number;
}

interface WeeklyReport {
  week_start: string;
  week_end: string;
  dimensions: Record<string, CohortStats[]>;
  top_traffic_sources: TopPerformer[];
  top_segments: TopPerformer[];
  insights: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin API key
    const adminApiKey = Deno.env.get('ADMIN_API_KEY');
    const authHeader = req.headers.get('x-admin-key') || req.headers.get('authorization')?.replace('Bearer ', '');
    
    if (!adminApiKey || authHeader !== adminApiKey) {
      console.log('[CohortReport] Unauthorized access attempt');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting weekly cohort report generation...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate week boundaries (last 7 days)
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    console.log(`Generating report for ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);

    // Fetch cohort stats for different dimensions
    const dimensions = ['trafficSource', 'deviceType', 'browser', 'os', 'userType', 'utmSource', 'utmMedium', 'utmCampaign'];
    const cohortData: Record<string, CohortStats[]> = {};

    for (const dimension of dimensions) {
      console.log(`Fetching stats for dimension: ${dimension}`);
      const { data, error } = await supabase.rpc('get_funnel_cohort_stats', {
        p_cohort_dimension: dimension,
        p_days_back: 7
      });

      if (error) {
        console.error(`Error fetching ${dimension} stats:`, error);
        cohortData[dimension] = [];
      } else {
        cohortData[dimension] = data || [];
      }
    }

    // Identify top-performing traffic sources (by conversion rate with minimum visitors)
    const topTrafficSources: TopPerformer[] = [];
    const trafficSourceStats = cohortData['trafficSource'] || [];
    
    const qualifiedSources = trafficSourceStats
      .filter(s => s.landing_view >= 5) // Minimum 5 visitors for statistical relevance
      .sort((a, b) => b.conversion_rate - a.conversion_rate)
      .slice(0, 5);

    for (const source of qualifiedSources) {
      topTrafficSources.push({
        cohort_value: source.cohort_value,
        metric: 'conversion_rate',
        value: source.conversion_rate,
        visitors: source.landing_view,
        conversions: source.purchase_completed
      });
    }

    // Identify top segments across other dimensions
    const topSegments: TopPerformer[] = [];
    const segmentDimensions = ['deviceType', 'browser', 'userType'];

    for (const dimension of segmentDimensions) {
      const stats = cohortData[dimension] || [];
      const topInDimension = stats
        .filter(s => s.landing_view >= 5)
        .sort((a, b) => b.conversion_rate - a.conversion_rate)
        .slice(0, 2);

      for (const segment of topInDimension) {
        topSegments.push({
          cohort_value: `${dimension}:${segment.cohort_value}`,
          metric: 'conversion_rate',
          value: segment.conversion_rate,
          visitors: segment.landing_view,
          conversions: segment.purchase_completed
        });
      }
    }

    // Sort top segments by conversion rate
    topSegments.sort((a, b) => b.value - a.value);

    // Generate insights
    const insights: string[] = [];

    // Traffic source insights
    if (topTrafficSources.length > 0) {
      const bestSource = topTrafficSources[0];
      insights.push(`Top traffic source: ${bestSource.cohort_value} with ${bestSource.value.toFixed(1)}% conversion rate (${bestSource.visitors} visitors, ${bestSource.conversions} conversions)`);
    }

    // Device insights
    const deviceStats = cohortData['deviceType'] || [];
    const mobileStats = deviceStats.find(d => d.cohort_value === 'mobile');
    const desktopStats = deviceStats.find(d => d.cohort_value === 'desktop');
    
    if (mobileStats && desktopStats && mobileStats.landing_view > 0 && desktopStats.landing_view > 0) {
      const mobileConv = mobileStats.conversion_rate;
      const desktopConv = desktopStats.conversion_rate;
      if (mobileConv > desktopConv * 1.2) {
        insights.push(`Mobile converts ${((mobileConv / desktopConv - 1) * 100).toFixed(0)}% better than desktop`);
      } else if (desktopConv > mobileConv * 1.2) {
        insights.push(`Desktop converts ${((desktopConv / mobileConv - 1) * 100).toFixed(0)}% better than mobile`);
      }
    }

    // New vs returning user insights
    const userTypeStats = cohortData['userType'] || [];
    const newUsers = userTypeStats.find(u => u.cohort_value === 'new');
    const returningUsers = userTypeStats.find(u => u.cohort_value === 'returning');
    
    if (newUsers && returningUsers && returningUsers.landing_view > 0) {
      if (returningUsers.conversion_rate > newUsers.conversion_rate * 1.5) {
        insights.push(`Returning users convert ${((returningUsers.conversion_rate / newUsers.conversion_rate - 1) * 100).toFixed(0)}% better than new users - focus on retention`);
      }
    }

    // Funnel drop-off insights
    const overallStats = trafficSourceStats.reduce((acc, curr) => ({
      landing_view: acc.landing_view + curr.landing_view,
      upload_started: acc.upload_started + curr.upload_started,
      upload_completed: acc.upload_completed + curr.upload_completed,
      scan_completed: acc.scan_completed + curr.scan_completed,
      results_viewed: acc.results_viewed + curr.results_viewed,
      checkout_started: acc.checkout_started + curr.checkout_started,
      purchase_completed: acc.purchase_completed + curr.purchase_completed
    }), {
      landing_view: 0, upload_started: 0, upload_completed: 0,
      scan_completed: 0, results_viewed: 0, checkout_started: 0, purchase_completed: 0
    });

    if (overallStats.landing_view > 0) {
      const uploadRate = (overallStats.upload_started / overallStats.landing_view) * 100;
      const scanRate = overallStats.upload_started > 0 ? (overallStats.scan_completed / overallStats.upload_started) * 100 : 0;
      const checkoutRate = overallStats.results_viewed > 0 ? (overallStats.checkout_started / overallStats.results_viewed) * 100 : 0;

      if (uploadRate < 20) {
        insights.push(`Low upload engagement (${uploadRate.toFixed(1)}%) - consider improving landing page CTA`);
      }
      if (scanRate < 50 && overallStats.upload_started > 10) {
        insights.push(`Upload to scan drop-off is ${(100 - scanRate).toFixed(1)}% - investigate upload UX issues`);
      }
      if (checkoutRate < 10 && overallStats.results_viewed > 10) {
        insights.push(`Only ${checkoutRate.toFixed(1)}% of result viewers start checkout - review pricing or value proposition`);
      }
    }

    // UTM campaign insights
    const utmCampaignStats = cohortData['utmCampaign'] || [];
    const topCampaign = utmCampaignStats
      .filter(c => c.cohort_value !== 'none' && c.landing_view >= 3)
      .sort((a, b) => b.conversion_rate - a.conversion_rate)[0];
    
    if (topCampaign) {
      insights.push(`Best performing campaign: "${topCampaign.cohort_value}" with ${topCampaign.conversion_rate.toFixed(1)}% conversion`);
    }

    // Store the report
    const reportData: WeeklyReport = {
      week_start: weekStart.toISOString().split('T')[0],
      week_end: weekEnd.toISOString().split('T')[0],
      dimensions: cohortData,
      top_traffic_sources: topTrafficSources,
      top_segments: topSegments,
      insights
    };

    const { error: insertError } = await supabase
      .from('cohort_weekly_reports')
      .insert({
        week_start: reportData.week_start,
        week_end: reportData.week_end,
        report_data: cohortData,
        top_traffic_sources: topTrafficSources,
        top_segments: topSegments,
        insights: insights
      });

    if (insertError) {
      console.error('Error storing report:', insertError);
      throw insertError;
    }

    console.log('Weekly cohort report generated successfully');
    console.log(`Insights: ${insights.length}`);
    console.log(`Top sources: ${topTrafficSources.length}`);
    console.log(`Top segments: ${topSegments.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        report: {
          week_start: reportData.week_start,
          week_end: reportData.week_end,
          top_traffic_sources: topTrafficSources,
          top_segments: topSegments.slice(0, 5),
          insights,
          dimensions_analyzed: dimensions.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error: unknown) {
    console.error('Error generating cohort report:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate cohort report';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
