// deploy-stamp: 2026-10-08T13:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/supabase-client.ts";
import { validateTailoredResume, type TailoredResumeShape } from "../_shared/resume-grounding.ts";
import { roleGuidance } from "../_shared/application-questions.ts";
import { APPLY_KIT_PRODUCT_TYPES } from "../_shared/apply-kit.ts";
import { assertPaidSession } from "../_shared/paid-session.ts";
import { callAIWithModelFallback } from "../_shared/ai-fallback.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { accountProStanding } from "../_shared/pro.ts";
import { REFUNDED_PURCHASE_MESSAGE, sessionWasRefunded } from "../_shared/payment-revocation.ts";
import { purchaseSpendGate, spendRefusal } from "../_shared/model-spend-gate.ts";
import { refundWriting, takeWriting, type WritingPass } from "../_shared/writing-allowance.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
// 2026-10-11.24 (wave 4 second round, generators): a Pro account's kit is
// one tailored résumé from its writing allowance (five a UTC day, sixty a UTC
// month; owner decision 2026-10-12), given back when no kit is delivered. A
// past Apply Assistant buyer keeps the purchase's own daily allowance.
// 2026-10-09.62 (wave-3 fix round integration): carries both 2026-10-09.5 and the payments-account group's 2026-10-09.61.
// 2026-10-11.1 (wave-4 integration): _shared/application-questions.ts, which
// this function imports for roleGuidance alone, gained w4/mcp's widened
// classifier; roleGuidance is unchanged, and the stamp moves so the deployed
// bundle and the repository's are the same code.
// 2026-10-11.2: the classifier it imports no longer exempts a second ask inside a work-done
// prompt, and knows when-could-you-start and current earnings (review of 9fe3bc0d).
// 2026-10-11.29 (wave 4 round 2 integration): generators' 2026-10-11.24 with
// agents-api's _shared/application-questions.ts (S12-081), which it imports.
const FN_BUILD = "generate-apply-package.2026-10-11.29";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': FN_BUILD,
};

// Per address per day, for purchase and unentitled callers. A Pro account
// is never counted here: its plan is unlimited kits, and with the day now
// lasting a day (20261009110000) this bucket capped Pro at 40.
const RATE_LIMIT = 40;
const RATE_WINDOW_MINUTES = 1440;
// Unlimited kits a day is not unlimited gemini-2.5-pro calls an hour: every
// signed-in account has its own hourly bucket, counted before its plan is
// read, and Pro accounts together share one hourly ceiling.
const KITS_PER_ACCOUNT_HOUR = 60;
const PRO_KITS_PER_HOUR = 600;
const HOUR_WINDOW_MINUTES = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A signed-in session's token, by its unverified claims: the publishable key is a JWT whose role is anon, and is never looked up. */
function signedInToken(authHeader: string): string | null {
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const parts = jwt.length <= 4096 ? jwt.split(".") : [];
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return claims?.role === "authenticated" && claims?.is_anonymous !== true ? jwt : null;
  } catch {
    return null;
  }
}
/** Kits one purchase (a checkout session or a Pro grant) may generate in a day. A Pro account's own plan is unlimited and not counted here. */
const KITS_PER_PURCHASE_DAY = 10;

// The platform's word for the caller's address, never the first forwarded
// hop, which a caller writes itself.
const getClientIp = (req: Request): string => clientAddressOr(req.headers);

// THE SHARED FALLBACK CHAIN, NOT A HAND-COPIED ONE (platform sweep L5-16).
// The copy that lived here returned only on success or a non-429/402 status
// under 500, so a 429 or a 402 was retried on every model (six calls) and then
// thrown, and the caller got a non-retryable 500 naming the model -- the
// "busy, try again" and "credits" answers below never ran. The shared chain
// advances past a 429 to the next model, returns the last 429 when every model
// is busy, and returns a 402 at once. Same models, same order as before.
const MODEL_FALLBACK_ORDER = [
  'google/gemini-2.5-pro',
  'openai/gpt-5',
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
    models: MODEL_FALLBACK_ORDER,
    context: `GENERATE-APPLY-PACKAGE ${context}`,
  });
}

/** An aborted or timed-out model call: the one failure a retry may fix. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || /abort|timed? ?out/i.test(error.message));

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  // A Pro account's use is given back whenever no kit is delivered.
  const holder: { pass: WritingPass | null } = { pass: null };
  const res = await handleKit(req, holder);
  if (res.status >= 400) await refundWriting(getServiceClient(), holder.pass);
  return res;
});

async function handleKit(req: Request, holder: { pass: WritingPass | null }): Promise<Response> {
  const clientIp = getClientIp(req);

  try {
    const supabase = getServiceClient();
    // A limiter that cannot answer is not a pass (sweep S8-063).
    if (!supabase) {
      return new Response(
        JSON.stringify({ error: 'Service temporarily unavailable. Please try again shortly.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // check_rate_limit's answer, or null for anything that is not one (a limiter that fails open is off).
    const counted = async (args: Record<string, string | number>): Promise<boolean | null> => {
      try {
        const { data, error } = await supabase.rpc('check_rate_limit', { ...args, p_function: 'generate-apply-package' });
        if (error) console.error("[GENERATE-APPLY-PACKAGE] Rate limit check error:", error);
        return error || typeof data !== "boolean" ? null : data;
      } catch (e) {
        console.error("[GENERATE-APPLY-PACKAGE] Rate limit check threw:", String(e).slice(0, 120));
        return null;
      }
    };
    // THE ONE RULE (L6-08, L6-29): the verified account's plan, both caches,
    // by its user id -- never its address. Batch prep is an ongoing feature
    // of the plan, so a trial unlocks it. Decided first, so a Pro account's
    // kits are never counted in the address's day; the account's own hour
    // is counted before the plan is read (review of S8-063).
    let proAccount = false;
    // Paid (not a trial): Pro's writing figures. A trial still unlocks the kit
    // (an ongoing feature) but counts on a free account's allowance (S12-098).
    let proPaid = false;
    let userId: string | null = null;
    const token = signedInToken(req.headers.get("Authorization") ?? "");
    if (token) {
      try {
        const authed = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user } } = await authed.auth.getUser();
        if (typeof user?.id === "string" && UUID_RE.test(user.id)) userId = user.id.toLowerCase();
      } catch (e) {
        console.warn("[GENERATE-APPLY-PACKAGE] account check failed:", String(e).slice(0, 120));
      }
      if (userId) {
        const mine = await counted({ p_ip: `user:${userId}`, p_max_requests: KITS_PER_ACCOUNT_HOUR, p_window_minutes: HOUR_WINDOW_MINUTES });
        if (mine === null) return spendRefusal("limiter_unavailable", null, corsHeaders);
        if (!mine) return spendRefusal("rate_limited_function", KITS_PER_ACCOUNT_HOUR, corsHeaders);
        try {
          const standing = await accountProStanding(supabase, userId);
          proAccount = standing.pro;
          proPaid = standing.consumables;
        } catch (e) {
          console.warn("[GENERATE-APPLY-PACKAGE] pro check failed:", String(e).slice(0, 120));
        }
      }
    }
    if (proAccount) {
      const all = await counted({ p_ip: "pro", p_max_requests: PRO_KITS_PER_HOUR, p_window_minutes: HOUR_WINDOW_MINUTES });
      if (all === null) return spendRefusal("limiter_unavailable", null, corsHeaders);
      if (!all) return spendRefusal("rate_limited_global", PRO_KITS_PER_HOUR, corsHeaders);
    } else {
      const allowed = await counted({ p_ip: clientIp, p_max_requests: RATE_LIMIT, p_window_minutes: RATE_WINDOW_MINUTES });
      if (allowed === null) {
        return new Response(
          JSON.stringify({ error: 'Service temporarily unavailable. Please try again shortly.' }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
    // Accepted credentials, in order:
    //   1. a paid Stripe checkout session (cs_...) whose product_type includes
    //      the kit -- read from Stripe itself, so it holds even after the
    //      thirty-day claim row is gone;
    //   2. a Pro grant session (pro_...) that verify-product-purchase consumed
    //      and claimed for a product that includes the kit -- the same claim
    //      row every other paid generator gates on (assertPaidSession);
    //   3. a Pro plan held by the caller's verified ACCOUNT (the one rule in
    //      _shared/pro-standing.ts).
    //
    // THE ALLOW-LIST USED TO BE WRITTEN IN THE FRONTEND'S SPELLING. It named
    // the camelCase product keys; Stripe metadata carries create-product-
    // checkout's snake_case product_type, so no session ever matched and every
    // Apply Assistant purchase was refused here -- from the success page, the
    // recovery form, the webhook, the verify fallback and the retry sweep
    // alike (the three server callers also sent no session at all). The list
    // now lives in _shared/apply-kit.ts, in the spelling Stripe carries, and a
    // guard checks it against what every checkout mints.
    let entitled = proAccount;
    let refunded = false;
    // Which credential opened the tool: a purchase is counted per day below.
    let entitledByPurchase = false;
    if (entitled) {
      // A Pro account: its plan opens the tool, whatever session it names.
    } else if (typeof sessionId === "string" && sessionId.startsWith("cs_")) {
      try {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const productType = String(session.metadata?.product_type ?? "");
          // 'paid', or a $0 session a 100%-off code completed (L6-10).
          entitled = checkoutSessionSettled(session) && APPLY_KIT_PRODUCT_TYPES.includes(productType);
          entitledByPurchase = entitled;
          if (!entitled) {
            console.warn(`[GENERATE-APPLY-PACKAGE] session ${sessionId} does not include the kit: ${session.payment_status} / ${productType || "no product"}`);
          }
          // Stripe still answers 'paid' for a refunded or disputed session
          // (L6-18); a plan on the account was read above.
          if (entitled && supabase && await sessionWasRefunded(supabase, sessionId)) {
            entitled = false;
            entitledByPurchase = false;
            refunded = true;
          }
        }
      } catch (e) {
        console.warn("[GENERATE-APPLY-PACKAGE] session check failed:", String(e).slice(0, 120));
      }
    } else if (typeof sessionId === "string" && sessionId.startsWith("pro_") && supabase) {
      // A Pro grant has no Stripe session to read. verify-product-purchase
      // consumes it and writes its claim with the grant's product before any
      // generation, so the claim row is the proof here, checked for a product
      // that includes the kit.
      const refusal = await assertPaidSession(supabase, sessionId, APPLY_KIT_PRODUCT_TYPES);
      entitled = refusal === null;
      entitledByPurchase = entitled;
      if (!entitled) console.warn(`[GENERATE-APPLY-PACKAGE] grant ${sessionId} refused: ${refusal}`);
    }
    if (!entitled && refunded) {
      return new Response(
        JSON.stringify({ error: REFUNDED_PURCHASE_MESSAGE, refunded: true, requiresPurchase: true }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!entitled) {
      return new Response(
        JSON.stringify({ error: "This is a paid tool. Unlock the Apply Assistant from the pricing page, or go Pro for unlimited application kits.", requiresPurchase: true }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // One purchase buys a day of kits, not unlimited gemini-2.5-pro runs from
    // a pool of addresses (sweep S8-063). A Pro account keeps its unlimited
    // day; its hour was counted above.
    if (entitledByPurchase) {
      const purchaseRefused = await purchaseSpendGate(supabase, 'generate-apply-package', sessionId, KITS_PER_PURCHASE_DAY, corsHeaders);
      if (purchaseRefused) return purchaseRefused;
    } else if (proAccount && userId) {
      // PRO'S KIT IS ONE TAILORED RÉSUMÉ FROM ITS WRITING ALLOWANCE (owner
      // decision 2026-10-12: five packages a UTC day, sixty a UTC month). The
      // co-pilot's letter is counted by generate-cover-letter.
      const taken = await takeWriting(supabase, userId, proPaid ? "pro" : "free", ["resume"], corsHeaders);
      if ("refused" in taken) return taken.refused;
      holder.pass = taken.pass;
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

## CONTACT LINE — COPY ONLY, NEVER ADD
- Every contact field (name, email, phone, location, LinkedIn, website) is copied exactly from the candidate's resume.
- A field the resume does not have is an EMPTY STRING. Never invent a phone number, LinkedIn URL, website or email, and never write "N/A", "Not provided" or a placeholder.

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
      // Contact values the résumé lacks, blanked (S11-017).
      removedContact: grounding.removedContact,
    };

    console.log("[GENERATE-APPLY-PACKAGE] Successfully generated package, model:", modelUsed);

    return new Response(
      JSON.stringify({ success: true, modelUsed, groundingReport, ...result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-APPLY-PACKAGE] Error:", errorMessage);

    // An aborted call reads "The signal has been aborted", which never
    // contained "timeout", so this retryable answer never fired (L5-16).
    if (isTimeout(error)) {
      return new Response(
        JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No internal message (a model name, a status) reaches the buyer.
    return new Response(
      JSON.stringify({ error: "Failed to generate application package. Please try again.", retryable: true }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
