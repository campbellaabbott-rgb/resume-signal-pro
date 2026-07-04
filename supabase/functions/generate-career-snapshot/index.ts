// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkAiGatewayResponse } from "../_shared/ai-gateway-response.ts";
import { buildLanguageInstruction } from "../_shared/language-instruction.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CAREER-SNAPSHOT] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-career-snapshot", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, language } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting Career Snapshot generation", { 
      jobTitle,
      jobCompany,
      resumeLength: resumeText?.length,
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const systemPrompt = `You are an elite executive recruiter and career strategist with 20+ years of experience evaluating senior talent. Your task is to produce a Career Snapshot — a diagnostic career intelligence report that shows how a candidate's career looks at a glance.

This is NOT a resume rewrite. This is career intelligence.

## OUTPUT FORMAT (JSON)
You MUST output a valid JSON object with this exact structure:

{
  "careerSignalScore": {
    "overall": "Strong" | "Mixed" | "Risky",
    "performanceSignal": {
      "score": "Strong" | "Mixed" | "Weak",
      "summary": "One sentence explaining why"
    },
    "trajectorySignal": {
      "score": "Growth" | "Stable" | "Stagnant" | "Unclear",
      "summary": "One sentence explaining the career trajectory"
    },
    "credibilitySignal": {
      "score": "High" | "Medium" | "Low",
      "summary": "One sentence on tenure, consistency, credibility markers"
    },
    "seniorityAlignment": {
      "currentLevel": "Entry" | "Mid" | "Senior" | "Executive",
      "targetFit": "Aligned" | "Stretch" | "Mismatch",
      "summary": "One sentence on seniority fit"
    }
  },
  "recruiterPerception": {
    "summary": "2-3 sentences describing exactly what recruiters will see at first glance. Be specific about their likely perception, positioning, and company fit. Example: 'At a glance, recruiters will see you as a high-performing enterprise AE with strong quota history but fragmented tenure, best positioned for Series B–D companies rather than large enterprise.'"
  },
  "topStrengths": [
    {
      "strength": "Specific, concrete strength (not fluff)",
      "evidence": "Specific proof from the resume"
    },
    {
      "strength": "Second strength",
      "evidence": "Specific proof"
    },
    {
      "strength": "Third strength",
      "evidence": "Specific proof"
    }
  ],
  "careerRisks": [
    {
      "risk": "Specific risk or red flag",
      "recruiterQuestion": "The exact question a recruiter will ask about this",
      "mitigation": "How to address this in interviews"
    },
    {
      "risk": "Second risk",
      "recruiterQuestion": "Question they'll ask",
      "mitigation": "How to address it"
    },
    {
      "risk": "Third risk (if applicable, otherwise omit)",
      "recruiterQuestion": "Question",
      "mitigation": "Mitigation"
    }
  ],
  "positioningGuidance": {
    "idealPositioning": "One sentence describing how they should position themselves. Example: 'Position yourself as a scale-stage revenue operator, not a pure enterprise closer.'",
    "rolesToTarget": ["Role type 1", "Role type 2", "Role type 3"],
    "rolesToAvoid": ["Role type to avoid 1", "Role type to avoid 2"],
    "companyStages": ["Ideal company stage 1", "Ideal company stage 2"],
    "storyFraming": "2-3 sentences on how to frame their career story in interviews"
  },
  "priorityFixes": [
    {
      "fix": "Specific, actionable fix",
      "impact": "Why this matters",
      "timeEstimate": "5 minutes" | "15 minutes" | "30 minutes"
    },
    {
      "fix": "Second priority fix",
      "impact": "Impact explanation",
      "timeEstimate": "Time estimate"
    },
    {
      "fix": "Third priority fix",
      "impact": "Impact explanation",
      "timeEstimate": "Time estimate"
    }
  ]
}

## ANALYSIS PRINCIPLES

### Career Signal Scoring
- Performance Signal: Look for quantified achievements, revenue impact, quota attainment, promotions
- Trajectory Signal: Is this person growing? Stagnant? Declining? Look at title progression, company prestige trajectory
- Credibility Signal: Tenure consistency (multiple short stints = concern), brand-name companies, clear accomplishments
- Seniority Alignment: Does their experience match senior/executive roles, or are they stretching?

### Recruiter Perception
- Write this as if you ARE the recruiter seeing this resume for 6 seconds
- Be brutally honest but constructive
- Include specific company fit (startup vs enterprise, stage, industry)

### Strengths (be specific, not generic)
- BAD: "Great communicator"
- GOOD: "Consistent quota overachievement across 3 companies (avg 120%)"
- BAD: "Leadership skills"
- GOOD: "Built and scaled SDR team from 2 to 15 in 18 months"

### Career Risks (forecast interviewer behavior)
- What will make a recruiter pause?
- What questions will definitely come up?
- Short tenures, gaps, lateral moves, unclear progression, industry switches

### Positioning Guidance (be strategic)
- What roles fit their background?
- What roles should they NOT pursue?
- What company stages/sizes are ideal?
- How should they tell their story?

### Priority Fixes (max 3, tactical)
- Keep it actionable and time-bound
- Focus on quick wins that improve perception
- Do NOT turn this into a full resume rewrite${buildLanguageInstruction(language)}`;

    const userPrompt = `Generate a Career Snapshot for this resume:

${resumeText}

${jobDescription ? `\nTarget Job Context:\n${jobDescription}` : ''}
${jobTitle ? `\nTarget Role: ${jobTitle}` : ''}
${jobCompany ? `\nTarget Company: ${jobCompany}` : ''}

Analyze this resume from a senior recruiter's perspective and generate the Career Snapshot JSON.`;

    logStep("Calling AI API");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      }),
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
    let careerSnapshot;
    try {
      careerSnapshot = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        careerSnapshot = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    // Validate required fields
    if (!careerSnapshot.careerSignalScore || !careerSnapshot.recruiterPerception || 
        !careerSnapshot.topStrengths || !careerSnapshot.positioningGuidance) {
      throw new Error("Career Snapshot response missing required fields");
    }

    logStep("Career Snapshot generated successfully", {
      overallSignal: careerSnapshot.careerSignalScore?.overall,
      strengthsCount: careerSnapshot.topStrengths?.length,
      risksCount: careerSnapshot.careerRisks?.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: careerSnapshot,
        modelUsed: "google/gemini-2.5-pro"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error generating Career Snapshot", { error: errorMessage });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
