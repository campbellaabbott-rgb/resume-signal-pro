import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-COVER-LETTER] ${step}`, details ? JSON.stringify(details) : '');
};

// Retry configuration
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 60000;
const RETRY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries = MAX_RETRIES
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      
      logStep(`API call attempt ${attempt + 1}/${maxRetries + 1}`);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      
      if (response.status >= 500 && attempt < maxRetries) {
        const errorText = await response.text();
        logStep(`Server error ${response.status}, retrying...`, { error: errorText.substring(0, 200) });
        lastError = new Error(`Server error: ${response.status}`);
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      
      return response;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('aborted')) {
        logStep(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        lastError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      } else {
        logStep(`Network error: ${errorMessage}`);
        lastError = error instanceof Error ? error : new Error(errorMessage);
      }
      
      if (attempt < maxRetries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

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

    const systemPrompt = `You are a senior executive recruiter who has placed thousands of candidates at top companies. You write cover letters that sound authentically human - the way a confident, articulate professional would actually speak about themselves.

${personalizationContext ? `CANDIDATE CONTEXT:
${personalizationContext}

Use this to match their voice and experience level.` : ''}

## YOUR WRITING PHILOSOPHY:
- Write like a REAL PERSON, not like AI or a corporate template
- Sound ${toneDesc}
- Use natural, varied sentence structures
- Show genuine confidence without arrogance
- Reference SPECIFIC details from the resume
- Never sound desperate or overly formal

## STRUCTURE (300-400 words):

**Opening Hook (2-3 sentences)**: Start with something specific - an achievement, insight about the company, or unique angle. NEVER start with:
- "I am writing to apply..."
- "I was excited to see..."
- "I am reaching out..."
- "I came across..."

**Body 1 (4-5 sentences)**: Connect 2-3 specific experiences to the role. Use concrete examples with real metrics from their resume.

**Body 2 (3-4 sentences)**: Why THIS company and role specifically. Show you understand their mission/culture.

**Close (2-3 sentences)**: Confident, not desperate. "I'd welcome the chance to discuss..." not "I hope you'll consider..."

## LANGUAGE RULES:
- Use contractions naturally (I'm, I've, we'd)
- Vary sentence length
- Include specific numbers and details from resume
- AVOID: synergy, leverage, passionate, excited, dynamic, utilize, endeavor
- Sound like someone you'd want to grab coffee with

Respond with valid JSON:
{
  "coverLetter": "The full cover letter. Must sound human and specific.",
  "openingLine": "The attention-grabbing hook",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3"],
  "personalizedElements": ["specific detail about candidate", "specific detail about company"],
  "suggestedSubjectLine": "Specific, not generic subject line",
  "alternateOpenings": ["alternative hook 1", "alternative hook 2"]
}`;

    const userPrompt = `Write a compelling, human-sounding cover letter.

CANDIDATE'S RESUME (use specific details from this):
${resumeText}

TARGET ROLE: ${jobTitle || 'Not specified'}
COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB REQUIREMENTS:
${jobDescription}` : ''}

TONE: ${tone}

Write something that sounds like this specific person wrote it - confident, specific, genuine. Reference their actual experiences with concrete details.`;

    logStep("Calling AI API");

    const response = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_completion_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText });
      
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
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    logStep("AI response received");

    const content = aiResponse.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content in AI response");
    }

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
    
    if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: "Failed to generate cover letter", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
