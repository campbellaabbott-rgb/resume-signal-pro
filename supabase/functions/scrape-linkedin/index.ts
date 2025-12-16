import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT = 5; // 5 requests per hour (strict - uses paid Firecrawl API)
const RATE_WINDOW_MINUTES = 60;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Get client IP for rate limiting
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                   req.headers.get('x-real-ip') || 
                   'unknown';

  try {
    console.log(`[SCRAPE-LINKEDIN] Request from IP: ${clientIp}`);

    // Check persistent rate limit
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'scrape-linkedin',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[SCRAPE-LINKEDIN] Rate limit check error:", rlError);
    } else if (!allowed) {
      console.log(`[SCRAPE-LINKEDIN] Rate limit exceeded for IP: ${clientIp}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again later or paste your profile text instead.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'LinkedIn URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate LinkedIn URL format
    const linkedinRegex = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
    if (!linkedinRegex.test(url.trim())) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid LinkedIn profile URL. Please use format: linkedin.com/in/username' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!apiKey) {
      console.error('[SCRAPE-LINKEDIN] FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'LinkedIn scraping service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[SCRAPE-LINKEDIN] Scraping URL:', url);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url.trim(),
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[SCRAPE-LINKEDIN] Firecrawl API error:', data);
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'Scraping service quota exceeded. Please try pasting your profile text instead.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: false, error: 'Could not scrape LinkedIn profile. Please try pasting your profile text instead.' }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const markdown = data.data?.markdown || data.markdown || '';
    
    if (!markdown || markdown.length < 100) {
      console.error('[SCRAPE-LINKEDIN] Insufficient content scraped');
      return new Response(
        JSON.stringify({ success: false, error: 'Could not extract enough profile content. Please try pasting your profile text instead.' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[SCRAPE-LINKEDIN] Successfully scraped profile, content length:', markdown.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        text: markdown,
        metadata: data.data?.metadata || data.metadata || {}
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SCRAPE-LINKEDIN] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An error occurred while scraping the profile.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});