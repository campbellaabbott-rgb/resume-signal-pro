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
    
    const resumeSystemPrompt = `You are an expert ATS resume writer who creates highly optimized, professional resumes that pass Applicant Tracking Systems and impress hiring managers.

Your task is to completely rewrite and optimize the provided resume for the target job. You must:

1. **ATS Optimization**: Include relevant keywords from the job description naturally throughout
2. **Quantify Achievements**: Add metrics and numbers wherever possible (%, $, #)
3. **Strong Action Verbs**: Start each bullet with powerful, varied action verbs
4. **Tailored Content**: Reorganize and prioritize experience most relevant to the target role
5. **Clean Format**: Use a clear, ATS-friendly structure with consistent formatting
6. **Professional Summary**: Write a compelling 2-3 sentence summary tailored to the role
7. **Skills Section**: Create a keyword-rich skills section matching job requirements

You MUST respond with a valid JSON object:
{
  "rewrittenResume": "The complete rewritten resume in clean text format with sections clearly marked",
  "professionalSummary": "The new professional summary (2-3 sentences)",
  "keyChanges": [
    { "section": "string", "before": "brief description of original", "after": "brief description of improvement", "reason": "why this change matters" }
  ],
  "addedKeywords": ["keyword1", "keyword2", ...],
  "atsScore": {
    "before": number (0-100 estimate),
    "after": number (0-100 estimate),
    "improvement": "explanation of score improvement"
  },
  "highlights": ["key improvement 1", "key improvement 2", ...]
}`;

    const resumeUserPrompt = `Rewrite and optimize this resume for the target position:

ORIGINAL RESUME:
${resumeText}

TARGET JOB TITLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:
${jobDescription}` : 'No job description provided - optimize for general professional excellence in this field.'}

Create a complete, ATS-optimized rewrite of this resume.`;

    const resumeResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: resumeSystemPrompt },
          { role: "user", content: resumeUserPrompt }
        ],
        max_tokens: 6000,
        temperature: 0.4,
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
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: coverLetterSystemPrompt },
          { role: "user", content: coverLetterUserPrompt }
        ],
        max_tokens: 3000,
        temperature: 0.7,
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
