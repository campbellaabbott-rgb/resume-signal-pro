// deploy-stamp: 2026-10-05T11:00Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { buildLanguageInstruction } from "../_shared/language-instruction.ts";
import { assertPaidSession } from "../_shared/paid-session.ts";
import { checkoutSessionSettled } from "../_shared/pass-settlement.ts";
import { clientAddressOr } from "../_shared/client-address.ts";
import { REFUNDED_PURCHASE_MESSAGE, sessionWasRefunded } from "../_shared/payment-revocation.ts";

// Provable from outside without a purchase: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "generate-ats-defense.2026-10-08.1";

// The product_type create-product-checkout writes for this product; the
// session's metadata must carry it, and the claim records it.
const ATS_DEFENSE_PRODUCT_TYPE = 'ats_defense';
// What a Pro grant's claim must name to be accepted here.
const ATS_DEFENSE_PRODUCT_TYPES = ['ats_defense'];
const ATS_DEFENSE_PRODUCT_NAME = 'ATS Defense Complete';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'x-fn-build': FN_BUILD,
};

const MAX_RESUME_LENGTH = 50000;
const ATS_DEFENSE_PRICE_ID = "price_1Sgv3LHBplUUV1CgpCF5pDLO";

const ERROR_MESSAGES = {
  INTERNAL: 'An error occurred while processing your request. Please try again.',
  INVALID_INPUT: 'Invalid input provided.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
  PAYMENT_REQUIRED: 'Payment verification required.',
  SESSION_USED: 'This session has already been used.',
};

// The platform's word for the caller's address (cf-connecting-ip, else the
// last forwarded hop), never the first hop, which a caller writes itself.
const getClientIp = (req: Request): string => clientAddressOr(req.headers);

const escapeXml = (str: string): string => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// Tool definition for structured ATS Defense output
const getATSDefenseTools = () => [{
  type: "function",
  function: {
    name: "submit_ats_defense_report",
    description: "Submit the complete ATS Defense analysis and optimization report",
    parameters: {
      type: "object",
      properties: {
        beforeScore: {
          type: "object",
          properties: {
            overall: { type: "number", description: "Overall ATS compatibility score 0-100 BEFORE optimization" },
            breakdown: {
              type: "object",
              properties: {
                keywordDensity: { type: "number", description: "Keyword density score 0-25" },
                formatCompliance: { type: "number", description: "Format compliance score 0-25" },
                sectionStructure: { type: "number", description: "Section structure score 0-25" },
                parseability: { type: "number", description: "ATS parseability score 0-25" }
              },
              required: ["keywordDensity", "formatCompliance", "sectionStructure", "parseability"]
            }
          },
          required: ["overall", "breakdown"]
        },
        afterScore: {
          type: "object",
          properties: {
            overall: { type: "number", description: "Projected ATS compatibility score 0-100 AFTER applying all fixes" },
            breakdown: {
              type: "object",
              properties: {
                keywordDensity: { type: "number", description: "Projected keyword density score 0-25" },
                formatCompliance: { type: "number", description: "Projected format compliance score 0-25" },
                sectionStructure: { type: "number", description: "Projected section structure score 0-25" },
                parseability: { type: "number", description: "Projected ATS parseability score 0-25" }
              },
              required: ["keywordDensity", "formatCompliance", "sectionStructure", "parseability"]
            }
          },
          required: ["overall", "breakdown"]
        },
        compatibilityAudit: {
          type: "object",
          properties: {
            overallGrade: { type: "string", enum: ["A", "B", "C", "D", "F"], description: "Overall ATS compatibility grade" },
            criticalIssues: { 
              type: "array", 
              items: { 
                type: "object",
                properties: {
                  issue: { type: "string", description: "The ATS compatibility issue" },
                  impact: { type: "string", enum: ["critical", "high", "medium"], description: "Impact level" },
                  fix: { type: "string", description: "How to fix this issue" }
                },
                required: ["issue", "impact", "fix"]
              },
              description: "Critical ATS issues that will cause rejection"
            },
            parsingProblems: {
              type: "array",
              items: { type: "string" },
              description: "Specific elements that ATS systems will fail to parse correctly"
            },
            atsSystemsCompatibility: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  system: { type: "string", description: "ATS system name (Workday, Greenhouse, Lever, etc.)" },
                  compatible: { type: "boolean", description: "Whether resume is compatible with this system" },
                  issues: { type: "array", items: { type: "string" }, description: "Specific issues for this system" }
                },
                required: ["system", "compatible", "issues"]
              },
              description: "Compatibility with major ATS systems"
            }
          },
          required: ["overallGrade", "criticalIssues", "parsingProblems", "atsSystemsCompatibility"]
        },
        keywordOptimization: {
          type: "object",
          properties: {
            primaryRole: {
              type: "object",
              properties: {
                roleName: { type: "string", description: "Primary target role" },
                currentKeywordMatch: { type: "number", description: "Current keyword match percentage 0-100" },
                targetKeywordMatch: { type: "number", description: "Target keyword match percentage after optimization" },
                missingKeywords: { type: "array", items: { type: "string" }, description: "Critical keywords missing from resume" },
                keywordsToAdd: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      keyword: { type: "string" },
                      whereToAdd: { type: "string", description: "Where in resume to add this keyword" },
                      exampleUsage: { type: "string", description: "Example sentence using this keyword" }
                    },
                    required: ["keyword", "whereToAdd", "exampleUsage"]
                  }
                }
              },
              required: ["roleName", "currentKeywordMatch", "targetKeywordMatch", "missingKeywords", "keywordsToAdd"]
            },
            secondaryRoles: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  roleName: { type: "string" },
                  additionalKeywords: { type: "array", items: { type: "string" } },
                  adaptationTips: { type: "string", description: "How to adapt resume for this role" }
                },
                required: ["roleName", "additionalKeywords", "adaptationTips"]
              },
              description: "Up to 2 secondary/alternative roles to target"
            }
          },
          required: ["primaryRole", "secondaryRoles"]
        },
        formatRestructuring: {
          type: "object",
          properties: {
            currentFormatIssues: { type: "array", items: { type: "string" } },
            recommendedFormat: { type: "string", description: "Recommended resume format type" },
            sectionOrder: { type: "array", items: { type: "string" }, description: "Optimal section order" },
            fontRecommendation: { type: "string", description: "ATS-safe font recommendation" },
            marginRecommendation: { type: "string", description: "Recommended margins" },
            elementsToRemove: { 
              type: "array", 
              items: { type: "string" }, 
              description: "Elements that break ATS parsing (tables, graphics, columns, etc.)" 
            },
            elementsToKeep: { type: "array", items: { type: "string" } }
          },
          required: ["currentFormatIssues", "recommendedFormat", "sectionOrder", "fontRecommendation", "marginRecommendation", "elementsToRemove", "elementsToKeep"]
        },
        industryKeywordBank: {
          type: "object",
          properties: {
            industry: { type: "string", description: "Detected industry" },
            hardSkills: { type: "array", items: { type: "string" }, description: "15-20 hard skill keywords for this industry" },
            softSkills: { type: "array", items: { type: "string" }, description: "8-10 soft skill keywords" },
            certifications: { type: "array", items: { type: "string" }, description: "Relevant certifications to consider" },
            tools: { type: "array", items: { type: "string" }, description: "Industry-standard tools and software" },
            actionVerbs: { type: "array", items: { type: "string" }, description: "10-15 powerful action verbs for this industry" }
          },
          required: ["industry", "hardSkills", "softSkills", "certifications", "tools", "actionVerbs"]
        },
        linkedInAlignment: {
          type: "object",
          properties: {
            headlineRecommendation: { type: "string", description: "Optimized LinkedIn headline" },
            summaryKeyPoints: { type: "array", items: { type: "string" }, description: "Key points to include in LinkedIn summary" },
            skillsToFeature: { type: "array", items: { type: "string" }, description: "Top skills to feature on LinkedIn" },
            keywordConsistency: { type: "string", description: "How to ensure keyword consistency between resume and LinkedIn" }
          },
          required: ["headlineRecommendation", "summaryKeyPoints", "skillsToFeature", "keywordConsistency"]
        },
        optimizedResumeSections: {
          type: "object",
          properties: {
            professionalSummary: { type: "string", description: "Rewritten ATS-optimized professional summary" },
            coreCompetencies: { type: "array", items: { type: "string" }, description: "8-12 core competencies/skills to list" },
            experienceBullets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  original: { type: "string" },
                  optimized: { type: "string" },
                  keywordsAdded: { type: "array", items: { type: "string" } }
                },
                required: ["original", "optimized", "keywordsAdded"]
              },
              description: "5-8 rewritten experience bullets with keywords"
            }
          },
          required: ["professionalSummary", "coreCompetencies", "experienceBullets"]
        },
        actionPlan: {
          type: "array",
          items: {
            type: "object",
            properties: {
              priority: { type: "number", description: "Priority 1-10 (1 is highest)" },
              action: { type: "string", description: "Specific action to take" },
              timeEstimate: { type: "string", description: "Estimated time to complete" },
              impact: { type: "string", enum: ["critical", "high", "medium"], description: "Impact on ATS score" }
            },
            required: ["priority", "action", "timeEstimate", "impact"]
          },
          description: "Prioritized action plan with 8-10 items"
        },
        redFlagsSummary: {
          type: "array",
          items: {
            type: "object",
            properties: {
              flag: { type: "string" },
              whyItMatters: { type: "string" },
              howToFix: { type: "string" }
            },
            required: ["flag", "whyItMatters", "howToFix"]
          },
          description: "5-7 red flags that will get resume rejected"
        }
      },
      required: [
        "beforeScore", "afterScore", "compatibilityAudit", "keywordOptimization",
        "formatRestructuring", "industryKeywordBank", "linkedInAlignment",
        "optimizedResumeSections", "actionPlan", "redFlagsSummary"
      ]
    }
  }
}];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const clientIp = getClientIp(req);

  try {
    console.log("[ATS-DEFENSE] Function started", { ip: clientIp });

    // Parse request
    let requestBody;
    try {
      requestBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INVALID_INPUT }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // allowRegeneration is still sent by the success page's recovery path and
    // is no longer read: a paid ATS Defense session may always regenerate (see
    // the claim below).
    const { sessionId, resumeText, targetRoles, jobDescription, language } = requestBody;

    // Validate session ID
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length < 10) {
      console.log("[ATS-DEFENSE] Invalid session ID");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PAYMENT_REQUIRED }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate resume
    if (!resumeText || typeof resumeText !== 'string' || resumeText.length < 100) {
      console.log("[ATS-DEFENSE] Invalid resume text");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INVALID_INPUT }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanedResume = resumeText.slice(0, MAX_RESUME_LENGTH);
    const roles = Array.isArray(targetRoles) ? targetRoles.slice(0, 3) : [];
    const cleanedJobDescription = typeof jobDescription === 'string' ? jobDescription.slice(0, 10000) : '';

    // Initialize Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[ATS-DEFENSE] Supabase credentials not configured");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Rate limit check
    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'generate-ats-defense',
      p_max_requests: 20,
      p_window_minutes: 60
    });

    if (rlError) {
      console.error("[ATS-DEFENSE] Rate limit check error:", rlError);
    } else if (!allowed) {
      console.log("[ATS-DEFENSE] Rate limit exceeded");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.RATE_LIMITED }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let customerEmail: string | null = null;
    const isProGrant = sessionId.startsWith('pro_');

    if (isProGrant) {
      // A PRO SUBSCRIBER'S GRANT HAS NO STRIPE SESSION (platform sweep L6-03,
      // register 1.14). create-product-checkout mints `pro_<grant>` for a
      // subscriber and verify-product-purchase consumes it and writes its
      // claim, naming the product, before this page ever calls here. This
      // used to send that id to stripe.checkout.sessions.retrieve, which
      // threw, so every $45 subscriber got a 401 for a tool the plan includes,
      // after their grant was already spent. The claim is the proof, exactly
      // as for every other paid generator.
      const refusal = await assertPaidSession(supabase, sessionId, ATS_DEFENSE_PRODUCT_TYPES);
      if (refusal) {
        console.log("[ATS-DEFENSE] Pro grant refused:", refusal);
        return new Response(
          JSON.stringify({ error: refusal }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { data: grant } = await supabase
        .from('pro_grants')
        .select('email')
        .eq('id', sessionId.slice(4))
        .maybeSingle();
      customerEmail = (grant as { email?: string | null } | null)?.email ?? null;
    } else {
      // Verify Stripe payment
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) {
        console.error("[ATS-DEFENSE] STRIPE_SECRET_KEY not set");
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const stripe = new Stripe(stripeKey, { apiVersion: "2025-12-15.clover" });

      let session;
      try {
        session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['customer_details', 'line_items']
        });
        customerEmail = session.customer_details?.email || session.customer_email || null;
        console.log("[ATS-DEFENSE] Stripe session verified", { email: customerEmail ? 'found' : 'not found' });
      } catch (stripeError) {
        console.error("[ATS-DEFENSE] Invalid Stripe session:", stripeError);
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.PAYMENT_REQUIRED }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 'paid', or a $0 session a 100%-off code completed (L6-10).
      if (!checkoutSessionSettled(session)) {
        console.log("[ATS-DEFENSE] Unpaid session");
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.PAYMENT_REQUIRED }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify it's an ATS Defense purchase
      const metadata = session.metadata || {};
      if (metadata.product_type !== ATS_DEFENSE_PRODUCT_TYPE) {
        console.log("[ATS-DEFENSE] Wrong product type:", metadata.product_type);
        return new Response(
          JSON.stringify({ error: "This session is not for ATS Defense" }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Stripe still answers 'paid' for a refunded or disputed session, and
      // the claim below treats its existing (rewritten) row as proof (L6-18).
      if (await sessionWasRefunded(supabase, sessionId)) {
        console.log("[ATS-DEFENSE] Refunded session");
        return new Response(
          JSON.stringify({ error: REFUNDED_PURCHASE_MESSAGE, refunded: true }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // THE SESSION IS ALREADY CLAIMED BY THE TIME THIS RUNS, AND THAT IS PROOF,
    // NOT A REASON TO REFUSE.
    //
    // This used to INSERT the claim and answer 409 when the row already
    // existed. But both of its callers claim the session FIRST: the webhook at
    // the top of triggerProductDelivery, and the success page only after
    // verify-product-purchase has claimed it. So the webhook's generation
    // always met 409 (and so did every retry of it), the success page's first
    // call always met 409, and a $15 buyer got the report only if they then
    // found the recovery form, whose allowRegeneration flag skipped the check.
    // A flag any caller may send was the only thing standing between the 409
    // and a regeneration, so the 409 protected nothing and cost every buyer.
    //
    // Stripe has just confirmed above that this session is paid and is for
    // ATS Defense. The claim is written here only if no one has written it yet
    // (a direct call), and it records the product -- a claim without one is
    // accepted by every paid generator as a purchase of anything. An existing
    // claim is the expected case and the request proceeds; any other database
    // error still fails closed.
    // (A Pro grant was proven BY its claim above, so there is nothing to write.)
    const { error: claimError } = isProGrant
      ? { error: null }
      : await supabase
        .from('used_stripe_sessions')
        .insert({ session_id: sessionId, ip_address: clientIp, product_type: ATS_DEFENSE_PRODUCT_TYPE });

    if (claimError && claimError.code !== '23505') {
      console.error("[ATS-DEFENSE] Error claiming session:", claimError.message);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (claimError) console.log("[ATS-DEFENSE] Session already claimed by its caller; generating");

    // Call AI for analysis
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[ATS-DEFENSE] LOVABLE_API_KEY not set");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const escapedResume = escapeXml(cleanedResume);
    const escapedJobDescription = escapeXml(cleanedJobDescription);
    const rolesContext = roles.length > 0 
      ? `\n\nTARGET ROLES (optimize for these):\n${roles.map((r: string, i: number) => `${i + 1}. ${escapeXml(r)}`).join('\n')}`
      : '';
    const jobDescContext = escapedJobDescription 
      ? `\n\nTARGET JOB DESCRIPTION:\n<job_description>\n${escapedJobDescription}\n</job_description>\n\nUse the keywords and requirements from this job description to provide highly targeted optimization recommendations.`
      : '';

    const systemPrompt = `You are an expert ATS (Applicant Tracking System) specialist with deep knowledge of how automated resume screening works across all major platforms including Workday, Greenhouse, Lever, iCIMS, Taleo, and BambooHR.

Your task is to provide a COMPREHENSIVE ATS Defense report that will help this candidate's resume pass through automated screening and reach human recruiters.

KEY ANALYSIS AREAS:
1. **ATS Compatibility Audit**: Identify ALL issues that will cause ATS rejection - formatting problems, parsing issues, missing sections, problematic elements (tables, graphics, columns, headers/footers, text boxes, unusual fonts, special characters)

2. **Before/After Score**: Provide realistic scores showing current ATS compatibility and projected score after implementing all fixes

3. **Keyword Optimization**: Deep keyword analysis for primary role plus up to 2 secondary roles. Include SPECIFIC keywords missing and exactly where to add them${escapedJobDescription ? ' - PRIORITIZE keywords from the provided job description' : ''}

4. **Format Restructuring**: Specific format changes needed - section order, fonts, margins, elements to remove

5. **Industry Keyword Bank**: Comprehensive keyword list specific to their detected industry

6. **LinkedIn Alignment**: How to ensure resume and LinkedIn profile use consistent keywords

7. **Optimized Sections**: Provide rewritten professional summary and experience bullets with keywords integrated

8. **Action Plan**: Prioritized list of exactly what to do, with time estimates

BE SPECIFIC AND ACTIONABLE. Every recommendation should be something the candidate can immediately implement.${buildLanguageInstruction(language)}`;

    const userMessage = `<resume>
${escapedResume}
</resume>${rolesContext}${jobDescContext}

Analyze this resume for ATS compatibility and provide a complete ATS Defense report. Be thorough and specific - this is a premium product and the user expects comprehensive, actionable insights.${escapedJobDescription ? ' Pay special attention to matching keywords from the target job description.' : ''}`;

    console.log("[ATS-DEFENSE] Calling AI gateway");

    // Retry logic with timeout cap
    const maxRetries = 2;
    const REQUEST_TIMEOUT_MS = 90000; // 90 seconds for this complex analysis
    const RETRY_DELAY_MS = 2000;
    let lastError: Error | null = null;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        
        console.log(`[ATS-DEFENSE] API call attempt ${attempt + 1}/${maxRetries + 1}`);
        
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-5",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage }
            ],
            tools: getATSDefenseTools(),
            tool_choice: { type: "function", function: { name: "submit_ats_defense_report" } }
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        // If we got a response (success or client error), break out
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          break;
        }
        
        // Server errors - retry
        if (response.status >= 500 && attempt < maxRetries) {
          const errorText = await response.text();
          console.log(`[ATS-DEFENSE] Server error ${response.status}, retrying...`, errorText.substring(0, 200));
          lastError = new Error(`Server error: ${response.status}`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
          response = null;
          continue;
        }
        
        break;
        
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (errorMessage.includes('aborted')) {
          console.log(`[ATS-DEFENSE] Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
          lastError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        } else {
          console.error(`[ATS-DEFENSE] Fetch attempt ${attempt + 1}/${maxRetries + 1} failed:`, errorMessage);
          lastError = fetchError as Error;
        }
        
        if (attempt < maxRetries) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[ATS-DEFENSE] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!response) {
      console.error("[ATS-DEFENSE] All retry attempts failed:", lastError?.message);
      
      if (lastError?.message.includes('timed out') || lastError?.message.includes('timeout')) {
        return new Response(
          JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable. Please try again in a few moments." }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ATS-DEFENSE] AI gateway error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log("[ATS-DEFENSE] AI response received");

    // Extract analysis from tool call
    let analysis;
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall && toolCall.function?.arguments) {
      try {
        analysis = JSON.parse(toolCall.function.arguments);
        console.log("[ATS-DEFENSE] Successfully parsed tool call response");
      } catch (parseError) {
        console.error("[ATS-DEFENSE] Failed to parse tool call:", parseError);
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.error("[ATS-DEFENSE] No tool call in response");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const duration = Date.now() - startTime;
    console.log(`[ATS-DEFENSE] Complete | ${duration}ms | success`);

    // KEPT, so the buyer can get it back (L6-03). The success page calls this
    // directly and used to be the only holder of the report it rendered; a
    // closed tab lost a $15 purchase. Upserted per session, best-effort: the
    // server-side callers save the same report themselves.
    const { error: saveError } = await supabase.rpc('save_purchased_content', {
      p_stripe_session_id: sessionId,
      p_customer_email: customerEmail ?? '',
      p_product_type: ATS_DEFENSE_PRODUCT_TYPE,
      p_product_name: ATS_DEFENSE_PRODUCT_NAME,
      p_generated_content: analysis,
    });
    if (saveError) console.error("[ATS-DEFENSE] Report generated but not saved:", saveError.message);

    // `data` is the field every generator answers with and every server-side
    // caller (the webhook, verify-product-purchase, retry-failed-deliveries)
    // reads. Answering {report} alone made each of them read undefined and
    // throw the report away on every sale (L6-02). `report` stays for the
    // success page, which reads it.
    return new Response(
      JSON.stringify({
        success: true,
        data: analysis,
        report: analysis,
        customerEmail
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ATS-DEFENSE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
