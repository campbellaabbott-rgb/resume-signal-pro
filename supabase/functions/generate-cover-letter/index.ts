import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-COVER-LETTER] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, jobDescription, jobTitle, jobCompany, tone = "professional", personalizationContext } = await req.json();

    if (!resumeText) {
      return new Response(
        JSON.stringify({ error: "Resume text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!jobDescription && !jobTitle) {
      return new Response(
        JSON.stringify({ error: "Job description or job title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Starting cover letter generation", { 
      jobTitle,
      jobCompany,
      tone,
      hasPersonalization: !!personalizationContext,
      resumeLength: resumeText?.length 
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const toneDescriptions: Record<string, string> = {
      professional: "formal, polished, and business-appropriate",
      enthusiastic: "energetic, passionate, and eager while remaining professional",
      confident: "assertive, accomplished, and self-assured without being arrogant",
      conversational: "friendly, approachable, and personable while staying professional"
    };

    const toneDesc = toneDescriptions[tone] || toneDescriptions.professional;

    const systemPrompt = `You are an expert cover letter writer who creates compelling, personalized cover letters that get interviews.

${personalizationContext ? `CANDIDATE CONTEXT (use this to deeply personalize the cover letter):
${personalizationContext}

Use this context to tailor the language, achievements to highlight, and overall positioning to match their career stage and industry.` : ''}

Your cover letters should:
1. Open with a strong, attention-grabbing hook (not "I am writing to apply...")
2. Connect the candidate's experience directly to the job requirements
3. Show enthusiasm for the specific company and role
4. Include specific achievements with metrics when possible
5. Close with a confident call to action
6. Be ${toneDesc}
7. Be 250-350 words (3-4 paragraphs)
8. Match the candidate's experience level - entry-level should sound eager to learn, senior should emphasize leadership

You MUST respond with a valid JSON object:
{
  "coverLetter": "The full cover letter text with proper paragraph breaks",
  "openingLine": "The attention-grabbing first sentence",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3"],
  "personalizedElements": ["element1", "element2"],
  "suggestedSubjectLine": "Email subject line suggestion",
  "alternateOpenings": ["alternative opening 1", "alternative opening 2"]
}`;

    const userPrompt = `Create a personalized cover letter based on this resume and job:

RESUME:
${resumeText}

JOB TITLE: ${jobTitle || 'Not specified'}
COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:
${jobDescription}` : ''}

REQUESTED TONE: ${tone}

Generate a compelling cover letter that connects my experience to this role.`;

    logStep("Calling AI API");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 3000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText });
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    logStep("AI response received");

    const content = aiResponse.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content in AI response");
    }

    // Parse JSON from response
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      logStep("JSON parse error, extracting cover letter", { error: String(parseError) });
      // If parsing fails, use the content as the cover letter
      result = {
        coverLetter: content,
        openingLine: content.split('\n')[0] || "",
        keySkillsHighlighted: [],
        personalizedElements: [],
        suggestedSubjectLine: `Application for ${jobTitle || 'Position'}${jobCompany ? ` at ${jobCompany}` : ''}`,
        alternateOpenings: []
      };
    }

    logStep("Cover letter generated", { 
      letterLength: result.coverLetter?.length,
      skillsCount: result.keySkillsHighlighted?.length 
    });

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-COVER-LETTER] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to generate cover letter", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
