import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobTitle, industry } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) simulator and senior recruiter with 15+ years of hiring experience. Your task is to show the candidate EXACTLY what happens when their resume enters a company's hiring pipeline.

## OUTPUT FORMAT (JSON)
Return a valid JSON object with this structure:

{
  "atsParsedFields": {
    "name": "Extracted name or null",
    "email": "Extracted email or null",
    "phone": "Extracted phone or null",
    "location": "Extracted location or null",
    "currentTitle": "Extracted current title or null",
    "yearsExperience": "Estimated years or null",
    "education": "Highest degree + school or null",
    "skills": ["skill1", "skill2", "...up to 15"],
    "parseErrors": ["Any fields the ATS would fail to extract or misread"],
    "parseScore": 85
  },
  "recruiterHeatmap": [
    {
      "section": "Section name (e.g., 'Name/Title Header', 'Most Recent Role', 'Skills Section')",
      "viewOrder": 1,
      "timeSpent": "2-3 seconds",
      "attention": "high" | "medium" | "low" | "skipped",
      "recruiterThought": "What the recruiter thinks when they see this section"
    }
  ],
  "candidateRanking": {
    "estimatedRank": "Top 15%",
    "competitivePosition": "Above Average",
    "strengthSignals": ["Signal that makes recruiter want to interview"],
    "weaknessSignals": ["Signal that makes recruiter hesitate"],
    "dealBreakers": ["Any instant rejection triggers (empty array if none)"]
  },
  "recruiterNotes": {
    "firstImpression": "What the recruiter thinks in the first 6 seconds",
    "wouldInterview": true | false,
    "interviewProbability": "65%",
    "reasoningChain": [
      "Step 1 of recruiter's decision process",
      "Step 2...",
      "Step 3... final verdict"
    ],
    "internalNotes": "The candid notes a recruiter would write in their ATS about this candidate"
  },
  "screeningDecision": {
    "decision": "ADVANCE" | "MAYBE" | "REJECT",
    "confidence": "High" | "Medium" | "Low",
    "keyFactors": ["Factor 1", "Factor 2", "Factor 3"],
    "improvementToAdvance": "What one change would most improve their chances"
  }
}

## ANALYSIS RULES
- Be brutally honest but constructive
- Simulate a real 6-second recruiter scan
- The heatmap should reflect actual eye-tracking research (F-pattern, top-third focus)
- Parse errors should reflect real ATS failures (tables, headers, special characters)
- Ranking should be realistic for the industry/role level
- Recruiter notes should sound like real internal hiring notes`;

    const userPrompt = `Simulate the complete recruiter pipeline for this resume:

${resumeText}

${industry ? `Industry: ${industry}` : ''}
${jobTitle ? `Target Role: ${jobTitle}` : ''}

Show exactly what happens from ATS parsing → recruiter scan → screening decision.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Service temporarily unavailable." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) throw new Error("No content returned from AI");

    let recruiterView;
    try {
      recruiterView = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        recruiterView = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    if (!recruiterView.atsParsedFields || !recruiterView.recruiterHeatmap || !recruiterView.screeningDecision) {
      throw new Error("Response missing required fields");
    }

    return new Response(
      JSON.stringify({ success: true, data: recruiterView }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[RECRUITER-VIEW] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
