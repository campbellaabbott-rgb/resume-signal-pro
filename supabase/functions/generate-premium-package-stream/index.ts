import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[PREMIUM-PACKAGE-STREAM] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting streaming premium package generation", { 
      jobTitle,
      jobCompany,
      resumeLength: resumeText?.length,
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an elite ATS resume optimization specialist and professional cover letter writer. Your task is to ENHANCE the provided resume while preserving 100% of the original content, then write a compelling cover letter.

## OUTPUT FORMAT
You will output content in TWO sections, clearly marked:

===RESUME_START===
[Write the complete enhanced resume here - include ALL original content, enhanced with better wording, keywords, and quantified achievements]
===RESUME_END===

===COVER_LETTER_START===
[Write a compelling, professional cover letter (300-400 words)]
===COVER_LETTER_END===

## RESUME RULES:
- Include EVERY job, education, project from the original
- Enhance wording, add keywords, quantify achievements
- Add a professional summary if missing
- Output must be AS LONG OR LONGER than input

## COVER LETTER RULES - CRITICAL:
- Write COMPLETE, COHERENT sentences with proper grammar
- NEVER use placeholder text, variables, or incomplete phrases
- NEVER write things like "building -1" or "1-N" or mathematical notation
- Spell out all company names correctly (e.g., "Carnegie Mellon" not "Carnegie Mellonator")
- Use SPECIFIC details from the resume - real job titles, real company names, real achievements
- Every sentence must be grammatically complete and make logical sense
- Sound like a real human professional, not AI
- Open with a specific hook that mentions the target role or company
- Reference 2-3 specific accomplishments from the resume with context
- Show genuine enthusiasm without being over-the-top
- Close with a confident call to action
- Vary sentence structure and length for natural flow
- Proofread: no missing words, no garbled text, no incomplete thoughts`;


    const userPrompt = `ENHANCE this resume for the target position and write a matching cover letter.

ORIGINAL RESUME:
${resumeText}

TARGET JOB TITLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}` : ''}

Provide the enhanced resume first, then the cover letter. Use the exact markers (===RESUME_START===, etc.) so the output can be parsed.`;

    logStep("Starting streaming API call");

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
        max_completion_tokens: 12000,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText });
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy. Please try again.", retryable: true }),
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

    logStep("Streaming response back to client");

    // Stream the response directly to the client
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
          // Send initial event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "start", message: "Generation started" })}\n\n`));

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
                  // Ignore parse errors for partial chunks
                }
              }
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "complete" })}\n\n`));
        } catch (error) {
          logStep("Stream error", { error: String(error) });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: corsHeaders });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PREMIUM-PACKAGE-STREAM] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to generate premium package", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
