// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkInputLimits } from "../_shared/input-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

// This endpoint is public (verify_jwt=false) and streams an expensive LLM call
// with no payment/JWT gate, so without a throttle anyone could burn AI credits
// (and pull premium content) in a loop. Per-IP rate limit as an abuse backstop,
// matching the pattern used across the other generators. NOTE: this caps burst
// abuse but does not verify the purchase — closing the revenue leak fully needs
// a session/entitlement check on the paid streaming path.
const RATE_LIMIT = { p_max_requests: 20, p_window_minutes: 60 };

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[PREMIUM-PACKAGE-STREAM] ${step}`, details ? JSON.stringify(details) : '');
};

// NOTE: Auto-fix and validation are applied client-side after streaming completes
// See src/lib/content-autofix.ts for the client-side implementation

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-premium-package-stream", p_ip: clientIp, ...RATE_LIMIT });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, language } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const limitError = checkInputLimits({ resumeText, jobDescription });
    if (limitError) return new Response(JSON.stringify({ error: limitError }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    logStep("Starting streaming premium package generation", { 
      jobTitle,
      jobCompany,
      resumeLength: resumeText?.length,
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an elite ATS resume optimization specialist and professional cover letter writer. Your task is to ENHANCE the provided resume while preserving 100% of the original content, then write a compelling cover letter. Respond in ${language || "the resume's"} language.

## ⚠️ CRITICAL DATA ACCURACY RULES - ABSOLUTE REQUIREMENTS ⚠️
These rules MUST be followed perfectly. Violations are unacceptable:

### NUMBERS & METRICS:
- COPY ALL NUMBERS EXACTLY, character-for-character (including punctuation)
- Preserve decimal points: "3.5x" must stay "3.5x" (never "35x")
- Preserve "x" multipliers: "1.5x" must stay "1.5x" (never "15x")
- Preserve years fully: "2024" must stay "2024" (never "202" or "202.")
- Dollar amounts: "$100M+" must stay "$100M+" (never "$M+")
- Prefix symbols must remain: "$150,000" must include "$"; ">50%" must include the number
- Proper spacing between words and numbers (e.g., "for 8" not "for8", "top 3" not "top3")

### COMPANY & PRODUCT NAMES:
- "GitHub" NOT "Git"
- "LinkedIn" NOT "Linked"
- "Fortune 500" NOT "Fortune"
- "GitHub Copilot" NOT "GitHub Cop" or "GitHub Cop (OpenAI)"
- "GitHub Actions" NOT "Git Actions"
- "Codespaces" NOT "Codes)"
- "LinkedIn Sales Navigator" NOT "Linked Sales Navigator"
- "CI/CD" NOT "/CD" or "including/CD"
- "Carnegie Mellon" NOT "Carnegie Mellonator"

### TEXT QUALITY:
- NEVER truncate words or drop letters/spaces
- NEVER introduce random commas/punctuation at the start of lines
- Section headers must be separated with clear newlines (no run-together headers)
- Every bullet point must be a complete, grammatical sentence fragment

### FACTS & CONTENT:
- DO NOT invent new achievements, numbers, tools, locations, titles, or claims
- Only enhance wording and add ATS-friendly keywords that fit the existing facts

### CONTACT LINE — COPY ONLY, NEVER ADD:
- The contact header may contain ONLY items present in the original resume
- NEVER invent or add a LinkedIn URL, portfolio, website, phone, or email that isn't in the original
- If the original has no LinkedIn, the rewrite has no LinkedIn — same for every contact field

### NO PLACEHOLDERS — SEND-READY:
- NEVER output bracketed fill-ins like [Hiring Manager Name], [Company Name], or [mention a specific...] anywhere in the resume or the letter
- Hiring manager unknown → "Dear Hiring Manager,". Company unknown → write about "your team" and the role's challenges; never gesture at facts you don't have

## OUTPUT FORMAT
You will output content in TWO sections, clearly marked:

===RESUME_START===
[Write the complete enhanced resume here]
===RESUME_END===

===COVER_LETTER_START===
[Write a compelling, professional cover letter (300-400 words)]
===COVER_LETTER_END===

## RESUME RULES:
- Include EVERY job, education, project from the original
- Output must be AS LONG OR LONGER than input
- PRESERVE ALL original data exactly - numbers, names, titles

## COVER LETTER RULES - CRITICAL:
- Write COMPLETE, COHERENT sentences with proper grammar
- Use SPECIFIC details from the resume (real titles, real companies, real achievements)
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

    // Stream the response directly to the client (SSE). IMPORTANT: buffer line-by-line to avoid token loss.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let textBuffer = "";

        const enqueueEvent = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        const processLine = (rawLine: string) => {
          let line = rawLine;
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") return;
          if (!line.startsWith("data: ")) return;

          const data = line.slice(6).trim();
          if (!data) return;

          if (data === "[DONE]") {
            enqueueEvent({ type: "done" });
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) enqueueEvent({ type: "content", content });
          } catch {
            // Likely partial JSON (split across chunks). Put it back and wait for more data.
            textBuffer = rawLine + "\n" + textBuffer;
          }
        };

        try {
          enqueueEvent({ type: "start", message: "Generation started" });

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            textBuffer += decoder.decode(value, { stream: true });

            let newlineIndex: number;
            while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
              const line = textBuffer.slice(0, newlineIndex);
              textBuffer = textBuffer.slice(newlineIndex + 1);
              processLine(line);
            }
          }

          // Flush any remaining buffered line
          if (textBuffer.trim()) {
            for (const line of textBuffer.split("\n")) processLine(line);
          }

          enqueueEvent({ type: "complete" });
        } catch (error) {
          logStep("Stream error", { error: String(error) });
          enqueueEvent({ type: "error", message: String(error) });
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
