import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-KEYWORD-FIX] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, personalizationContext } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting keyword analysis", { 
      hasJobDescription: !!jobDescription,
      hasPersonalization: !!personalizationContext,
      resumeLength: resumeText?.length 
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) keyword analyst. 
Your job is to analyze resumes and identify missing keywords that would improve ATS matching scores.

${personalizationContext ? `CANDIDATE CONTEXT (use this to personalize your analysis):
${personalizationContext}

Tailor your keyword suggestions specifically for this candidate's industry, experience level, and career stage.` : ''}

You MUST respond with a valid JSON object containing:
{
  "missingKeywords": [
    { "keyword": "string", "importance": "critical|high|medium", "category": "string", "suggestion": "string" }
  ],
  "industryKeywords": [
    { "keyword": "string", "relevance": "string" }
  ],
  "actionVerbs": [
    { "current": "string or null", "suggested": "string", "context": "string" }
  ],
  "skillGaps": [
    { "skill": "string", "reason": "string", "howToAdd": "string" }
  ],
  "overallScore": number (0-100),
  "summary": "string (2-3 sentences about the resume's keyword optimization status)"
}

Focus on:
1. Keywords commonly used in ATS systems for the relevant industry
2. Action verbs that demonstrate impact
3. Technical skills and certifications relevant to their experience level
4. Industry-specific terminology for their target role
5. Soft skills keywords that ATS systems look for`;

    const userPrompt = `Analyze this resume for missing ATS keywords:

RESUME:
${resumeText}

${jobDescription ? `TARGET JOB DESCRIPTION:
${jobDescription}

JOB TITLE: ${jobTitle || 'Not specified'}
COMPANY: ${jobCompany || 'Not specified'}` : 'No specific job description provided - provide general industry keywords.'}

Provide a comprehensive keyword analysis with actionable suggestions.`;

    logStep("Calling AI API");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite", // Using lite for faster keyword analysis
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText });
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    logStep("AI response received");

    const content = aiResponse.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content in AI response");
    }

    // Parse JSON from response
    let result;
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      logStep("JSON parse error, using raw content", { error: String(parseError) });
      result = {
        missingKeywords: [],
        industryKeywords: [],
        actionVerbs: [],
        skillGaps: [],
        overallScore: 50,
        summary: content.substring(0, 500),
        raw: content
      };
    }

    logStep("Keyword analysis complete", { 
      keywordCount: result.missingKeywords?.length,
      score: result.overallScore 
    });

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-KEYWORD-FIX] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to generate keyword analysis", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
