import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout

// Cache configuration
const CACHE_FUNCTION_NAME = 'generate-summary';
const CACHE_TTL_HOURS = 2; // Cache for 2 hours

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry and exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    try {
      console.log(`[GENERATE-SUMMARY] Attempt ${attempt}/${maxRetries}`);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Don't retry client errors (4xx) except rate limits (429)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }
      
      // Retry on server errors (5xx) and rate limits (429)
      if (attempt < maxRetries) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`[GENERATE-SUMMARY] AI API error ${response.status}, retrying in ${delay}ms`);
        await sleep(delay);
      } else {
        return response; // Return last response on final attempt
      }
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const isTimeout = lastError.name === 'AbortError' || lastError.message.includes('timeout');
      const errorType = isTimeout ? 'timeout' : 'network';
      
      if (attempt < maxRetries) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[GENERATE-SUMMARY] ${errorType} error, retrying in ${delay}ms: ${lastError.message}`);
        await sleep(delay);
      } else {
        console.error(`[GENERATE-SUMMARY] All ${maxRetries} attempts failed: ${lastError.message}`);
      }
    }
  }
  
  throw lastError || new Error('AI API request failed after retries');
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      candidateName,
      atsScore, 
      formatGrade, 
      industry, 
      experienceLevel,
      topStrength,
      redFlagsCount,
      quickWins,
      improvementPotential
    } = await req.json();

    // Initialize Supabase for caching
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Create cache key from inputs
    const cacheInput = `${atsScore}|${formatGrade}|${industry}|${experienceLevel}|${topStrength}|${redFlagsCount}|${improvementPotential?.estimatedScoreIncrease || 0}`;
    const cacheKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheInput))
      .then(hash => Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''))
      .then(hex => hex.substring(0, 32));
    
    // Check cache first
    const { data: cachedResponse, error: cacheError } = await supabase.rpc('get_cached_response', {
      p_cache_key: cacheKey,
      p_function_name: CACHE_FUNCTION_NAME
    });
    
    if (!cacheError && cachedResponse?.summary) {
      const duration = Date.now() - startTime;
      console.log(`[GENERATE-SUMMARY] Cache HIT in ${duration}ms for key ${cacheKey.substring(0, 8)}...`);
      return new Response(JSON.stringify({ summary: cachedResponse.summary, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`[GENERATE-SUMMARY] Cache MISS for key ${cacheKey.substring(0, 8)}...`);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const nameToUse = candidateName && candidateName.trim() && !candidateName.includes('[') && !candidateName.toLowerCase().includes('friend') ? candidateName.split(' ')[0] : null;
    const topQuickWin = quickWins?.[0]?.fix || "adding quantified achievements";
    
    const prompt = `Write a 2-3 sentence personalized resume feedback. Warm, direct, like texting a friend. Under 60 words.

DATA:
${nameToUse ? `Name: ${nameToUse}` : 'No name (start with "Hey!")'}
Score: ${atsScore}/100 | Format: ${formatGrade} | Industry: ${industry} | Level: ${experienceLevel}
Strength: ${topStrength} | Issues: ${redFlagsCount} | Quick win: ${topQuickWin} | Potential boost: +${improvementPotential?.estimatedScoreIncrease || 10}pts

STRUCTURE: ${nameToUse ? `"${nameToUse}, [praise strength]..."` : '"Hey! [praise strength]..."'} → mention #1 issue → end with quick win hope.
NEVER use placeholders like "[Name]". Use actual name or skip it.`;


    const response = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite", // Using lite for faster response on simple summaries
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      if (response.status === 429) {
        console.log(`[GENERATE-SUMMARY] Rate limited after ${duration}ms`);
        return new Response(JSON.stringify({ error: "Rate limited", summary: null }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        console.log(`[GENERATE-SUMMARY] Payment required after ${duration}ms`);
        return new Response(JSON.stringify({ error: "Payment required", summary: null }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error(`[GENERATE-SUMMARY] AI gateway error after ${duration}ms:`, response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || null;

    console.log(`[GENERATE-SUMMARY] Success in ${duration}ms`);

    // Store in cache for future requests (non-blocking)
    if (summary) {
      (async () => {
        try {
          const { error } = await supabase.rpc('store_cached_response', {
            p_cache_key: cacheKey,
            p_function_name: CACHE_FUNCTION_NAME,
            p_response: { summary },
            p_ttl_hours: CACHE_TTL_HOURS
          });
          if (error) {
            console.error(`[GENERATE-SUMMARY] Cache store error:`, error.message);
          } else {
            console.log(`[GENERATE-SUMMARY] Cached response for key ${cacheKey.substring(0, 8)}...`);
          }
        } catch (err) {
          console.error(`[GENERATE-SUMMARY] Cache store exception:`, err);
        }
      })();
    }

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[GENERATE-SUMMARY] Error after ${duration}ms:`, error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('AbortError');
    
    return new Response(JSON.stringify({ 
      error: isTimeout ? "Request timed out. Please try again." : errorMessage, 
      summary: null,
      retryable: isTimeout
    }), {
      status: isTimeout ? 504 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
