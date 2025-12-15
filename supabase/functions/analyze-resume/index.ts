import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESUME_LENGTH = 50000;
const MAX_LINKEDIN_LENGTH = 30000;

const ERROR_MESSAGES = {
  INTERNAL: 'An error occurred while processing your request. Please try again.',
  INVALID_INPUT: 'Invalid input provided.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, linkedInText } = await req.json();
    
    if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Resume text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (resumeText.length > MAX_RESUME_LENGTH) {
      console.log(`[ANALYZE-RESUME] Resume too long: ${resumeText.length} characters`);
      return new Response(
        JSON.stringify({ error: 'Resume text is too long. Please limit to 50,000 characters.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate LinkedIn text if provided
    const hasLinkedIn = linkedInText && typeof linkedInText === 'string' && linkedInText.trim().length > 0;
    if (hasLinkedIn && linkedInText.length > MAX_LINKEDIN_LENGTH) {
      console.log(`[ANALYZE-RESUME] LinkedIn too long: ${linkedInText.length} characters`);
      return new Response(
        JSON.stringify({ error: 'LinkedIn text is too long. Please limit to 30,000 characters.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[ANALYZE-RESUME] LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemPrompt = `You are an expert ATS resume analyst, recruiter, and LinkedIn optimization specialist. Write like a recruiter, not a career coach. Be direct with no motivational language. Prioritize measurable impact over generic advice.

Analyze the provided resume${hasLinkedIn ? ' and LinkedIn profile' : ''} and return a JSON object with EXACTLY this structure:
{
  "industry": "detected industry (e.g., 'Software Engineering', 'Marketing', 'Finance')",
  "experienceLevel": "entry | mid | senior | executive",
  "summaryRewrite": {
    "professionalSummary": "A 2-3 sentence powerful professional summary for the top of their resume",
    "linkedInHeadline": "An optimized LinkedIn headline under 120 characters"
  },
  "optimizedBullets": [
    {
      "original": "exact text from their resume that needs improvement",
      "improved": "rewritten version with metrics and impact",
      "reason": "brief explanation of the improvement"
    }
  ],
  "quantificationOpportunities": [
    {
      "context": "The vague statement or area from their resume",
      "suggestion": "How to add specific metrics here",
      "example": "Example of what it could look like with numbers"
    }
  ],
  "skillsGap": {
    "missingTechnical": ["skill1", "skill2"],
    "missingSoft": ["skill1", "skill2"],
    "recommendations": "Brief paragraph on how to address skill gaps"
  },
  "industryInsights": {
    "whatRecruitersLookFor": "2-3 sentences on what recruiters in this industry prioritize",
    "competitiveAdvantage": "What would make this candidate stand out",
    "commonMistakes": "1-2 common resume mistakes in this industry to avoid"
  },
  "actionVerbs": [
    { "weak": "weak verb found in resume", "strong": "stronger replacement" }
  ],
  "keywords": ["keyword1", "keyword2"],
  "redFlags": ["specific issue 1", "specific issue 2"]${hasLinkedIn ? `,
  "linkedInAnalysis": {
    "headlineOptimization": {
      "current": "Their current headline or 'Not provided' if not visible",
      "improved": "Optimized headline under 120 chars with keywords",
      "whyBetter": "Brief explanation of the improvement"
    },
    "aboutSectionRewrite": "A compelling 3-4 paragraph About section that tells their story, highlights achievements, and includes a call-to-action",
    "experienceOptimization": [
      {
        "role": "Job title at Company",
        "issue": "What's wrong with current description",
        "improved": "Rewritten description with metrics and keywords"
      }
    ],
    "skillsToAdd": ["skill1", "skill2", "skill3"],
    "skillsToRemove": ["outdated skill1", "irrelevant skill2"],
    "seoKeywords": ["keyword1", "keyword2", "keyword3"],
    "profileVisibilityTips": [
      "Specific tip 1 to increase profile views",
      "Specific tip 2 for better searchability",
      "Specific tip 3 for engagement"
    ],
    "featuredSectionIdeas": [
      "Type of content to feature and why",
      "Another content idea"
    ],
    "recommendationStrategy": "How to request and give recommendations effectively"
  }` : ''}
}

Guidelines:
- industry: Detect the candidate's industry from job titles, skills, and experience
- experienceLevel: Assess based on years of experience and role seniority
- summaryRewrite: Create a compelling professional summary and LinkedIn headline that highlights their strongest selling points
- optimizedBullets: Find 3-5 weak bullet points and rewrite them with specific metrics, outcomes, and impact
- quantificationOpportunities: Find 3-4 places where vague statements could be strengthened with specific numbers
- skillsGap: Identify 3-5 missing technical skills and 2-3 soft skills standard for their role/industry
- industryInsights: Provide specific advice tailored to their detected industry
- actionVerbs: Identify 4-6 weak verbs and suggest powerful alternatives
- keywords: Suggest 6-8 industry-relevant keywords missing from the resume
- redFlags: List 3-5 specific issues recruiters would notice${hasLinkedIn ? `

LinkedIn-specific guidelines:
- headlineOptimization: Make headline keyword-rich, specific, and compelling - NOT generic titles
- aboutSectionRewrite: Write in first person, tell their career story, include achievements with numbers, end with what they're looking for
- experienceOptimization: Find 2-3 role descriptions to improve with metrics and action verbs
- skillsToAdd: Suggest 5-8 in-demand skills they should add based on their industry
- skillsToRemove: Identify 2-3 outdated or irrelevant skills hurting their profile
- seoKeywords: List 8-10 keywords recruiters search for in their industry
- profileVisibilityTips: Give 3-5 specific, actionable tips (posting frequency, engagement strategies, profile settings)
- featuredSectionIdeas: Suggest 2-3 types of content to feature
- recommendationStrategy: Explain how to get quality recommendations` : ''}

Return ONLY valid JSON, no markdown formatting or code blocks.`;

    console.log(`[ANALYZE-RESUME] Calling AI for analysis... (hasLinkedIn: ${hasLinkedIn})`);
    
    const userMessage = hasLinkedIn 
      ? `Analyze this resume and LinkedIn profile:\n\n=== RESUME ===\n${resumeText}\n\n=== LINKEDIN PROFILE ===\n${linkedInText}`
      : `Analyze this resume:\n\n${resumeText}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ANALYZE-RESUME] AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.RATE_LIMITED }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.SERVICE_UNAVAILABLE }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("[ANALYZE-RESUME] No content in AI response:", data);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[ANALYZE-RESUME] Raw AI response received");

    let analysis;
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith('```')) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      analysis = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error("[ANALYZE-RESUME] Failed to parse AI response:", parseError);
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!analysis.optimizedBullets || !analysis.actionVerbs || !analysis.keywords || !analysis.redFlags) {
      console.error("[ANALYZE-RESUME] Invalid analysis structure - missing core fields");
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure optional fields have defaults
    analysis.industry = analysis.industry || "General";
    analysis.experienceLevel = analysis.experienceLevel || "mid";
    analysis.summaryRewrite = analysis.summaryRewrite || { professionalSummary: "", linkedInHeadline: "" };
    analysis.quantificationOpportunities = analysis.quantificationOpportunities || [];
    analysis.skillsGap = analysis.skillsGap || { missingTechnical: [], missingSoft: [], recommendations: "" };
    analysis.industryInsights = analysis.industryInsights || { whatRecruitersLookFor: "", competitiveAdvantage: "", commonMistakes: "" };
    
    // Set hasLinkedIn flag for frontend
    analysis.hasLinkedIn = hasLinkedIn;

    console.log("[ANALYZE-RESUME] Analysis complete, saving to database...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: savedAnalysis, error: dbError } = await supabase
      .from("resume_analyses")
      .insert({
        resume_text: resumeText + (hasLinkedIn ? `\n\n=== LINKEDIN ===\n${linkedInText}` : ''),
        analysis_result: analysis,
      })
      .select("share_id")
      .single();

    if (dbError) {
      console.error("[ANALYZE-RESUME] Database error:", dbError);
      return new Response(
        JSON.stringify({ ...analysis, shareId: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("[ANALYZE-RESUME] Analysis saved successfully");

    return new Response(
      JSON.stringify({ ...analysis, shareId: savedAnalysis.share_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("[ANALYZE-RESUME] Error:", error);
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.INTERNAL }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
