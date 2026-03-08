import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[TAILORED-RESUME-STREAM] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobTitle, jobCompany, jobDescription, matchingSkills, missingSkills, language } = await req.json();

    if (!resumeText || !jobTitle) {
      return new Response(
        JSON.stringify({ error: "Resume text and job title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting streaming tailored resume generation", { jobTitle, jobCompany });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an expert resume strategist who helps candidates tailor their EXISTING experience for specific roles. You NEVER remove content - you enhance and reframe it. Respond in ${language || "the resume's"} language.

Provide suggestions in this format:

===PROFESSIONAL_SUMMARY===
[Write a tailored 3-4 sentence professional summary for this specific role]

===KEY_SKILLS===
[List 8-12 most relevant skills to highlight, one per line]

===EXPERIENCE_ENHANCEMENTS===
[For 3-5 bullet points from their experience, show:
ORIGINAL: [original wording if applicable]
TAILORED: [enhanced version tailored to the role]
---
]

===APPLICATION_TIPS===
[2-3 specific tips for applying to this role]

Remember: This is about TAILORING existing content, not rewriting or removing anything.`;

    const userPrompt = `Provide tailoring suggestions for this resume targeting this position:

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${jobCompany || 'Not specified'}
${jobDescription ? `- Job Description:\n${jobDescription.slice(0, 5000)}` : ''}
${matchingSkills?.length ? `\nMATCHING SKILLS: ${matchingSkills.join(', ')}` : ''}
${missingSkills?.length ? `\nGAP SKILLS TO ADDRESS: ${missingSkills.join(', ')}` : ''}

CANDIDATE'S RESUME:
${resumeText.slice(0, 15000)}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_completion_tokens: 6000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText });
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy.", retryable: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service credits depleted.", retryable: false }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "start" })}\n\n`));

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
                  continue;
                }
                
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "content", content })}\n\n`));
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "complete" })}\n\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TAILORED-RESUME-STREAM] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
