import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// Helper to get client IP from request (prioritize Cloudflare's trusted header)
const getClientIp = (req: Request): string => {
  return req.headers.get('cf-connecting-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
         req.headers.get('x-real-ip') || 
         'unknown';
};

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

    const { sessionId, resumeText, targetRoles, allowRegeneration, jobDescription } = requestBody;

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
    let customerEmail: string | null = null;
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

    if (session.payment_status !== 'paid') {
      console.log("[ATS-DEFENSE] Unpaid session");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.PAYMENT_REQUIRED }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify it's an ATS Defense purchase
    const metadata = session.metadata || {};
    if (metadata.product_type !== 'ats_defense') {
      console.log("[ATS-DEFENSE] Wrong product type:", metadata.product_type);
      return new Response(
        JSON.stringify({ error: "This session is not for ATS Defense" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if session already used (skip check if allowRegeneration is true for recovery scenarios)
    const { data: existingSession } = await supabase
      .from('used_stripe_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existingSession && !allowRegeneration) {
      console.log("[ATS-DEFENSE] Session already used and regeneration not allowed");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SESSION_USED }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark session as used (only if not already marked)
    if (!existingSession) {
      await supabase.from('used_stripe_sessions').insert({
        session_id: sessionId,
        ip_address: clientIp
      });
    } else {
      console.log("[ATS-DEFENSE] Session already marked as used, proceeding with regeneration");
    }

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

BE SPECIFIC AND ACTIONABLE. Every recommendation should be something the candidate can immediately implement.`;

    const userMessage = `<resume>
${escapedResume}
</resume>${rolesContext}${jobDescContext}

Analyze this resume for ATS compatibility and provide a complete ATS Defense report. Be thorough and specific - this is a premium product and the user expects comprehensive, actionable insights.${escapedJobDescription ? ' Pay special attention to matching keywords from the target job description.' : ''}`;

    console.log("[ATS-DEFENSE] Calling AI gateway");

    // Retry logic for transient network errors
    const maxRetries = 3;
    let lastError: Error | null = null;
    let response: Response | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-pro", // Use pro for premium ATS defense quality
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage }
            ],
            tools: getATSDefenseTools(),
            tool_choice: { type: "function", function: { name: "submit_ats_defense_report" } }
          }),
        });
        
        // If we got a response, break out of retry loop
        break;
      } catch (fetchError) {
        lastError = fetchError as Error;
        console.error(`[ATS-DEFENSE] Fetch attempt ${attempt}/${maxRetries} failed:`, fetchError);
        
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff: 1s, 2s, 4s)
          const delay = Math.pow(2, attempt - 1) * 1000;
          console.log(`[ATS-DEFENSE] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!response) {
      console.error("[ATS-DEFENSE] All retry attempts failed:", lastError?.message);
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

    return new Response(
      JSON.stringify({ 
        success: true, 
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
