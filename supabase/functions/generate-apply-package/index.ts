// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { validateTailoredResume, type TailoredResumeShape } from "../_shared/resume-grounding.ts";
import { roleGuidance } from "../_shared/application-questions.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RATE_LIMIT = 40; // per IP per day — raised from 15 so the account batch-prep co-pilot has real room (entitlement-gated, so only paying users reach this counter)
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
        console.error(`[GENERATE-APPLY-PACKAGE] ${context} error on model ${model}, attempt ${attempt}:`, lastError.message);
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
        p_function: 'generate-apply-package',
        p_max_requests: RATE_LIMIT,
        p_window_minutes: RATE_WINDOW_MINUTES
      });

      if (rlError) {
        console.error("[GENERATE-APPLY-PACKAGE] Rate limit check error:", rlError);
      } else if (!allowed) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Deliberately NOT applying the site's UI language here, unlike the other
    // generate-* functions — this product's output is the candidate's actual
    // job application material (a tailored resume + cover letter to submit to
    // an employer), not advisory content for the candidate to read. Forcing
    // it into the UI's language regardless of what language the candidate is
    // actually applying in could quietly damage their real application. The
    // AI naturally preserves the input resume's own language by default,
    // which is the safer behavior here.
    const { resumeText, jobPostingText, jobTitle, jobCompany, sessionId, jobCategory, experienceBand } = await req.json();

    if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required (at least 50 characters)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!jobPostingText || typeof jobPostingText !== 'string' || jobPostingText.trim().length < 30) {
      return new Response(
        JSON.stringify({ error: 'Job posting text is required (at least 30 characters) — paste the full job description' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Entitlement gate (this is a PAID deliverable) ──────────────────────
    // Accepted credentials: a paid Stripe checkout session for a product that
    // includes the apply package, OR an active Pro subscription (JWT). The
    // generator was previously reachable with just the anon key.
    let entitled = false;
    if (typeof sessionId === "string" && sessionId.startsWith("cs_")) {
      try {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const productType = String(session.metadata?.product_type ?? "");
          entitled = session.payment_status === "paid" && ["applyAssistant", "premiumPackage", "transitionPro"].includes(productType);
        }
      } catch (e) {
        console.warn("[GENERATE-APPLY-PACKAGE] session check failed:", String(e).slice(0, 120));
      }
    }
    if (!entitled) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (authHeader.startsWith("Bearer ")) {
        try {
          const authed = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
            global: { headers: { Authorization: authHeader } },
          });
          const { data: { user } } = await authed.auth.getUser();
          const admin = user?.email ? getServiceClient() : null;
          if (user?.email && admin) {
            const { data: sub } = await admin
              .from("pro_subscribers")
              .select("status, current_period_end")
              .eq("email", user.email)
              .maybeSingle();
            entitled = sub?.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
          }
        } catch (e) {
          console.warn("[GENERATE-APPLY-PACKAGE] pro check failed:", String(e).slice(0, 120));
        }
      }
    }
    if (!entitled) {
      return new Response(
        JSON.stringify({ error: "This is a paid tool. Unlock the Apply Assistant from the pricing page, or go Pro for unlimited application kits.", requiresPurchase: true }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[GENERATE-APPLY-PACKAGE] LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert resume strategist preparing a complete, ready-to-review job application package. This tool explicitly does NOT submit anything on the candidate's behalf — a human reviews and submits everything themselves. Your job is to do the preparation work so they don't have to start from scratch.

## CONTENT RULES
- This is a TAILORING task. Use the candidate's REAL experience from their resume — never invent companies, titles, dates, or accomplishments that aren't grounded in what they actually provided.
- Rewrite bullets/summary to emphasize what's most relevant to THIS specific job, using language and keywords from the job posting where the candidate's actual experience genuinely supports it.
- If the candidate is missing a skill the job requires, do not fabricate it — note it as a gap instead.
- Extract job metadata (company, role title) directly from the job posting text. If the posting describes how to apply (a portal, an email, a specific instruction), summarize it in applyMethodHint; if it doesn't say, leave applyMethodHint as an empty string rather than guessing.
${roleGuidance(typeof jobCategory === "string" ? jobCategory : null, typeof experienceBand === "string" ? experienceBand : null)}

## OUTPUT FORMAT (JSON)
Return a structured resume (contact, summary, experience[], education[], skills[], certifications[]) tailored for this job, plus job metadata and a human-action checklist.`;

    const userPrompt = `JOB POSTING:
${jobPostingText.slice(0, 15000)}

${jobTitle ? `Stated job title: ${jobTitle}` : ''}
${jobCompany ? `Stated company: ${jobCompany}` : ''}

CANDIDATE'S CURRENT RESUME:
${resumeText.slice(0, 20000)}

Prepare the tailored application package.`;

    console.log("[GENERATE-APPLY-PACKAGE] Generating for IP:", clientIp);

    const applyPackageTool = [{
          type: "function",
          function: {
            name: "submit_apply_package",
            description: "Submit the tailored application package",
            parameters: {
              type: "object",
              properties: {
                jobMetadata: {
                  type: "object",
                  properties: {
                    company: { type: "string" },
                    roleTitle: { type: "string" },
                    applyMethodHint: { type: "string", description: "How the posting says to apply, or empty string if not stated" }
                  },
                  required: ["company", "roleTitle", "applyMethodHint"]
                },
                tailoredResume: {
                  type: "object",
                  properties: {
                    contact: {
                      type: "object",
                      properties: {
                        fullName: { type: "string" },
                        title: { type: "string" },
                        email: { type: "string" },
                        phone: { type: "string" },
                        location: { type: "string" },
                        linkedIn: { type: "string" },
                        website: { type: "string" }
                      },
                      required: ["fullName", "title", "email", "phone", "location", "linkedIn", "website"]
                    },
                    summary: { type: "string", description: "Rewritten 2-4 sentence summary tailored to this job" },
                    experience: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          company: { type: "string" },
                          title: { type: "string" },
                          location: { type: "string" },
                          startDate: { type: "string" },
                          endDate: { type: "string" },
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
                },
                skillGaps: {
                  type: "array",
                  items: { type: "string" },
                  description: "Skills the job wants that the candidate's resume doesn't genuinely support — do not fabricate these into the resume"
                },
                checklist: {
                  type: "array",
                  items: { type: "string" },
                  description: "4-6 concrete next steps for the human to take, including reviewing the tailored resume, attaching a cover letter, and submitting it themselves on the employer's site — never implies automatic submission"
                }
              },
              required: ["jobMetadata", "tailoredResume", "skillGaps", "checklist"]
            }
          }
        }];
    const applyToolChoice = { type: "function", function: { name: "submit_apply_package" } };

    const { response, modelUsed } = await callAIWithFallback(
      LOVABLE_API_KEY,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: applyPackageTool,
        tool_choice: applyToolChoice

      },
      'Apply package generation'
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
      console.error("[GENERATE-APPLY-PACKAGE] AI API error:", response.status, errorText, "model:", modelUsed);
      return new Response(
        JSON.stringify({ error: "Failed to generate application package" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== "submit_apply_package") {
      console.error("[GENERATE-APPLY-PACKAGE] Unexpected response format:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "Invalid AI response format" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Tool-call arguments are usually valid JSON, but a response truncated at
    // max_tokens (or a model hiccup) yields malformed JSON. Unguarded, that
    // threw to the outer catch as a generic 500 — and skipped the grounding
    // retry below. Return the same retryable shape the grounding refusal uses,
    // so the UI (and the batch co-pilot) handle it gracefully with "try again".
    let result;
    try {
      result = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.warn("[GENERATE-APPLY-PACKAGE] tool-call JSON parse failed:", String(e).slice(0, 120));
      return new Response(
        JSON.stringify({ error: "The generator returned a malformed draft. Try again — regeneration is free.", retryable: true }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── Grounding check: verify, don't trust ────────────────────────────────
    let grounding = validateTailoredResume(resumeText, result.tailoredResume as TailoredResumeShape);
    if (!grounding.ok) {
      console.warn("[GENERATE-APPLY-PACKAGE] grounding rejected draft:", grounding.issues.slice(0, 6));
      try {
        const { response: r2 } = await callAIWithFallback(
          LOVABLE_API_KEY,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
              { role: "user", content: `Your previous draft was REJECTED by an automated fact check for inventing details:\n- ${grounding.issues.slice(0, 8).join("\n- ")}\n\nRegenerate the package using ONLY employers, job titles, schools, dates and credentials that literally appear in the candidate's resume above. Rephrasing bullets is fine; new facts are not.` },
            ],
            tools: applyPackageTool,
            tool_choice: applyToolChoice,
          },
          'Apply package regeneration'
        );
        if (r2.ok) {
          const d2 = await r2.json();
          const tc2 = d2.choices?.[0]?.message?.tool_calls?.[0];
          if (tc2?.function?.arguments) {
            const res2 = JSON.parse(tc2.function.arguments);
            const g2 = validateTailoredResume(resumeText, res2.tailoredResume as TailoredResumeShape);
            if (g2.ok) {
              result = res2;
              grounding = g2;
            }
          }
        }
      } catch (e) {
        console.warn("[GENERATE-APPLY-PACKAGE] regeneration attempt failed:", String(e).slice(0, 120));
      }
    }
    if (!grounding.ok) {
      // Refusing to ship fabrication IS the product promise.
      return new Response(
        JSON.stringify({ error: "Generation kept inventing details that aren't on your resume, so we refused to deliver it. Try again — regeneration is free.", retryable: true, groundingIssues: grounding.issues.slice(0, 5) }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    result.tailoredResume = grounding.cleaned;
    const groundingReport = {
      verified: true,
      removedSkills: grounding.removedSkills,
      removedCertifications: grounding.removedCertifications,
    };

    console.log("[GENERATE-APPLY-PACKAGE] Successfully generated package, model:", modelUsed);

    return new Response(
      JSON.stringify({ success: true, modelUsed, groundingReport, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-APPLY-PACKAGE] Error:", errorMessage);

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
