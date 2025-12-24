import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobTitle, jobCompany, jobDescription, matchingSkills, missingSkills, personalizationContext } = await req.json();

    if (!resumeText || !jobTitle) {
      return new Response(
        JSON.stringify({ error: 'Resume text and job title are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[TAILORED-RESUME] LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert resume strategist who helps candidates position their EXISTING experience for specific roles. You NEVER remove or condense content - you enhance and reframe it.

${personalizationContext ? `CANDIDATE CONTEXT:
${personalizationContext}

Adjust your language and emphasis based on their career stage.` : ''}

## ⚠️ CRITICAL RULES ⚠️

### CONTENT PRESERVATION:
- This is a TAILORING task, not a rewriting task
- You are providing SUGGESTIONS for how to present existing content
- NEVER recommend removing experiences, jobs, or achievements
- ALL original content should be enhanced, not cut

### YOUR JOB:
1. Provide a new professional summary tailored to the target role
2. Identify which of their existing skills to emphasize FIRST (but keep all)
3. Suggest how to REWORD existing bullet points to highlight relevance
4. Recommend what keywords from the job to weave into existing content
5. Provide strategic tips for the application

### WHAT YOU SHOULD NOT DO:
- Do not suggest removing any experiences
- Do not recommend cutting sections to "streamline"
- Do not condense multiple roles into one
- Do not drop older experiences

OUTPUT: Structured suggestions that help them enhance their existing resume for this role.`;

    const userPrompt = `Provide tailoring suggestions for this resume targeting this position:

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${jobCompany || 'Not specified'}
${jobDescription ? `- Job Description:\n${jobDescription.slice(0, 5000)}` : ''}
${matchingSkills?.length ? `\nMATCHING SKILLS TO EMPHASIZE: ${matchingSkills.join(', ')}` : ''}
${missingSkills?.length ? `\nGAP SKILLS TO ADDRESS WITH TRANSFERABLE EXPERIENCE: ${missingSkills.join(', ')}` : ''}

CANDIDATE'S RESUME:
${resumeText.slice(0, 15000)}

Provide enhancement suggestions. Remember: suggest how to IMPROVE wording, not what to remove.`;

    console.log("[TAILORED-RESUME] Generating tailored resume for:", jobTitle, "at", jobCompany);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_tailored_resume",
            description: "Submit the tailored resume content",
            parameters: {
              type: "object",
              properties: {
                professionalSummary: {
                  type: "string",
                  description: "A tailored 3-4 sentence professional summary for this specific role"
                },
                keySkills: {
                  type: "array",
                  items: { type: "string" },
                  description: "8-12 most relevant skills to highlight"
                },
                experienceHighlights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      original: { type: "string", description: "Original bullet point or context" },
                      tailored: { type: "string", description: "Rewritten version tailored to the role" }
                    },
                    required: ["tailored"]
                  },
                  description: "3-5 rewritten bullet points from their experience"
                },
                suggestedJobTitle: {
                  type: "string",
                  description: "The ideal title to put at the top of the resume"
                },
                coverLetterOpening: {
                  type: "string",
                  description: "A compelling opening paragraph for a cover letter"
                },
                applicationTips: {
                  type: "array",
                  items: { type: "string" },
                  description: "2-3 specific tips for applying to this role"
                }
              },
              required: ["professionalSummary", "keySkills", "experienceHighlights", "suggestedJobTitle", "coverLetterOpening", "applicationTips"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "submit_tailored_resume" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service credits depleted. Please try again later." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("[TAILORED-RESUME] AI API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to generate tailored resume" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    
    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "submit_tailored_resume") {
      console.error("[TAILORED-RESUME] Unexpected response format:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Invalid AI response format" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tailoredContent = JSON.parse(toolCall.function.arguments);
    
    console.log("[TAILORED-RESUME] Successfully generated tailored resume");

    return new Response(
      JSON.stringify({
        success: true,
        jobTitle,
        jobCompany,
        ...tailoredContent
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[TAILORED-RESUME] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
