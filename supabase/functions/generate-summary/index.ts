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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const nameGreeting = candidateName ? `${candidateName}, here's` : "Here's";
    
    const prompt = `You are a friendly career coach. Write ONE short paragraph (2-3 sentences max) summarizing this resume scan for the candidate. Be encouraging but honest. Use simple language.

Data:
- ATS Score: ${atsScore}/100
- Format Grade: ${formatGrade}
- Industry: ${industry}
- Experience: ${experienceLevel}
- Top Strength: ${topStrength}
- Red Flags Found: ${redFlagsCount}
- Quick Wins Available: ${quickWins?.length || 0}
- Improvement Potential: ${improvementPotential?.estimatedScoreIncrease || 10}+ points

Start with "${nameGreeting}" and focus on: 1) their biggest strength, 2) the #1 thing holding them back, 3) encouragement that small fixes can make a big difference. Keep it under 50 words.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited", summary: null }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required", summary: null }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || null;

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in generate-summary:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage, summary: null }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
