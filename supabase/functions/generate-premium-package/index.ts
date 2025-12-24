import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-PREMIUM-PACKAGE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting premium package generation", { 
      jobTitle,
      jobCompany,
      resumeLength: resumeText?.length,
      hasJobDescription: !!jobDescription
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Step 1: Generate the rewritten resume
    logStep("Generating rewritten resume");
    
    const resumeSystemPrompt = `You are an elite ATS resume optimization specialist. Your task is to enhance and optimize the provided resume while STRICTLY PRESERVING all content.

## CRITICAL RULES - YOU MUST FOLLOW THESE:
1. **PRESERVE ALL CONTENT**: Keep EVERY job, education entry, project, and experience from the original. DO NOT remove or omit anything.
2. **MAINTAIN RESUME LENGTH**: The optimized resume should be SIMILAR in length to the original. If the original is 2 pages, output should be ~2 pages worth of content.
3. **ENHANCE, DON'T DELETE**: Your job is to IMPROVE wording, not remove content. Every experience in the original MUST appear in the output.

## OPTIMIZATION GUIDELINES:
1. **ATS Keywords**: Naturally integrate relevant keywords from the job description
2. **Quantify Achievements**: Enhance bullets with metrics where possible (%, $, numbers) - but keep the original context
3. **Strong Action Verbs**: Improve weak verbs with powerful, varied action verbs
4. **Prioritize Order**: You may reorder sections to highlight most relevant experience FIRST, but include ALL sections
5. **Professional Summary**: Write a compelling 3-4 sentence summary tailored to the role
6. **Skills Section**: Create a comprehensive, keyword-rich skills section

## OUTPUT FORMAT:
The rewritten resume MUST include ALL of the following sections from the original:
- Professional Summary/Objective
- ALL Work Experience entries (every single job)
- ALL Education entries
- ALL Projects (if present)
- ALL Certifications (if present)
- Comprehensive Skills section

You MUST respond with a valid JSON object:
{
  "rewrittenResume": "The COMPLETE rewritten resume with ALL original content preserved and enhanced. Include proper section headers and formatting.",
  "professionalSummary": "The new professional summary (3-4 sentences)",
  "keyChanges": [
    { "section": "string", "before": "original wording", "after": "improved wording", "reason": "why this improvement helps" }
  ],
  "addedKeywords": ["keyword1", "keyword2", ...],
  "atsScore": {
    "before": number (0-100),
    "after": number (0-100),
    "improvement": "explanation"
  },
  "highlights": ["improvement 1", "improvement 2", ...],
  "preservedSections": ["list of all sections from original that were kept"]
}`;

    const resumeUserPrompt = `OPTIMIZE this resume for the target position. CRITICAL: Keep ALL experiences, jobs, and content - enhance wording but do not remove anything.

ORIGINAL RESUME (PRESERVE ALL CONTENT):
${resumeText}

TARGET JOB TITLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:
${jobDescription}` : 'No job description provided - optimize for general professional excellence in this field.'}

REMINDER: Your output MUST include every job, education entry, and experience from the original. Do not condense or remove content. Enhance and optimize the wording while preserving completeness.`;

    const resumeResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: resumeSystemPrompt },
          { role: "user", content: resumeUserPrompt }
        ],
        max_tokens: 12000,
        temperature: 0.3,
      }),
    });

    if (!resumeResponse.ok) {
      const errorText = await resumeResponse.text();
      logStep("Resume AI API error", { status: resumeResponse.status, error: errorText });
      throw new Error(`Resume AI API error: ${resumeResponse.status}`);
    }

    const resumeAiResponse = await resumeResponse.json();
    const resumeContent = resumeAiResponse.choices?.[0]?.message?.content;
    
    if (!resumeContent) {
      throw new Error("No content in resume AI response");
    }

    let resumeResult;
    try {
      const jsonMatch = resumeContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        resumeResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in resume response");
      }
    } catch (parseError) {
      logStep("Resume JSON parse error", { error: String(parseError) });
      resumeResult = {
        rewrittenResume: resumeContent,
        professionalSummary: "",
        keyChanges: [],
        addedKeywords: [],
        atsScore: { before: 50, after: 85, improvement: "Optimized for ATS" },
        highlights: []
      };
    }

    logStep("Resume rewrite complete", { 
      keywordsAdded: resumeResult.addedKeywords?.length,
      changesCount: resumeResult.keyChanges?.length 
    });

    // Step 2: Generate the cover letter
    logStep("Generating cover letter");

    const coverLetterSystemPrompt = `You are an expert cover letter writer who creates compelling, personalized cover letters that get interviews.

Your cover letters should:
1. Open with a strong, attention-grabbing hook (not "I am writing to apply...")
2. Connect the candidate's experience directly to the job requirements
3. Show enthusiasm for the specific company and role
4. Include specific achievements with metrics when possible
5. Close with a confident call to action
6. Be professional and polished
7. Be 250-350 words (3-4 paragraphs)

You MUST respond with a valid JSON object:
{
  "coverLetter": "The full cover letter text with proper paragraph breaks",
  "openingLine": "The attention-grabbing first sentence",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3"],
  "personalizedElements": ["element1", "element2"],
  "suggestedSubjectLine": "Email subject line suggestion"
}`;

    const coverLetterUserPrompt = `Create a personalized cover letter based on this REWRITTEN resume and job:

OPTIMIZED RESUME:
${resumeResult.rewrittenResume}

JOB TITLE: ${jobTitle || 'Not specified'}
COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:
${jobDescription}` : ''}

Generate a compelling cover letter that connects my optimized experience to this role.`;

    const coverLetterResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: coverLetterSystemPrompt },
          { role: "user", content: coverLetterUserPrompt }
        ],
        max_tokens: 4000,
        temperature: 0.5,
      }),
    });

    if (!coverLetterResponse.ok) {
      const errorText = await coverLetterResponse.text();
      logStep("Cover letter AI API error", { status: coverLetterResponse.status, error: errorText });
      throw new Error(`Cover letter AI API error: ${coverLetterResponse.status}`);
    }

    const coverLetterAiResponse = await coverLetterResponse.json();
    const coverLetterContent = coverLetterAiResponse.choices?.[0]?.message?.content;

    if (!coverLetterContent) {
      throw new Error("No content in cover letter AI response");
    }

    let coverLetterResult;
    try {
      const jsonMatch = coverLetterContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        coverLetterResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in cover letter response");
      }
    } catch (parseError) {
      logStep("Cover letter JSON parse error", { error: String(parseError) });
      coverLetterResult = {
        coverLetter: coverLetterContent,
        openingLine: "",
        keySkillsHighlighted: [],
        personalizedElements: [],
        suggestedSubjectLine: `Application for ${jobTitle || 'Position'}${jobCompany ? ` at ${jobCompany}` : ''}`
      };
    }

    logStep("Cover letter generated");

    // Combine results
    const premiumPackageResult = {
      resume: resumeResult,
      coverLetter: coverLetterResult,
      originalResume: resumeText.substring(0, 2000) + (resumeText.length > 2000 ? '...' : ''), // Truncate for comparison
      jobDetails: {
        title: jobTitle || 'Not specified',
        company: jobCompany || 'Not specified'
      },
      generatedAt: new Date().toISOString()
    };

    logStep("Premium package complete", { 
      resumeLength: resumeResult.rewrittenResume?.length,
      coverLetterLength: coverLetterResult.coverLetter?.length
    });

    return new Response(
      JSON.stringify({ success: true, data: premiumPackageResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-PREMIUM-PACKAGE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to generate premium package", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
