// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Public (verify_jwt=false) LLM endpoint — per-IP rate limit so it can't be
  // looped to burn AI credits. Mirrors the throttle on the other generators.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-elevator-pitch", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { resumeText, industry, currentRole, experienceLevel, candidateName, targetRole } = await req.json();

    if (!resumeText || resumeText.length < 50) {
      return new Response(JSON.stringify({ error: "Resume text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert career coach who crafts compelling 60-second elevator pitches. 

RULES:
- The pitch should be 150-200 words (approximately 60 seconds when spoken)
- Write in FIRST PERSON as if the candidate is speaking
- Be confident but not arrogant
- Lead with their strongest value proposition
- Include 1-2 specific quantified achievements from their resume
- End with a clear "ask" or next step
- Make it conversational and natural-sounding, not robotic
- Tailor the language to the industry (e.g., technical for tech, clinical for healthcare)
- If a target role is provided, angle the pitch toward that specific role
- Do NOT use generic filler phrases like "I'm a results-driven professional"
- DO use specific, memorable details from their actual experience

OUTPUT FORMAT (use tool calling):
Return the pitch text, a suggested opening line variant, and 3 key talking points they should remember.`;

    const userPrompt = `Generate a 60-second elevator pitch for this person:

${candidateName ? `Name: ${candidateName}` : ''}
${currentRole ? `Current Role: ${currentRole}` : ''}
${targetRole ? `Target Role: ${targetRole}` : ''}
Industry: ${industry || 'General'}
Experience Level: ${experienceLevel || 'Mid-level'}

<resume>
${resumeText.substring(0, 8000)}
</resume>`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_pitch",
            description: "Submit the generated elevator pitch",
            parameters: {
              type: "object",
              properties: {
                pitch: {
                  type: "string",
                  description: "The full 60-second elevator pitch (150-200 words, first person)"
                },
                alternateOpening: {
                  type: "string",
                  description: "An alternative opening line they can swap in"
                },
                keyTalkingPoints: {
                  type: "array",
                  items: { type: "string" },
                  description: "3 key talking points to remember"
                },
                wordCount: {
                  type: "number",
                  description: "Approximate word count of the pitch"
                },
                estimatedSeconds: {
                  type: "number",
                  description: "Estimated speaking time in seconds"
                }
              },
              required: ["pitch", "alternateOpening", "keyTalkingPoints", "wordCount", "estimatedSeconds"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "submit_pitch" } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI service credits exhausted." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "Failed to generate pitch" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response");
      return new Response(JSON.stringify({ error: "Failed to parse pitch" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let pitchData;
    try {
      pitchData = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool call arguments:", e);
      return new Response(JSON.stringify({ error: "Failed to parse pitch data" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, ...pitchData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("generate-elevator-pitch error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
