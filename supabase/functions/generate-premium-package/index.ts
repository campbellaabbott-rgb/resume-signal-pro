// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { assertPaidSession } from "../_shared/paid-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-PREMIUM-PACKAGE] ${step}`, details ? JSON.stringify(details) : '');
};

// Auto-fix common AI corruption patterns
const autoFixContent = (content: string, originalResume: string): { fixed: string, corrections: string[] } => {
  let fixed = content;
  const corrections: string[] = [];

  // Fix double commas
  if (/,,+/.test(fixed)) {
    fixed = fixed.replace(/,,+/g, ',');
    corrections.push('Fixed double commas');
  }

  // Fix malformed dollar amounts like $20,,000 → $20,000
  if (/\$\d+,,\d/.test(fixed)) {
    fixed = fixed.replace(/(\$\d+),,(\d)/g, '$1,$2');
    corrections.push('Fixed malformed dollar amounts');
  }

  // Fix truncated dollar amounts $,000 - try to find correct value from original
  const truncatedDollar = fixed.match(/\$,(\d{3})/g);
  if (truncatedDollar) {
    // Try to find the full amount in original
    const originalAmounts = originalResume.match(/\$[\d,]+/g) || [];
    for (const truncated of truncatedDollar) {
      const suffix = truncated.slice(2); // e.g., "000" from "$,000"
      const match = originalAmounts.find(a => a.endsWith(suffix));
      if (match) {
        fixed = fixed.replace(truncated, match);
        corrections.push(`Restored ${truncated} to ${match}`);
      }
    }
  }

  // Fix missing space before numbers (e.g., "across67" → "across 67")
  fixed = fixed.replace(/([a-zA-Z])(\d{2,})/g, (match, letter, num) => {
    // Don't fix things like "gpt5" or version numbers
    if (/^[a-z]$/.test(letter) && /^\d{1,2}$/.test(num)) return match;
    corrections.push(`Added space: ${match} → ${letter} ${num}`);
    return `${letter} ${num}`;
  });

  // Fix truncated CI/CD
  if (/\/CD\b/i.test(fixed) && !/CI\/CD/i.test(fixed)) {
    fixed = fixed.replace(/\b\/CD\b/gi, 'CI/CD');
    corrections.push('Fixed truncated CI/CD');
  }

  // Fix "including/CD" → "including CI/CD"
  fixed = fixed.replace(/including\s*\/CD/gi, 'including CI/CD');

  // Fix truncated GitHub (Git without Hub following)
  fixed = fixed.replace(/\bGit\b(?!\s*(Hub|Lab|Actions|Flow|Kraken|ignore|config))/gi, 'GitHub');
  if (content !== fixed && /\bGit\b/.test(content)) {
    corrections.push('Fixed truncated Git → GitHub');
  }

  // Fix truncated LinkedIn
  fixed = fixed.replace(/\bLinked\b(?!\s*(In|Sales|List))/gi, 'LinkedIn');
  if (content !== fixed && /\bLinked\b/.test(content)) {
    corrections.push('Fixed truncated Linked → LinkedIn');
  }

  // Fix Fortune without 500
  if (originalResume.includes('Fortune 500') && /Fortune\b(?!\s*\d)/.test(fixed)) {
    fixed = fixed.replace(/Fortune\b(?!\s*\d)/gi, 'Fortune 500');
    corrections.push('Added missing Fortune 500');
  }

  // Fix broken percentage %+
  if (/%\+/.test(fixed)) {
    fixed = fixed.replace(/%\+/g, '%');
    corrections.push('Fixed broken percentage');
  }

  // Fix empty/malformed parentheses
  fixed = fixed.replace(/\(\s*,\s*\)/g, '');
  fixed = fixed.replace(/\(\s*\)/g, '');

  // Fix "building -1" or similar nonsense
  fixed = fixed.replace(/building\s*-\s*\d+/gi, 'building');
  
  // Fix broken hyphenated phrases like "0-to- go-to-market"
  fixed = fixed.replace(/(\d+)-to-\s+/g, '$1-to-');

  // Fix Codes) → Codespaces (if original has Codespaces)
  if (originalResume.includes('Codespaces') && /\bCodes\)/.test(fixed)) {
    fixed = fixed.replace(/\bCodes\)/g, 'Codespaces');
    corrections.push('Fixed truncated Codespaces');
  }

  // Fix GitHub Cop → GitHub Copilot
  if (originalResume.includes('Copilot') && /GitHub\s+Cop\b/.test(fixed)) {
    fixed = fixed.replace(/GitHub\s+Cop\b/g, 'GitHub Copilot');
    corrections.push('Fixed truncated Copilot');
  }

  // Fix Git Actions → GitHub Actions
  if (/\bGit\s+Actions\b/.test(fixed)) {
    fixed = fixed.replace(/\bGit\s+Actions\b/g, 'GitHub Actions');
    corrections.push('Fixed Git Actions → GitHub Actions');
  }

  // Fix Full-C → Full-Cycle
  if (originalResume.includes('Full-Cycle') && /Full-C\b/.test(fixed)) {
    fixed = fixed.replace(/Full-C\b/g, 'Full-Cycle');
    corrections.push('Fixed truncated Full-Cycle');
  }

  if (corrections.length > 0) {
    console.log(`[AUTO-FIX] Applied ${corrections.length} corrections:`, corrections);
  }

  return { fixed, corrections };
};

// Post-processing validation for common AI corruption patterns
const validateContent = (content: string, originalResume: string): { issues: string[], score: number } => {
  const issues: string[] = [];
  
  // Pattern checks
  const patterns = [
    { regex: /,,+/g, name: 'double_comma', desc: 'Double commas found' },
    { regex: /\$,\d/g, name: 'truncated_dollar', desc: 'Truncated dollar amount ($,XXX)' },
    { regex: /\$\d+,,\d/g, name: 'malformed_dollar', desc: 'Malformed dollar amount' },
    { regex: /[a-zA-Z]\d{2,}/g, name: 'missing_space_before_number', desc: 'Missing space before number' },
    { regex: /\d{2,}[a-zA-Z]/g, name: 'missing_space_after_number', desc: 'Missing space after number' },
    { regex: /[A-Za-z]+\)/g, name: 'truncated_word', desc: 'Possible truncated word ending in )' },
    { regex: /\([,\s]*\)/g, name: 'empty_parens', desc: 'Empty or malformed parentheses' },
    { regex: /\/CD\b/gi, name: 'truncated_cicd', desc: 'Truncated CI/CD' },
    { regex: /\bGit\b(?!\s*(Hub|Lab|Actions|Flow|Kraken))/gi, name: 'truncated_github', desc: 'Possible truncated GitHub' },
    { regex: /\bLinked\b(?!\s*(In|Sales|List))/gi, name: 'truncated_linkedin', desc: 'Possible truncated LinkedIn' },
    { regex: /Fortune\b(?!\s*\d)/gi, name: 'missing_fortune_number', desc: 'Fortune without number (e.g., Fortune 500)' },
    { regex: /\b\d+-to-\s+/g, name: 'broken_hyphen_phrase', desc: 'Broken hyphenated phrase' },
    { regex: /building\s*-?\d/gi, name: 'nonsense_building', desc: 'Nonsensical "building -1" pattern' },
    { regex: /\b[A-Z][a-z]+ator\b/g, name: 'garbled_name', desc: 'Possible garbled name (ending in -ator)' },
    { regex: /%\+/g, name: 'broken_percentage', desc: 'Broken percentage (%+)' },
  ];

  for (const { regex, name, desc } of patterns) {
    const matches = content.match(regex);
    if (matches && matches.length > 0) {
      // Filter out false positives for some patterns
      if (name === 'truncated_word' && matches.every(m => ['Actions)', 'Codespaces)'].includes(m))) continue;
      
      issues.push(`${desc}: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? '...' : ''}`);
    }
  }

  // Check if key terms from original are preserved
  const keyTerms = ['GitHub', 'LinkedIn', 'CI/CD', 'Fortune 500', 'Copilot', 'Actions'];
  for (const term of keyTerms) {
    if (originalResume.includes(term) && !content.includes(term)) {
      issues.push(`Missing key term: ${term}`);
    }
  }

  // Calculate quality score (100 = perfect, lower = more issues)
  const score = Math.max(0, 100 - (issues.length * 10));

  if (issues.length > 0) {
    console.log(`[VALIDATION] Found ${issues.length} potential issues:`, issues);
  }

  return { issues, score };
};

// Retry and fallback configuration
const MAX_RETRIES = 1; // Reduced since we have model fallback
const REQUEST_TIMEOUT_MS = 55000; // 55 seconds per model attempt
const RETRY_DELAY_MS = 1000;

// Model fallback order: primary -> same-quality different provider -> faster model
const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',           // Primary: best quality
  'google/gemini-2.5-pro',  // Fallback 1: same quality, different provider
  'openai/gpt-5-mini',      // Fallback 2: faster, slightly lower quality
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AIRequestOptions {
  messages: Array<{ role: string; content: string }>;
  max_completion_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
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
        
        const startTime = Date.now();
        logStep(`${context} - trying ${model}`, { attempt: attempt + 1, model });
        
        const requestBody: Record<string, unknown> = {
          model,
          messages: options.messages,
        };
        
        if (options.max_completion_tokens) {
          requestBody.max_completion_tokens = options.max_completion_tokens;
        }
        if (options.tools) {
          requestBody.tools = options.tools;
        }
        if (options.tool_choice) {
          requestBody.tool_choice = options.tool_choice;
        }
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        
        // Success
        if (response.ok) {
          logStep(`${context} - succeeded with ${model}`, { duration, model });
          return { response, modelUsed: model };
        }
        
        // Rate limit or payment required - don't retry, don't fallback
        if (response.status === 429 || response.status === 402) {
          logStep(`${context} - rate limit/payment issue`, { status: response.status, model });
          return { response, modelUsed: model };
        }
        
        // Client error (4xx) - don't retry same model, try fallback
        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text();
          logStep(`${context} - client error, trying next model`, { status: response.status, error: errorText.substring(0, 100), model });
          lastError = new Error(`Client error ${response.status}: ${errorText.substring(0, 100)}`);
          break; // Try next model
        }
        
        // Server error (5xx) - retry same model once, then fallback
        if (response.status >= 500) {
          const errorText = await response.text();
          logStep(`${context} - server error`, { status: response.status, attempt: attempt + 1, model });
          lastError = new Error(`Server error: ${response.status}`);
          
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break; // Try next model
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('aborted')) {
          logStep(`${context} - timeout with ${model}`, { model });
          lastError = new Error(`Timeout with ${model}`);
        } else {
          logStep(`${context} - network error with ${model}`, { error: errorMessage, model });
          lastError = error instanceof Error ? error : new Error(errorMessage);
        }
        
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break; // Try next model
      }
    }
    
    logStep(`${context} - ${model} failed, trying next model`);
  }
  
  // All models failed
  throw lastError || new Error('All AI models failed');
}

// Legacy function for backward compatibility
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
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }
      
      if (response.status >= 500 && attempt < maxRetries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      
      return response;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
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

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-premium-package", p_ip: clientIp, p_max_requests: 20, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Deliberately not applying the site's UI language here — this product's
    // core output (rewrittenResume) is an externally-facing document the
    // candidate would actually submit to employers, same reasoning as
    // generate-apply-package and generate-cover-letter. Translating it into
    // the UI's language regardless of the candidate's actual job-search
    // language could quietly damage their real resume.
    const { resumeText, jobDescription, jobTitle, jobCompany, sessionId } = await req.json();

    // PAID CONTENT. verify_jwt=false, so without this anyone could POST
    // resumeText and receive the full package free, on our AI spend. The
    // -stream twin has had this gate since July; this primary — the one the
    // webhook and the success page actually call — never got it.
    //
    // Safe to gate UNCONDITIONALLY because every caller is post-purchase
    // (stripe-webhook, verify-product-purchase, retry-failed-deliveries,
    // ProductSuccess). That is NOT true of generate-cover-letter or
    // generate-tailored-resume, which the public job board calls for free with
    // an identical body shape — gating those would break the board.
    const paidError = await assertPaidSession(supabase, sessionId);
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
    
    const resumeSystemPrompt = `You are an elite ATS resume optimization specialist. Your task is to ENHANCE and EXPAND the resume while preserving 100% of the original content.

## ⚠️ CRITICAL: CONTENT LENGTH REQUIREMENT ⚠️
The #1 complaint we receive is "you shrunk my resume." This is UNACCEPTABLE.

YOUR OUTPUT MUST BE AT LEAST AS LONG AS THE INPUT:
- If the input is 800 words, output MUST be 800+ words
- If there are 5 jobs, output MUST have 5 jobs with MORE detail
- If there are 15 bullet points, output MUST have 15+ bullet points
- NEVER summarize, condense, or "streamline"
- Add context and keywords to EXPAND existing content

## ⚠️ CRITICAL DATA ACCURACY RULES ⚠️
COPY ALL DATA EXACTLY FROM THE ORIGINAL:

### CONTACT LINE — COPY ONLY, NEVER ADD:
- The contact header may contain ONLY items present in the original resume
- NEVER invent or add a LinkedIn URL, portfolio, website, phone number, or email that isn't in the original — a fabricated linkedin.com/in/... link is a firing offense
- If the original has no LinkedIn, the rewrite has no LinkedIn. Same for every contact field
- NEVER output bracketed placeholders like [LinkedIn] or [Phone]

### NUMBERS & METRICS:
- "$20,000,000" stays "$20,000,000" (NEVER "$20,,000" or "$,000")
- "67 warehouses" with proper spacing (NEVER "across67")
- "100%" not "%+", percentages must be complete
- Dollar amounts must be complete and properly formatted

### COMPANY & PRODUCT NAMES (common truncation errors to AVOID):
- "GitHub" NOT "Git" | "LinkedIn" NOT "Linked"
- "Fortune 500" NOT "Fortune" | "CI/CD" NOT "/CD"
- "GitHub Copilot" NOT "GitHub Cop" | "GitHub Actions" NOT "Git Actions"
- "Codespaces" NOT "Codes)" | "Carnegie Mellon" NOT "Carnegie Mellonator"

### JOB TITLES - NEVER TRUNCATE:
- "Senior Sales Development Rep" NOT "Senior Sales Development"
- "Full-Cycle Enterprise Sales" NOT "Full-C Enterprise Sales"

## ENHANCEMENT STRATEGY (EXPAND, NEVER CONTRACT):

### For EACH Experience:
1. Keep the FULL original description
2. ADD relevant industry keywords naturally woven in
3. EXPAND bullet points with more context (don't replace, enhance)
4. QUANTIFY achievements where reasonable (infer if not present)
5. STRENGTHEN action verbs

### What to ADD:
- Professional summary (3-4 sentences) if missing
- Skills section with comprehensive ATS keywords
- Additional context to existing bullet points
- Relevant keywords from the job description

### What to NEVER DO:
- Remove any job, education, project, or certification
- Shorten bullet points to be "more concise"
- Combine multiple roles into one
- Drop details to "streamline"
- Reduce word count in any way

## OUTPUT FORMAT:
{
  "rewrittenResume": "COMPLETE enhanced resume. MUST be LONGER than original. Every original section enhanced, not shortened.",
  "professionalSummary": "3-4 sentence summary highlighting key qualifications",
  "keyChanges": [
    { "section": "string", "before": "original text", "after": "enhanced text", "reason": "how this helps" }
  ],
  "addedKeywords": ["comprehensive", "list", "of", "all", "keywords", "added"],
  "atsScore": { "before": number, "after": number, "improvement": "explanation" },
  "highlights": ["key improvement 1", "key improvement 2"],
  "preservedSections": ["Experience", "Education", "Skills", "Projects", "Certifications"],
  "contentVerification": {
    "originalWordCount": number,
    "outputWordCount": number,
    "originalJobCount": number,
    "outputJobCount": number,
    "originalBulletCount": number,
    "outputBulletCount": number,
    "lengthCheck": "PASS" or "FAIL - output shorter than input"
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

    // Run resume rewrite and cover letter in parallel.
    // The cover letter uses the original resumeText (same facts/metrics as the rewrite;
    // the rewrite only adds ATS keywords, not new information) so both calls are independent.
    logStep("Starting parallel resume + cover letter generation");

    const coverLetterSystemPrompt = `You are a former hiring manager at Google, Amazon, and McKinsey who now coaches executives on personal branding. You've written thousands of cover letters that landed interviews. Your letters sound like they were written by a thoughtful, articulate human - not AI.

## ⚠️ QUALITY BAR: EXECUTIVE-LEVEL WRITING ⚠️
We've received feedback that cover letters "look obviously written by a weak AI model." This is unacceptable.

Your writing must:
- Sound like a confident, senior professional wrote it
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
- Generic adjectives: dynamic, innovative, cutting-edge, synergy

### INSTEAD, WRITE LIKE THIS:
- Start with a specific achievement or insight
- Use the candidate's actual voice and experience level
- Reference concrete numbers and accomplishments
- Show you understand the specific company's challenges
- Sound like someone the hiring manager would want to have coffee with

### NO PLACEHOLDERS — SEND-READY:
- NEVER output bracketed fill-ins like [Hiring Manager Name], [Company Name], or [mention a specific...]. The buyer must be able to send this letter without editing a single bracket.
- Hiring manager unknown → "Dear Hiring Manager,". Company unknown → write about "your team" and the role's challenges from the job description; never gesture at facts you don't have.

### GROUNDING — ONLY THE CANDIDATE'S REAL FACTS:
- Every metric, outcome, and claim about the candidate must appear in their resume. Never invent outcomes the resume doesn't state. Connect and frame real facts; never extend them.

## STRUCTURE (350-450 words, 4 paragraphs):

**Opening Hook (3-4 sentences)**: Lead with something memorable - a specific achievement, a unique insight about their industry, or a genuine connection to the company. Make them want to keep reading.

**Achievement Paragraph (5-6 sentences)**: Connect 2-3 SPECIFIC experiences to the role. Use REAL numbers from the resume. Show the progression and impact of their career. Don't just list - tell a brief story.

**Company Fit Paragraph (4-5 sentences)**: Why THIS company, THIS role, THIS team? Show genuine understanding of what they do. Reference something specific if possible. Demonstrate cultural alignment.

**Confident Close (2-3 sentences)**: End on a forward-looking, confident note. Express genuine interest without desperation. Suggest next steps naturally.

## LANGUAGE QUALITY:
- Use contractions naturally (I'm, I've, we'd, they're)
- Mix sentence lengths (short punchy, then longer flowing)
- Include one moment of personality or genuine enthusiasm
- Be specific where the resume allows (real numbers, real companies)
- Read it aloud in your head - does it sound human?

## OUTPUT FORMAT (JSON):
{
  "coverLetter": "The complete 350-450 word cover letter. Must sound authentically human and reference specific details from resume.",
  "openingLine": "The attention-grabbing first sentence",
  "keySkillsHighlighted": ["skill1", "skill2", "skill3", "skill4"],
  "personalizedElements": ["specific detail about candidate used", "specific reference to company/role"],
  "suggestedSubjectLine": "Specific, memorable subject line - not 'Application for X'",
  "whyThisWorks": "Brief explanation of the persuasion strategy used"
}`;

    const coverLetterUserPrompt = `Write a compelling, human-sounding cover letter for this candidate and role:

CANDIDATE'S RESUME (use specific details from this):
${resumeText}

TARGET ROLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB REQUIREMENTS:
${jobDescription}` : ''}

Write a cover letter that sounds like it was written by this specific person - confident, articulate, and genuine. Reference specific experiences from their resume with concrete details.`;

    const [
      { response: resumeResponse, modelUsed: resumeModel },
      { response: coverLetterResponse, modelUsed: coverLetterModel }
    ] = await Promise.all([
      callAIWithFallback(
        apiKey,
        {
          messages: [
            { role: "system", content: resumeSystemPrompt },
            { role: "user", content: resumeUserPrompt }
          ],
          max_completion_tokens: 12000,
        },
        'Resume generation'
      ),
      callAIWithFallback(
        apiKey,
        {
          messages: [
            { role: "system", content: coverLetterSystemPrompt },
            { role: "user", content: coverLetterUserPrompt }
          ],
          max_completion_tokens: 4000,
        },
        'Cover letter generation'
      )
    ]);

    if (!resumeResponse.ok) {
      const errorText = await resumeResponse.text();
      logStep("Resume AI API error", { status: resumeResponse.status, error: errorText, model: resumeModel });
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

    if (!coverLetterResponse.ok) {
      const errorText = await coverLetterResponse.text();
      logStep("Cover letter AI API error", { status: coverLetterResponse.status, error: errorText, model: coverLetterModel });
      if (coverLetterResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Cover letter AI API error: ${coverLetterResponse.status}`);
    }

    logStep("Both AI calls complete", { resumeModel, coverLetterModel });

    const resumeAiResponse = await resumeResponse.json();
    const resumeContent = resumeAiResponse.choices?.[0]?.message?.content;
    if (!resumeContent) throw new Error("No content in resume AI response");

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

    const coverLetterAiResponse = await coverLetterResponse.json();
    const coverLetterContent = coverLetterAiResponse.choices?.[0]?.message?.content;
    if (!coverLetterContent) throw new Error("No content in cover letter AI response");

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

    logStep("Both results parsed");

    // Contact-integrity guard: deterministically strip any URL, email, or
    // phone-shaped string in the output that does not appear in the original
    // resume. The prompt forbids inventing contact details, but the audit
    // caught a fabricated linkedin.com/in/... slipping through — prompts ask,
    // code enforces (same philosophy as the free scan's grounding filter).
    const stripInventedContact = (text: string, original: string): { text: string; removed: string[] } => {
      const removed: string[] = [];
      const origLower = original.toLowerCase();
      const patterns = [
        /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,)]+/gi,
        /(?:https?:\/\/)?(?:www\.)?(?:github\.com|behance\.net|dribbble\.com)\/[^\s|,)]+/gi,
        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
        /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g,
      ];
      let out = text;
      for (const re of patterns) {
        out = out.replace(re, (match) => {
          if (origLower.includes(match.toLowerCase())) return match;
          removed.push(match);
          return '';
        });
      }
      // Tidy contact-line separators left dangling by a removal (" | | ", trailing "|")
      if (removed.length > 0) {
        out = out.replace(/\s*\|\s*(?=\||$)/gm, '').replace(/\|\s*$/gm, '').replace(/^\s*\|\s*/gm, '');
      }
      return { text: out, removed };
    };
    const resumeContactGuard = stripInventedContact(resumeResult.rewrittenResume || '', resumeText);
    if (resumeContactGuard.removed.length > 0) {
      resumeResult.rewrittenResume = resumeContactGuard.text;
      logStep("Contact-integrity guard removed invented items", { removed: resumeContactGuard.removed });
    }
    const letterContactGuard = stripInventedContact(coverLetterResult.coverLetter || '', resumeText);
    if (letterContactGuard.removed.length > 0) {
      coverLetterResult.coverLetter = letterContactGuard.text;
      logStep("Contact-integrity guard (letter) removed invented items", { removed: letterContactGuard.removed });
    }

    // Auto-fix common corruption patterns before validation
    const resumeFix = autoFixContent(resumeResult.rewrittenResume || '', resumeText);
    const coverLetterFix = autoFixContent(coverLetterResult.coverLetter || '', resumeText);
    
    // Apply fixes to results
    if (resumeFix.corrections.length > 0) {
      resumeResult.rewrittenResume = resumeFix.fixed;
      logStep("Resume auto-fixed", { corrections: resumeFix.corrections.length });
    }
    if (coverLetterFix.corrections.length > 0) {
      coverLetterResult.coverLetter = coverLetterFix.fixed;
      logStep("Cover letter auto-fixed", { corrections: coverLetterFix.corrections.length });
    }

    // Validate after auto-fix to see remaining issues
    const resumeValidation = validateContent(resumeResult.rewrittenResume || '', resumeText);
    const coverLetterValidation = validateContent(coverLetterResult.coverLetter || '', resumeText);
    
    logStep("Content validation complete", {
      resumeScore: resumeValidation.score,
      resumeIssues: resumeValidation.issues.length,
      coverLetterScore: coverLetterValidation.score,
      coverLetterIssues: coverLetterValidation.issues.length
    });

    // Combine results with validation and auto-fix info
    const premiumPackageResult = {
      resume: resumeResult,
      coverLetter: coverLetterResult,
      originalResume: resumeText.substring(0, 2000) + (resumeText.length > 2000 ? '...' : ''),
      jobDetails: {
        title: jobTitle || 'Not specified',
        company: jobCompany || 'Not specified'
      },
      generatedAt: new Date().toISOString(),
      modelsUsed: {
        resume: resumeModel,
        coverLetter: coverLetterModel
      },
      validation: {
        resumeQualityScore: resumeValidation.score,
        resumeIssues: resumeValidation.issues,
        resumeAutoFixes: resumeFix.corrections,
        coverLetterQualityScore: coverLetterValidation.score,
        coverLetterIssues: coverLetterValidation.issues,
        coverLetterAutoFixes: coverLetterFix.corrections,
        overallQuality: resumeValidation.issues.length === 0 && coverLetterValidation.issues.length === 0 ? 'excellent' : 
                        resumeValidation.issues.length + coverLetterValidation.issues.length <= 2 ? 'good' : 'needs_review'
      }
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
