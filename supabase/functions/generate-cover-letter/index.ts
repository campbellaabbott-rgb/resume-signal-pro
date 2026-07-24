// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateProseClaims } from "../_shared/resume-grounding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-COVER-LETTER] ${step}`, details ? JSON.stringify(details) : '');
};

// Retry and fallback configuration
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;

// Model fallback order
const MODEL_FALLBACK_ORDER = [
  'google/gemini-2.5-pro',
  'openai/gpt-5',
  'openai/gpt-5-mini',
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AIRequestOptions {
  messages: Array<{ role: string; content: string }>;
  max_completion_tokens?: number;
}

async function callAIWithFallback(
  apiKey: string,
  options: AIRequestOptions,
  context: string = 'AI call'
): Promise<{ response: Response; modelUsed: string }> {
  let lastError: Error | null = null;
  
  for (const model of MODEL_FALLBACK_ORDER) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        
        logStep(`${context} - trying ${model}`, { attempt: attempt + 1, model });
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: options.messages,
            max_completion_tokens: options.max_completion_tokens,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          logStep(`${context} - succeeded with ${model}`);
          return { response, modelUsed: model };
        }
        
        if (response.status === 429 || response.status === 402) {
          return { response, modelUsed: model };
        }
        
        if (response.status >= 400 && response.status < 500) {
          logStep(`${context} - client error, trying next model`, { status: response.status, model });
          break;
        }
        
        if (response.status >= 500) {
          logStep(`${context} - server error`, { status: response.status, model });
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logStep(`${context} - error with ${model}`, { error: errorMessage });
        lastError = error instanceof Error ? error : new Error(errorMessage);
        
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        break;
      }
    }
    logStep(`${context} - ${model} failed, trying next model`);
  }

  throw lastError || new Error('All AI models failed');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit per IP to prevent unauthenticated abuse
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const [{ data: allowed }, body] = await Promise.all([
    supabase.rpc("check_rate_limit", {
      p_function: "generate-cover-letter", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60
    }),
    req.json()
  ]);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // Deliberately not applying the site's UI language to the letter itself —
    // same reasoning as generate-apply-package: this is an externally-facing
    // application document submitted to an employer, not advisory content for
    // the candidate to read. The `language` field may still arrive in the
    // request body from shared call sites, but it's intentionally unused here.
    const { resumeText, jobDescription, jobTitle, jobCompany, tone = "professional", personalizationContext } = body;

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

    // Letter language matches the EMPLOYER's language (see the design note
    // above — this is an externally-facing document). A Spanish job posting
    // gets a Spanish letter; detection is a cheap stopword/accent heuristic
    // over the posting text, never the UI language.
    const jdSample = `${jobDescription || ""} ${jobTitle || ""}`.toLowerCase();
    const spanishSignals = (jdSample.match(/[áéíóúñü]/g) || []).length +
      (jdSample.match(/\b(el|la|los|las|de|del|para|con|empresa|puesto|experiencia|requisitos|buscamos|responsabilidades)\b/g) || []).length;
    const englishSignals = (jdSample.match(/\b(the|and|with|for|experience|requirements|responsibilities|we|you|team)\b/g) || []).length;
    const jobIsSpanish = spanishSignals >= 8 && spanishSignals > englishSignals * 1.5;
    const languageNote = jobIsSpanish
      ? "\n\nLANGUAGE: The job posting is in Spanish. Write the ENTIRE letter in natural, professional Spanish (español) — not a translation-sounding letter. Keep company and product names as given."
      : "";

    const systemPrompt = `You are a former hiring manager at Google, Amazon, and McKinsey who now coaches executives on personal branding. You've written thousands of cover letters that landed interviews. Your letters sound like they were written by a thoughtful, articulate human - not AI.${languageNote}

## NO PLACEHOLDERS — THE LETTER MUST BE SEND-READY
- NEVER output bracketed fill-ins like [Hiring Manager Name], [Company Name], or [mention a specific...]. The buyer should be able to send this letter without editing a single bracket.
- If the hiring manager's name is unknown, open with "Dear Hiring Manager,".
- If the company name or company specifics are unknown, write naturally and generically about "your team" and the ROLE's challenges (from the job description) — do not gesture at facts you don't have.
- If a job description IS provided, mine IT for the company-specific paragraph instead of asking the reader to fill blanks.

## GROUNDING — ONLY THE CANDIDATE'S REAL FACTS
- Every metric, outcome, and claim about the candidate must appear in their resume. Never invent outcomes ("increased demo requests", "grew revenue") that the resume doesn't state.
- You may connect and frame real facts; you may not extend them.

${personalizationContext ? `CANDIDATE CONTEXT:
${personalizationContext}

Adjust voice and sophistication to match their experience level.` : ''}

## ⚠️ QUALITY BAR: EXECUTIVE-LEVEL WRITING ⚠️
We've received feedback that cover letters "look obviously written by a weak AI model." This is unacceptable.

Your writing must:
- Sound like a ${toneDesc} professional wrote it
- Include SPECIFIC details and metrics from the resume
- Have varied, sophisticated sentence structure  
- Show genuine insight about the role/company
- Feel personal and authentic, never generic

## CRITICAL WRITING RULES:

### NEVER USE THESE AI-SOUNDING PATTERNS:
- "I am writing to express my interest in..."
- "I was excited to see your posting..."
- "I believe I would be a great fit..."
- "I am passionate about..."
- "I am confident that..."
- "I am eager to..."
- Generic adjectives: dynamic, innovative, cutting-edge, synergy, leverage

### INSTEAD, WRITE LIKE THIS:
- Start with a specific achievement or insight
- Use the candidate's actual voice and experience level
- Reference concrete numbers and accomplishments from their resume
- Show understanding of the specific company's challenges
- Sound like someone the hiring manager would want to have coffee with

## STRUCTURE (350-450 words, 4 paragraphs):

**Opening Hook (3-4 sentences)**: Lead with something memorable - a specific achievement, insight about their industry, or genuine connection to the company.

**Achievement Paragraph (5-6 sentences)**: Connect 2-3 SPECIFIC experiences to the role using REAL numbers from the resume. Tell a brief story of impact.

**Company Fit Paragraph (4-5 sentences)**: Why THIS company and role? Show genuine understanding and cultural alignment.

**Confident Close (2-3 sentences)**: Forward-looking, confident, not desperate.

## LANGUAGE QUALITY:
- Use contractions naturally (I'm, I've, we'd)
- Mix sentence lengths strategically
- Include genuine personality
- Be specific with real numbers and company names
- AVOID: synergy, leverage, passionate, excited, dynamic, utilize, endeavor

Respond with valid JSON:
{
  "coverLetter": "The complete 350-450 word cover letter. Must sound authentically human and reference specific resume details.",
  "openingLine": "The attention-grabbing first sentence",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3", "skill4"],
  "personalizedElements": ["specific detail about candidate", "specific detail about company"],
  "suggestedSubjectLine": "Specific, memorable subject line",
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

    logStep("Calling AI API with fallback");

    const { response, modelUsed } = await callAIWithFallback(
      apiKey,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_completion_tokens: 4000,
      },
      'Cover letter generation'
    );

    if (!response.ok) {
      const errorText = await response.text();
      logStep("AI API error", { status: response.status, error: errorText, model: modelUsed });
      
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
    logStep("AI response received", { model: modelUsed });

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

    // Grounding gate: refuse to deliver a letter whose figures aren't on the
    // resume — same honesty fence as the tailored-resume validator.
    const proseIssues = validateProseClaims(resumeText ?? "", String(result.coverLetter ?? ""));
    if (proseIssues.length > 0) {
      logStep("Cover letter rejected by grounding", { issues: proseIssues.slice(0, 5) });
      return new Response(
        JSON.stringify({
          error: "The draft cited figures that aren't on your resume, so we refused to deliver it. Try again — regeneration is free.",
          retryable: true,
          groundingIssues: proseIssues.slice(0, 5),
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Cover letter generated", {
      letterLength: result.coverLetter?.length,
      skillsCount: result.keySkillsHighlighted?.length,
      modelUsed 
    });

    return new Response(
      JSON.stringify({ success: true, data: result, modelUsed }),
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

    if (errorMessage.includes('All AI models failed')) {
      return new Response(
        JSON.stringify({ error: "The AI service is temporarily unavailable. Please try again in a few minutes.", retryable: true }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Failed to generate cover letter", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
