import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESUME_LENGTH = 50000; // 50K characters max

// Generic error messages for clients
const ERROR_MESSAGES = {
  INTERNAL: 'An error occurred while processing your request. Please try again.',
  INVALID_INPUT: 'Invalid input provided.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText } = await req.json();
    
    if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Input length validation
    if (resumeText.length > MAX_RESUME_LENGTH) {
      console.log(`[ANALYZE-RESUME] Resume too long: ${resumeText.length} characters`);
      return new Response(
        JSON.stringify({ error: 'Resume text is too long. Please limit to 50,000 characters.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[ANALYZE-RESUME] LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) resume analyst and recruiter. Write like a recruiter, not a career coach. Be direct with no motivational language. Prioritize measurable impact over generic advice.

Analyze the provided resume and return a JSON object with EXACTLY this structure:
{
  "optimizedBullets": [
    {
      "original": "exact text from their resume that needs improvement",
      "improved": "rewritten version with metrics and impact",
      "reason": "brief explanation of the improvement"
    }
  ],
  "actionVerbs": [
    { "weak": "weak verb found in resume", "strong": "stronger replacement" }
  ],
  "keywords": ["keyword1", "keyword2"],
  "redFlags": ["specific issue 1", "specific issue 2"]
}

Guidelines:
- optimizedBullets: Find 3-5 weak bullet points and rewrite them with specific metrics, outcomes, and impact. If metrics aren't available, estimate reasonable ones or show how to frame the achievement better.
- actionVerbs: Identify 4-6 weak verbs (helped, worked, assisted, etc.) and suggest powerful alternatives (spearheaded, engineered, orchestrated, etc.)
- keywords: Suggest 6-8 industry-relevant keywords that are missing but would improve ATS matching
- redFlags: List 3-5 specific issues recruiters would notice (gaps, missing metrics, vague descriptions, formatting issues, etc.)

Return ONLY valid JSON, no markdown formatting or code blocks.`;

    console.log("[ANALYZE-RESUME] Calling AI for resume analysis...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze this resume:\n\n${resumeText}` }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ANALYZE-RESUME] AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.RATE_LIMITED }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("[ANALYZE-RESUME] No content in AI response:", data);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[ANALYZE-RESUME] Raw AI response received");

    // Parse the JSON response
    let analysis;
    try {
      // Clean the response - remove any markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      analysis = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error("[ANALYZE-RESUME] Failed to parse AI response:", parseError);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate the response structure
    if (!analysis.optimizedBullets || !analysis.actionVerbs || !analysis.keywords || !analysis.redFlags) {
      console.error("[ANALYZE-RESUME] Invalid analysis structure");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[ANALYZE-RESUME] Analysis complete, saving to database...");

    // Save to database using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: savedAnalysis, error: dbError } = await supabase
      .from("resume_analyses")
      .insert({
        resume_text: resumeText,
        analysis_result: analysis,
      })
      .select("share_id")
      .single();

    if (dbError) {
      console.error("[ANALYZE-RESUME] Database error:", dbError);
      // Still return analysis even if save fails
      return new Response(
        JSON.stringify({ ...analysis, shareId: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[ANALYZE-RESUME] Analysis saved successfully");

    return new Response(
      JSON.stringify({ ...analysis, shareId: savedAnalysis.share_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[ANALYZE-RESUME] Error:", error);
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
