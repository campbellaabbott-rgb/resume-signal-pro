import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-PREMIUM-PACKAGE] ${step}`, details ? JSON.stringify(details) : '');
};

// Retry configuration
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds cap
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
      
      const startTime = Date.now();
      logStep(`API call attempt ${attempt + 1}/${maxRetries + 1}`, { url: url.substring(0, 50) });
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      // If successful or client error (4xx), return immediately
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        logStep(`API call succeeded`, { attempt: attempt + 1, duration, status: response.status });
        return response;
      }
      
      // Server errors (5xx) - retry
      if (response.status >= 500) {
        const errorText = await response.text();
        logStep(`Server error, will retry`, { attempt: attempt + 1, status: response.status, error: errorText.substring(0, 200) });
        lastError = new Error(`Server error: ${response.status}`);
        
        if (attempt < maxRetries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      }
      
      return response;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Timeout or network error
      if (errorMessage.includes('aborted') || errorMessage.includes('timeout')) {
        logStep(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`, { attempt: attempt + 1 });
        lastError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      } else {
        logStep(`Network error`, { attempt: attempt + 1, error: errorMessage });
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
    
    const resumeSystemPrompt = `You are an elite ATS resume optimization specialist. Your ONLY task is to ENHANCE the provided resume while preserving 100% of the original content.

## ⚠️ CRITICAL DATA ACCURACY RULES - ABSOLUTE REQUIREMENTS ⚠️
These rules MUST be followed perfectly. Violations are unacceptable:

### NUMBERS & METRICS:
- COPY ALL NUMBERS EXACTLY: "$20,000,000" stays "$20,000,000" (not "$20,,000" or "$,000")
- Percentages: "100%" not "%+", "~1.5x" not "1.5"
- Counts: "67 warehouses" with space (not "across67 warehouses")
- Dollar amounts: "$400,000" not "$,000" or truncated values

### COMPANY & PRODUCT NAMES:
- "GitHub" NOT "Git"
- "LinkedIn" NOT "Linked"
- "Fortune 500" NOT "Fortune"
- "GitHub Copilot" NOT "GitHub Cop" or "GitHub Cop (OpenAI)"
- "GitHub Actions" NOT "Git Actions"
- "GitHub Enterprise" NOT "GitHub ("
- "Codespaces" NOT "Codes)"
- "LinkedIn Sales Navigator" NOT "Linked Sales Navigator"
- "CI/CD" NOT "/CD" or "including/CD"
- "Carnegie Mellon" NOT "Carnegie Mellonator"

### JOB TITLES:
- "Senior Sales Development Rep" NOT "Senior Sales Development"
- "Outreach Manager" NOT "Outreach"
- "Full-Cycle Enterprise Sales" NOT "Full-C Enterprise Sales"
- "Lead Generation" NOT orphaned "Generation"

### TEXT QUALITY:
- NEVER truncate words or add random punctuation
- NEVER drop letters, numbers, or spaces
- Every bullet point must be grammatically complete
- Proper spacing between ALL words and numbers
- No broken phrases like "0-to- go-to-market" (should be "0-to-1 go-to-market")
- No garbled text like "highpensity" (should be "high-propensity")
- No missing verbs: "wrote a LinkedIn article" NOT "a LinkedIn article"

## ⚠️ ABSOLUTE NON-NEGOTIABLE RULES ⚠️

### RULE 1: ZERO CONTENT REMOVAL
- You MUST include EVERY SINGLE job/position from the original resume
- You MUST include EVERY SINGLE education entry
- You MUST include EVERY SINGLE project mentioned
- You MUST include EVERY SINGLE certification/award
- You MUST include EVERY bullet point (enhanced, but present)
- If the original has 5 jobs, your output MUST have 5 jobs
- If the original has 15 bullet points, your output MUST have AT LEAST 15 bullet points

### RULE 2: LENGTH PRESERVATION
- Your output MUST be AT LEAST as long as the input
- If the input is 800 words, output must be 800+ words
- DO NOT summarize or condense - EXPAND and ENHANCE
- A shorter output = FAILURE

### RULE 3: ENHANCE, NEVER DELETE
- Improve wording of EXISTING content
- Add relevant keywords naturally INTO existing bullets
- Quantify achievements where you can infer reasonable metrics
- Strengthen action verbs
- DO NOT remove details to "tighten" or "streamline"

## WHAT YOU SHOULD DO:
1. **Professional Summary**: Write a compelling 3-4 sentence summary (ADD this if missing)
2. **Each Job**: Keep ALL jobs, enhance EVERY bullet point with stronger verbs and keywords
3. **Skills Section**: Create comprehensive skills section with ATS keywords
4. **Education**: Keep ALL entries, add relevant coursework/achievements if helpful
5. **Projects/Certs**: Keep ALL, enhance descriptions

## OUTPUT FORMAT:
Respond with valid JSON:
{
  "rewrittenResume": "The COMPLETE rewritten resume. MUST include ALL original content, enhanced. Should be LONGER than the original.",
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
  "preservedSections": ["list of all sections from original that were kept"],
  "contentVerification": {
    "originalJobCount": number,
    "outputJobCount": number,
    "originalBulletCount": number,
    "outputBulletCount": number
  }
}`;

    const resumeUserPrompt = `ENHANCE this resume for the target position. 

⚠️ CRITICAL: This is an ENHANCEMENT task, NOT a rewrite. You must:
- Keep EVERY job, education, project, and experience
- Keep EVERY bullet point (enhanced wording)
- Output must be EQUAL OR LONGER than the original
- Count the jobs in the input and ensure the same count in output

ORIGINAL RESUME TO ENHANCE (DO NOT REMOVE ANY CONTENT):
${resumeText}

TARGET JOB TITLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION (use keywords from this):
${jobDescription}` : 'No job description provided - optimize for general professional excellence.'}

BEFORE YOU RESPOND: Count all jobs, education entries, and major bullet points in the original. Your output MUST contain ALL of them, enhanced.`;

    const resumeResponse = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: resumeSystemPrompt },
          { role: "user", content: resumeUserPrompt }
        ],
        max_completion_tokens: 12000,
      }),
    });

    if (!resumeResponse.ok) {
      const errorText = await resumeResponse.text();
      logStep("Resume AI API error", { status: resumeResponse.status, error: errorText });
      
      if (resumeResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (resumeResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI service credits depleted. Please contact support.", retryable: false }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
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

    const coverLetterSystemPrompt = `You are a senior executive recruiter and career coach who has helped thousands of professionals land roles at top companies. You write cover letters that sound authentically human - the way a confident, articulate professional would speak about themselves.

## CRITICAL RULES - YOU MUST FOLLOW THESE:
- Write COMPLETE, COHERENT sentences with proper grammar
- NEVER use placeholder text, variables, or incomplete phrases
- NEVER write things like "building -1" or "1-N" or mathematical notation
- Spell out all company names correctly (e.g., "Carnegie Mellon" not "Carnegie Mellonator")
- Use SPECIFIC details from the resume - real job titles, real company names, real achievements
- Every sentence must be grammatically complete and make logical sense
- Proofread: no missing words, no garbled text, no incomplete thoughts

## YOUR WRITING STYLE:
- Write like a real person, not like AI or a template
- Use natural language with personality
- Vary sentence structure - mix short punchy sentences with longer flowing ones
- Include subtle confidence without being boastful
- Show genuine enthusiasm that doesn't sound manufactured
- Reference specific details from the resume that show deep understanding

## STRUCTURE (300-400 words, 4 paragraphs):

**Opening (2-3 sentences)**: Hook with a specific achievement, insight about the company, or unique angle. NEVER start with "I am writing to apply" or "I was excited to see."

**Body Paragraph 1 (4-5 sentences)**: Connect 2-3 specific experiences from their resume to the role. Use concrete examples with metrics. Show how their background uniquely positions them.

**Body Paragraph 2 (3-4 sentences)**: Address what excites them about THIS specific company/role. Reference something real about the company if possible. Show culture fit.

**Closing (2-3 sentences)**: Confident call to action. Express genuine interest in discussing further. Don't be desperate or overly formal.

## TONE RULES:
- Sound like a confident peer, not a desperate applicant
- Be specific, not generic
- Show personality
- Avoid buzzwords: "synergy," "leverage," "passionate about," "excited to," "dynamic"
- Use contractions naturally (I'm, I've, I'd)
- Include one moment of personality or light humor if appropriate

You MUST respond with valid JSON:
{
  "coverLetter": "The full cover letter with proper paragraph breaks. Should sound human, specific, and confident.",
  "openingLine": "The hook that grabs attention",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3"],
  "personalizedElements": ["specific thing about candidate", "specific thing about company"],
  "suggestedSubjectLine": "Email subject line - be specific, not generic",
  "whyThisWorks": "Brief explanation of the strategy used"
}`;

    const coverLetterUserPrompt = `Write a compelling, human-sounding cover letter for this candidate and role:

CANDIDATE'S RESUME (use specific details from this):
${resumeResult.rewrittenResume}

TARGET ROLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB REQUIREMENTS:
${jobDescription}` : ''}

Write a cover letter that sounds like it was written by this specific person - confident, articulate, and genuine. Reference specific experiences from their resume with concrete details.`;

    const coverLetterResponse = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: coverLetterSystemPrompt },
          { role: "user", content: coverLetterUserPrompt }
        ],
        max_completion_tokens: 4000,
      }),
    });

    if (!coverLetterResponse.ok) {
      const errorText = await coverLetterResponse.text();
      logStep("Cover letter AI API error", { status: coverLetterResponse.status, error: errorText });
      
      if (coverLetterResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
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
    
    // Check for timeout errors and return a more helpful message
    if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({ 
          error: "The AI took too long to respond. Please try again.", 
          details: errorMessage,
          retryable: true 
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: "Failed to generate premium package", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
