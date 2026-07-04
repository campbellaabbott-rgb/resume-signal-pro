// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceClient } from "../_shared/supabase-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT = 15; // per IP per day — this is an AI call, same order as other generation endpoints
const RATE_WINDOW_MINUTES = 1440;

const getClientIp = (req: Request): string =>
  req.headers.get('cf-connecting-ip') ||
  req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  req.headers.get('x-real-ip') ||
  'unknown';

const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;

const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',
  'google/gemini-2.5-pro',
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

        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, ...options }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok || (response.status !== 429 && response.status !== 402 && response.status < 500)) {
          return { response, modelUsed: model };
        }

        lastError = new Error(`${context} failed with status ${response.status} on model ${model}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[PARSE-RESUME-STRUCTURED] ${context} error on model ${model}, attempt ${attempt}:`, lastError.message);
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError || new Error('All AI models failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = getClientIp(req);

  try {
    const supabase = getServiceClient();
    if (supabase) {
      const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
        p_ip: clientIp,
        p_function: 'parse-resume-structured',
        p_max_requests: RATE_LIMIT,
        p_window_minutes: RATE_WINDOW_MINUTES
      });

      if (rlError) {
        console.error("[PARSE-RESUME-STRUCTURED] Rate limit check error:", rlError);
      } else if (!allowed) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { resumeText } = await req.json();

    if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required (at least 50 characters)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[PARSE-RESUME-STRUCTURED] LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You extract a resume's existing content into structured sections for an editable resume builder. This is EXTRACTION, not rewriting — preserve the candidate's actual wording, dates, and details as closely as possible. Do not invent, embellish, or omit content. If a field genuinely isn't present in the resume, return an empty string for it rather than guessing.`;

    const userPrompt = `Extract the following resume into structured sections:\n\n${resumeText.slice(0, 20000)}`;

    console.log("[PARSE-RESUME-STRUCTURED] Parsing resume, length:", resumeText.length);

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
            name: "submit_structured_resume",
            description: "Submit the resume broken into structured sections",
            parameters: {
              type: "object",
              properties: {
                contact: {
                  type: "object",
                  properties: {
                    fullName: { type: "string" },
                    title: { type: "string", description: "Current or most recent job title / headline" },
                    email: { type: "string" },
                    phone: { type: "string" },
                    location: { type: "string" },
                    linkedIn: { type: "string" },
                    website: { type: "string" }
                  },
                  required: ["fullName", "title", "email", "phone", "location", "linkedIn", "website"]
                },
                summary: { type: "string", description: "Professional summary / objective, verbatim if present, empty string if absent" },
                experience: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      company: { type: "string" },
                      title: { type: "string" },
                      location: { type: "string" },
                      startDate: { type: "string", description: "e.g. 'Jan 2020'" },
                      endDate: { type: "string", description: "e.g. 'Present' or 'Mar 2023'" },
                      bullets: { type: "array", items: { type: "string" } }
                    },
                    required: ["company", "title", "location", "startDate", "endDate", "bullets"]
                  }
                },
                education: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      school: { type: "string" },
                      degree: { type: "string" },
                      field: { type: "string" },
                      startDate: { type: "string" },
                      endDate: { type: "string" },
                      details: { type: "string" }
                    },
                    required: ["school", "degree", "field", "startDate", "endDate", "details"]
                  }
                },
                skills: { type: "array", items: { type: "string" } },
                certifications: { type: "array", items: { type: "string" } }
              },
              required: ["contact", "summary", "experience", "education", "skills", "certifications"]
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "submit_structured_resume" } }
      },
      'Resume structure extraction'
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
      console.error("[PARSE-RESUME-STRUCTURED] AI API error:", response.status, errorText, "model:", modelUsed);
      return new Response(
        JSON.stringify({ error: "Failed to parse resume" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "submit_structured_resume") {
      console.error("[PARSE-RESUME-STRUCTURED] Unexpected response format:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Invalid AI response format" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const structured = JSON.parse(toolCall.function.arguments);

    console.log("[PARSE-RESUME-STRUCTURED] Successfully parsed resume, model:", modelUsed);

    return new Response(
      JSON.stringify({ success: true, modelUsed, ...structured }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PARSE-RESUME-STRUCTURED] Error:", errorMessage);

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
