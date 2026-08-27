// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { assertPaidSession } from "../_shared/paid-session.ts";
import { checkAiGatewayResponse } from "../_shared/ai-gateway-response.ts";
import { callAIWithModelFallback, chainFrom } from "../_shared/ai-fallback.ts";
import { buildLanguageInstruction } from "../_shared/language-instruction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GRADUATE-GAMEPLAN] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-graduate-gameplan", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, language, sessionId } = await req.json();

    // PAID CONTENT — see paid-session.ts. Gated before input validation so an
    // unpaid caller cannot probe the endpoint's behaviour or spend a token.
    // Gated on WHAT was bought, not merely that something was. Without the
    // product list a $2 scan-pack session opened every paid generator forever.
    const paidError = await assertPaidSession(supabase, sessionId, ["graduate_gameplan"]);
    if (paidError) {
      return new Response(
        JSON.stringify({ error: paidError, retryable: true }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting Graduate Game Plan generation", { 
      jobTitle,
      jobCompany,
      resumeLength: resumeText?.length,
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an expert career counselor specializing in helping new graduates and early-career professionals break into the job market. Your task is to create a Graduate Game Plan — a clear, step-by-step playbook for what to do next.

This is NOT a resume critique. This is post-resume execution guidance.

## TARGET AUDIENCE
- College seniors
- New grads (0–2 years experience)
- Intern → full-time candidates
- People overwhelmed by "what now?"

## OUTPUT FORMAT (JSON)
You MUST output a valid JSON object with this exact structure:

{
  "resumeReadinessGate": {
    "verdict": "Ready to Apply" | "Fix These First",
    "confidence": "High" | "Medium",
    "summary": "1-2 sentences giving them permission to move forward or telling them to fix basics first",
    "quickFixes": [
      "Fix 1 (if needed)",
      "Fix 2 (if needed)"
    ]
  },
  "roleTargetingMap": {
    "summary": "1-2 sentences explaining their positioning",
    "priorityRoles": [
      {
        "title": "Role title to target",
        "whyFit": "Why this fits their background"
      },
      {
        "title": "Second role",
        "whyFit": "Reason"
      },
      {
        "title": "Third role",
        "whyFit": "Reason"
      }
    ],
    "rolesToAvoid": [
      {
        "title": "Role to avoid",
        "reason": "Why they shouldn't apply"
      },
      {
        "title": "Another role to avoid",
        "reason": "Reason"
      }
    ]
  },
  "applicationStrategy": {
    "weeklyTarget": "15-25 targeted applications (not 100 spray-and-pray)",
    "whereToApply": [
      {
        "channel": "Channel name (e.g., Company Career Pages)",
        "priority": "High" | "Medium" | "Low",
        "tip": "Specific advice for this channel"
      }
    ],
    "whatToAvoid": [
      "Bad habit 1",
      "Bad habit 2"
    ],
    "keyInsight": "One powerful insight about job searching as a new grad"
  },
  "networkingPlaybook": {
    "approach": "1-2 sentences on their networking style",
    "outreachScript": {
      "scenario": "Reaching out to someone at target company",
      "script": "The exact message they can copy and customize"
    },
    "linkedInTips": [
      "Tip 1",
      "Tip 2"
    ]
  },
  "interviewReadiness": {
    "summary": "1 sentence on their interview readiness",
    "storiesToPrepare": [
      {
        "type": "Teamwork/Collaboration",
        "prompt": "A specific situation they should prepare"
      },
      {
        "type": "Problem Solving",
        "prompt": "A specific situation"
      },
      {
        "type": "Initiative/Leadership",
        "prompt": "A specific situation"
      }
    ],
    "whyThisRole": "How they should answer 'Why this role?' based on their background",
    "projectTalkingPoints": [
      "How to frame project/internship 1",
      "How to frame project/internship 2"
    ]
  },
  "thirtyDayPlan": {
    "week1": {
      "focus": "Theme for week 1",
      "tasks": [
        "Task 1",
        "Task 2",
        "Task 3"
      ]
    },
    "week2": {
      "focus": "Theme for week 2",
      "tasks": [
        "Task 1",
        "Task 2",
        "Task 3"
      ]
    },
    "week3": {
      "focus": "Theme for week 3",
      "tasks": [
        "Task 1",
        "Task 2",
        "Task 3"
      ]
    },
    "week4": {
      "focus": "Theme for week 4",
      "tasks": [
        "Task 1",
        "Task 2",
        "Task 3"
      ]
    }
  }
}

## ANALYSIS PRINCIPLES

### Resume Readiness Gate
- Be encouraging but honest
- Most grads have "good enough" resumes — give them permission to start applying
- Only flag true basics: missing contact info, obvious typos, terrible formatting
- This is about confidence, not perfection

### Role Targeting Map
- Be specific about job titles, not vague categories
- Consider their major, experience, skills
- Avoid roles that are clearly mismatched (senior roles, manager titles for new grads)
- Explain WHY each role fits or doesn't fit

### Application Strategy
- Be realistic: 15-25 quality applications beats 100 spray-and-pray
- Prioritize channels (company sites > LinkedIn Easy Apply for quality)
- Call out common grad mistakes (applying only to big tech, ignoring smaller companies)

### Networking Playbook
- Keep it simple and non-cringey
- Provide copy-paste scripts they can actually use
- Focus on informational interviews, not "asking for a job"

### Interview Readiness
- Based on their actual experiences (internships, projects, coursework)
- Specific story prompts they can prepare
- Help them frame academic/project experience professionally

### 30-Day Plan
- Week 1: Foundation (resume finalized, LinkedIn optimized)
- Week 2: Active application + first outreach
- Week 3: Follow-ups + interview prep
- Week 4: Adjust strategy based on results
- Keep tasks specific and achievable${buildLanguageInstruction(language)}`;

    const userPrompt = `Generate a Graduate Game Plan for this resume:

${resumeText}

${jobDescription ? `\nTarget Job Context:\n${jobDescription}` : ''}
${jobTitle ? `\nTarget Role Interest: ${jobTitle}` : ''}
${jobCompany ? `\nTarget Company Interest: ${jobCompany}` : ''}

Create a comprehensive, actionable Graduate Game Plan that gives this new grad/early-career candidate a clear path forward.`;

    logStep("Calling AI API");

    const { response } = await callAIWithModelFallback(apiKey, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 4000,
      jsonResponse: true,
      models: chainFrom("google/gemini-2.5-flash"),
      context: "GRADUATE-GAMEPLAN",
    });

    const rateLimitResponse = await checkAiGatewayResponse(response, corsHeaders);
    if (rateLimitResponse) return rateLimitResponse;

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content returned from AI");
    }

    logStep("AI response received", { contentLength: content.length });

    // Parse the JSON response
    let graduateGamePlan;
    try {
      graduateGamePlan = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        graduateGamePlan = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    // Validate required fields
    if (!graduateGamePlan.resumeReadinessGate || !graduateGamePlan.roleTargetingMap || 
        !graduateGamePlan.applicationStrategy || !graduateGamePlan.thirtyDayPlan) {
      throw new Error("Graduate Game Plan response missing required fields");
    }

    logStep("Graduate Game Plan generated successfully", {
      verdict: graduateGamePlan.resumeReadinessGate?.verdict,
      priorityRolesCount: graduateGamePlan.roleTargetingMap?.priorityRoles?.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: graduateGamePlan,
        modelUsed: "google/gemini-2.5-flash"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error generating Graduate Game Plan", { error: errorMessage });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
