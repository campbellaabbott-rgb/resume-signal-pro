// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry and fallback configuration
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;

// Model fallback order
const MODEL_FALLBACK_ORDER = [
  'google/gemini-2.5-pro',
  'openai/gpt-5',
  'openai/gpt-5-mini',
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AIRequestOptions {
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  tool_choice?: unknown;
}

async function callAIWithFallback(
  apiKey: string,
  options: AIRequestOptions,
  context: string = 'AI call'
): Promise<{ response: Response; modelUsed: string }> {
  let lastError: Error | null = null;
  
  for (const model of MODEL_FALLBACK_ORDER) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        
        console.log(`[TAILORED-RESUME] ${context} - trying ${model}, attempt ${attempt + 1}`);
        
        const requestBody: Record<string, unknown> = {
          model,
          messages: options.messages,
        };
        if (options.tools) requestBody.tools = options.tools;
        if (options.tool_choice) requestBody.tool_choice = options.tool_choice;
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log(`[TAILORED-RESUME] ${context} - succeeded with ${model}`);
          return { response, modelUsed: model };
        }
        
        if (response.status === 429 || response.status === 402) {
          return { response, modelUsed: model };
        }
        
        if (response.status >= 400 && response.status < 500) {
          console.log(`[TAILORED-RESUME] ${context} - client error ${response.status}, trying next model`);
          break;
        }
        
        if (response.status >= 500) {
          console.log(`[TAILORED-RESUME] ${context} - server error ${response.status}`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[TAILORED-RESUME] ${context} - error with ${model}: ${errorMessage}`);
        lastError = error instanceof Error ? error : new Error(errorMessage);
        
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
    console.log(`[TAILORED-RESUME] ${context} - ${model} failed, trying next model`);
  }
  
  throw lastError || new Error('All AI models failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const [{ data: allowed }, body] = await Promise.all([
    supabase.rpc("check_rate_limit", { p_function: "generate-tailored-resume", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 }),
    req.json()
  ]);
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const { resumeText, jobTitle, jobCompany, jobDescription, matchingSkills, missingSkills, personalizationContext } = body;

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
1. Extract the 8-12 most important keywords from the job description (required skills, tools, verbs, domain terms)
2. Provide a new professional summary that naturally uses the top JD keywords
3. Identify which of their existing skills to emphasize FIRST (but keep all)
4. Rewrite 5-7 existing bullet points to inject missing JD keywords naturally — ALWAYS preserve the original bullet verbatim alongside the rewrite
5. For each rewritten bullet, list exactly which keywords you injected
6. Estimate the match score improvement (0-40 point delta) based on keywords added
7. List any required JD keywords still not covered after tailoring
8. Provide strategic application tips

### KEYWORD INJECTION RULES:
- Inject keywords naturally — do not keyword-stuff
- Preserve the original achievement/metric — only reframe the language
- Each tailored bullet MUST be copy-paste ready

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

    const { response, modelUsed } = await callAIWithFallback(
      LOVABLE_API_KEY,
      {
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
                      original: { type: "string", description: "The original bullet point verbatim from the resume" },
                      tailored: { type: "string", description: "Rewritten version with JD keywords injected naturally — copy-paste ready" },
                      keywordsInjected: { type: "array", items: { type: "string" }, description: "Exact keywords from the JD that were added to this bullet" }
                    },
                    required: ["original", "tailored", "keywordsInjected"]
                  },
                  description: "5-7 rewritten bullet points — always include the original verbatim"
                },
                keywordsRequired: {
                  type: "array",
                  items: { type: "string" },
                  description: "Top 8-12 keywords extracted from the job description"
                },
                keywordGaps: {
                  type: "array",
                  items: { type: "string" },
                  description: "Required JD keywords still not covered after tailoring (max 5)"
                },
                matchScoreDelta: {
                  type: "number",
                  description: "Estimated ATS keyword match improvement in percentage points (0-40)"
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
              required: ["professionalSummary", "keySkills", "experienceHighlights", "keywordsRequired", "keywordGaps", "matchScoreDelta", "suggestedJobTitle", "coverLetterOpening", "applicationTips"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "submit_tailored_resume" } }
      },
      'Tailored resume generation'
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service credits depleted. Please try again later.", retryable: false }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("[TAILORED-RESUME] AI API error:", response.status, errorText, "model:", modelUsed);
      return new Response(
        JSON.stringify({ error: "Failed to generate tailored resume" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[TAILORED-RESUME] AI call succeeded with model:", modelUsed);

    const data = await response.json();
    
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "submit_tailored_resume") {
      console.error("[TAILORED-RESUME] Unexpected response format:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Invalid AI response format" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tailoredContent = JSON.parse(toolCall.function.arguments);
    
    console.log("[TAILORED-RESUME] Successfully generated tailored resume");

    return new Response(
      JSON.stringify({
        success: true,
        jobTitle,
        jobCompany,
        modelUsed,
        ...tailoredContent
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TAILORED-RESUME] Error:", errorMessage);
    
    if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
