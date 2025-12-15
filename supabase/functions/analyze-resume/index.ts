import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText } = await req.json();
    
    if (!resumeText || resumeText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service not configured");
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

    console.log("Calling Lovable AI for resume analysis...");
    
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
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Service is busy. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error("AI analysis failed");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("No content in AI response:", data);
      throw new Error("Empty AI response");
    }

    console.log("Raw AI response:", content);

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
      console.error("Failed to parse AI response:", parseError, content);
      throw new Error("Failed to parse analysis results");
    }

    // Validate the response structure
    if (!analysis.optimizedBullets || !analysis.actionVerbs || !analysis.keywords || !analysis.redFlags) {
      console.error("Invalid analysis structure:", analysis);
      throw new Error("Invalid analysis format");
    }

    console.log("Analysis complete:", JSON.stringify(analysis).slice(0, 200));

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in analyze-resume function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
