// deploy-stamp: 2026-10-05T11:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { modelSpendGate } from "../_shared/model-spend-gate.ts";
import { callAIWithModelFallback } from "../_shared/ai-fallback.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "parse-resume-structured.2026-10-05.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': FN_BUILD,
};

// Fifteen a day per address (this is an AI call, same order as the other
// generation endpoints), plus a function-wide hourly ceiling. The limiter
// used to log a counting error and carry on, and ran nothing at all without a
// database client; the shared gate fails closed in both cases.
const PARSE_LIMITS = { perAddress: 15, windowMinutes: 1440, globalPerHour: 150 };

// The output cap. Extraction re-emits the résumé as sections (a 20,000
// character résumé is ~5,000 tokens); the rest is headroom for the reasoning
// gpt-5 spends against the same cap. Unset, a model could run to its own
// ceiling on the project's key.
const MAX_OUTPUT_TOKENS = 16000;

// THE SHARED FALLBACK CHAIN, NOT A HAND-COPIED ONE (platform sweep L5-16).
// The copy that lived here retried a 429 or a 402 on every model (six calls)
// and then threw, so the 429/402 answers below never ran and the caller got a
// 500 naming the model. The shared chain advances past a 429, returns the last
// one when every model is busy, and returns a 402 at once. Same models, same
// order, same output cap (named per provider by the shared chain).
const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'openai/gpt-5-mini',
];

interface AIRequestOptions {
  messages: Array<{ role: string; content: string }>;
  tools?: unknown[];
  tool_choice?: unknown;
}

function callAIWithFallback(
  apiKey: string,
  options: AIRequestOptions,
  context: string = 'AI call'
): Promise<{ response: Response; modelUsed: string }> {
  return callAIWithModelFallback(apiKey, {
    messages: options.messages,
    tools: options.tools,
    toolChoice: options.tool_choice,
    maxTokens: MAX_OUTPUT_TOKENS,
    models: MODEL_FALLBACK_ORDER,
    context: `PARSE-RESUME-STRUCTURED ${context}`,
  });
}

/** An aborted or timed-out model call: the one failure a retry may fix. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || /abort|timed? ?out/i.test(error.message));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText } = await req.json();

    if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required (at least 50 characters)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const refused = await modelSpendGate(getServiceClient(), req, "parse-resume-structured", PARSE_LIMITS, corsHeaders);
    if (refused) return refused;

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

    let structured;
    try {
      structured = JSON.parse(toolCall.function.arguments);
    } catch (parseError) {
      // A response cut off at the output cap is malformed JSON: a retry may
      // well succeed, so say so rather than throwing to a bare 500.
      console.error("[PARSE-RESUME-STRUCTURED] tool-call JSON parse failed:", String(parseError).slice(0, 120));
      return new Response(
        JSON.stringify({ error: "The parser returned a malformed draft. Please try again.", retryable: true }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[PARSE-RESUME-STRUCTURED] Successfully parsed resume, model:", modelUsed);

    return new Response(
      JSON.stringify({ success: true, modelUsed, ...structured }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PARSE-RESUME-STRUCTURED] Error:", errorMessage);

    // An aborted call reads "The signal has been aborted", which never
    // contained "timeout", so this retryable answer never fired (L5-16).
    if (isTimeout(error)) {
      return new Response(
        JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No internal message (a model name, a status) reaches the visitor.
    return new Response(
      JSON.stringify({ error: "Failed to parse resume. Please try again.", retryable: true }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
