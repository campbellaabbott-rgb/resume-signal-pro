// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkInputLimits } from "../_shared/input-limits.ts";
import { assertPaidSession } from "../_shared/paid-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[COVER-LETTER-STREAM] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Public (verify_jwt=false) LLM endpoint — per-IP rate limit so it can't be
  // looped to burn AI credits. Mirrors the throttle on the other generators.
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-cover-letter-stream", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, tone = "professional", language, sessionId } = await req.json();

    const limitError = checkInputLimits({ resumeText, jobDescription });
    if (limitError) return new Response(JSON.stringify({ error: limitError }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Paid content: confirm the caller actually purchased (see paid-session.ts).
    const paidError = await assertPaidSession(supabase, sessionId);
    if (paidError) return new Response(JSON.stringify({ error: paidError, retryable: true }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting streaming cover letter generation", { jobTitle, jobCompany, tone });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const toneDescriptions: Record<string, string> = {
      professional: "formal, polished, and business-appropriate",
      enthusiastic: "energetic, passionate, and eager while remaining professional",
      confident: "assertive, accomplished, and self-assured without being arrogant",
      conversational: "friendly, approachable, and personable while staying professional"
    };

    const toneDesc = toneDescriptions[tone] || toneDescriptions.professional;

    const systemPrompt = `You are a senior executive recruiter who writes cover letters that sound authentically human. Respond in ${language || "the resume's"} language.

Write a cover letter that is ${toneDesc}.

STRUCTURE (300-400 words):
1. Opening Hook (2-3 sentences): Start with something specific. NEVER start with "I am writing to apply" or "I was excited to see"
2. Body 1 (4-5 sentences): Connect 2-3 specific experiences to the role with concrete metrics
3. Body 2 (3-4 sentences): Why THIS company and role specifically
4. Close (2-3 sentences): Confident, not desperate

RULES:
- Sound like a real person, not AI
- Use contractions naturally
- Vary sentence length
- Include specific numbers from the resume
- AVOID: synergy, leverage, passionate, excited, dynamic

NO PLACEHOLDERS — SEND-READY:
- NEVER output bracketed fill-ins like [Hiring Manager Name], [Company Name], or [mention a specific...]. The reader must be able to send this without editing a single bracket.
- Hiring manager unknown → "Dear Hiring Manager,". Company unknown → write about "your team" and the role's challenges from the job description; never gesture at facts you don't have.

GROUNDING — ONLY THE CANDIDATE'S REAL FACTS:
- Every metric, outcome, and claim about the candidate must appear in their resume. Never invent outcomes the resume doesn't state. Connect and frame real facts; never extend them.
- Never invent contact details (LinkedIn, phone, email) anywhere in the letter.`;

    const userPrompt = `Write a compelling cover letter.

RESUME:
${resumeText}

TARGET ROLE: ${jobTitle || 'Not specified'}
COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}` : ''}

Write the cover letter directly - no JSON formatting needed. Just the letter text.`;

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
        max_completion_tokens: 2000,
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
    console.error("[COVER-LETTER-STREAM] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to generate cover letter", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
