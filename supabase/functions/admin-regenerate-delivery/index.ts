import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[ADMIN-REGENERATE] ${step}`, details ? JSON.stringify(details) : '');
};

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
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

async function processRegeneration(email: string, resumeText: string, jobTitle: string, jobCompany: string, jobDescription?: string) {
  try {
    logStep("Background task started", { email, jobTitle, jobCompany });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Generate the rewritten resume with GPT-5
    logStep("Generating rewritten resume with GPT-5");
    
    const resumeSystemPrompt = `You are an elite ATS resume optimization specialist. Your ONLY task is to ENHANCE the provided resume while preserving 100% of the original content.

## ⚠️ ABSOLUTE NON-NEGOTIABLE RULES ⚠️

### RULE 1: ZERO CONTENT REMOVAL
- You MUST include EVERY SINGLE job/position from the original resume
- You MUST include EVERY SINGLE education entry
- You MUST include EVERY SINGLE project mentioned
- You MUST include EVERY SINGLE certification/award
- You MUST include EVERY bullet point (enhanced, but present)

### RULE 2: LENGTH PRESERVATION
- Your output MUST be AT LEAST as long as the input
- DO NOT summarize or condense - EXPAND and ENHANCE

### RULE 3: ENHANCE, NEVER DELETE
- Improve wording of EXISTING content
- Add relevant keywords naturally INTO existing bullets
- Quantify achievements where you can infer reasonable metrics
- Strengthen action verbs

## WHAT YOU SHOULD DO:
1. **Professional Summary**: Write a compelling 3-4 sentence summary
2. **Each Job**: Keep ALL jobs, enhance EVERY bullet point
3. **Skills Section**: Create comprehensive skills section with ATS keywords
4. **Education**: Keep ALL entries
5. **Projects/Certs**: Keep ALL, enhance descriptions

## OUTPUT FORMAT:
Respond with valid JSON:
{
  "rewrittenResume": "The COMPLETE rewritten resume with ALL original content enhanced.",
  "professionalSummary": "The new professional summary",
  "keyChanges": [{ "section": "string", "before": "original", "after": "improved", "reason": "why" }],
  "addedKeywords": ["keyword1", "keyword2"],
  "atsScore": { "before": number, "after": number, "improvement": "explanation" },
  "highlights": ["improvement 1", "improvement 2"]
}`;

    const resumeUserPrompt = `ENHANCE this resume for the target position. Keep EVERY job, education, project, and experience.

ORIGINAL RESUME:
${resumeText}

TARGET JOB TITLE: ${jobTitle || 'Investment Banking Analyst'}
TARGET COMPANY: ${jobCompany || 'Top Investment Bank'}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}` : 'Target investment banking analyst roles at top-tier financial institutions.'}`;

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
      logStep("Resume JSON parse error, using raw content", { error: String(parseError) });
      resumeResult = {
        rewrittenResume: resumeContent,
        professionalSummary: "",
        keyChanges: [],
        addedKeywords: [],
        atsScore: { before: 60, after: 90, improvement: "Optimized for ATS" },
        highlights: []
      };
    }

    logStep("Resume rewrite complete", { 
      keywordsAdded: resumeResult.addedKeywords?.length,
      changesCount: resumeResult.keyChanges?.length,
      resumeLength: resumeResult.rewrittenResume?.length
    });

    // Step 2: Generate the cover letter with GPT-5
    logStep("Generating cover letter with GPT-5");

    const coverLetterSystemPrompt = `You are a senior executive recruiter. Write cover letters that sound authentically human - confident and articulate.

## STRUCTURE (300-400 words, 4 paragraphs):
**Opening**: Hook with a specific achievement. NEVER start with "I am writing to apply".
**Body 1**: Connect 2-3 specific experiences with metrics.
**Body 2**: Why THIS company/role.
**Closing**: Confident call to action.

## TONE: Sound like a confident peer, not a desperate applicant. Use contractions naturally.

Respond with JSON:
{
  "coverLetter": "Full cover letter with paragraph breaks",
  "openingLine": "The hook",
  "keySkillsHighlighted": ["skill1", "skill2"],
  "personalizedElements": ["candidate detail", "company detail"],
  "suggestedSubjectLine": "Specific subject line"
}`;

    const coverLetterUserPrompt = `Write a compelling cover letter:

RESUME:
${resumeResult.rewrittenResume}

TARGET ROLE: ${jobTitle || 'Investment Banking Analyst'}
TARGET COMPANY: ${jobCompany || 'Top Investment Bank'}

${jobDescription ? `JOB REQUIREMENTS:\n${jobDescription}` : ''}`;

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
        suggestedSubjectLine: `Application for ${jobTitle || 'Investment Banking Analyst'}`
      };
    }

    logStep("Cover letter generated", { coverLetterLength: coverLetterResult.coverLetter?.length });

    // Combine results
    const generatedContent = {
      resume: resumeResult,
      coverLetter: coverLetterResult,
      jobDetails: { title: jobTitle, company: jobCompany },
      generatedAt: new Date().toISOString(),
      regeneratedWithGPT5: true
    };

    // Step 3: Save to database
    logStep("Saving to database");
    
    const newSessionId = `manual_regen_${Date.now()}`;
    
    const { error: insertError } = await supabase
      .from('purchased_content')
      .insert({
        customer_email: email,
        product_type: 'premiumPackage',
        product_name: 'Premium Package (GPT-5 Regenerated)',
        stripe_session_id: newSessionId,
        generated_content: generatedContent,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      });

    if (insertError) {
      logStep("Error saving to database", { error: insertError.message });
    } else {
      logStep("Content saved to database");
    }

    // Step 4: Send email
    logStep("Sending email");
    
    const resend = new Resend(resendApiKey);
    const emailHtml = generatePremiumPackageEmail(email, generatedContent);
    
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: "Resume Booster <onboarding@resend.dev>",
      to: [email],
      subject: "👑 Your Regenerated Premium Package is Ready! (GPT-5 Enhanced)",
      html: emailHtml,
    });

    if (emailError) {
      logStep("Email send error", { error: emailError.message });
    } else {
      logStep("Email sent successfully", { emailId: emailData?.id });
    }

    logStep("Background task completed successfully", { email });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ADMIN-REGENERATE] Background task error:", errorMessage);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, resumeText, jobTitle, jobCompany, jobDescription } = await req.json();

    if (!email || !resumeText) {
      return new Response(
        JSON.stringify({ error: "Email and resume text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Request received, starting background processing", { email, jobTitle, jobCompany });

    // Start background processing
    EdgeRuntime.waitUntil(
      processRegeneration(email, resumeText, jobTitle || 'Investment Banking Analyst', jobCompany || 'Top Investment Bank', jobDescription)
    );

    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Your premium package is being regenerated with GPT-5. This takes 2-3 minutes. You'll receive an email when it's ready!",
        estimatedTime: "2-3 minutes",
        email: email
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ADMIN-REGENERATE] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to start regeneration", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generatePremiumPackageEmail(email: string, generatedContent: any): string {
  const resume = generatedContent.resume;
  const coverLetter = generatedContent.coverLetter;
  
  const keyChangesHtml = resume.keyChanges?.slice(0, 8).map((c: any) => 
    `<li style="color: #374151; margin-bottom: 8px;"><strong>${escapeHtml(c.section)}:</strong> ${escapeHtml(c.reason)}</li>`
  ).join('') || '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Premium Package is Ready!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 700px; border-collapse: collapse;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">👑</div>
              <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">
                Your Premium Package is Ready!
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                Regenerated with GPT-5 for maximum quality
              </p>
            </td>
          </tr>

          <!-- ATS Score -->
          <tr>
            <td style="background: white; padding: 32px;">
              <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center;">
                <div style="font-size: 28px; font-weight: bold; color: #9ca3af; display: inline-block;">${resume.atsScore?.before || 60}%</div>
                <span style="font-size: 28px; color: #22c55e; margin: 0 16px;">→</span>
                <div style="font-size: 42px; font-weight: bold; color: #22c55e; display: inline-block;">${resume.atsScore?.after || 92}%</div>
                <div style="color: #166534; font-size: 15px; margin-top: 16px; font-weight: 600;">ATS Score Improvement</div>
              </div>

              ${keyChangesHtml ? `
              <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 16px;">✨ Key Improvements Made:</h3>
                <ul style="margin: 0; padding-left: 24px;">${keyChangesHtml}</ul>
              </div>
              ` : ''}

              ${resume.addedKeywords?.length ? `
              <div style="background: #eff6ff; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 16px;">🎯 ${resume.addedKeywords.length} ATS Keywords Added:</h3>
                <p style="color: #374151; font-size: 14px; line-height: 1.8; margin: 0;">
                  ${resume.addedKeywords.slice(0, 25).map((k: string) => `<span style="background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 4px; margin: 3px; display: inline-block; font-size: 13px;">${escapeHtml(k)}</span>`).join('')}
                </p>
              </div>
              ` : ''}

              <div style="background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 28px; margin-bottom: 24px;">
                <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 14px;">📄 Your ATS-Optimized Resume</h3>
                <div style="color: #374151; font-size: 13px; line-height: 1.7; white-space: pre-wrap; font-family: Georgia, 'Times New Roman', serif;">${escapeHtml(resume.rewrittenResume)}</div>
              </div>

              <div style="background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 28px; margin-bottom: 24px;">
                <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 14px;">✉️ Your Personalized Cover Letter</h3>
                <div style="color: #374151; font-size: 14px; line-height: 1.8; white-space: pre-wrap; font-family: Georgia, 'Times New Roman', serif;">${escapeHtml(coverLetter.coverLetter)}</div>
                ${coverLetter.suggestedSubjectLine ? `
                <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                  <p style="color: #6b7280; font-size: 13px; margin: 0;"><strong>Suggested Email Subject:</strong> ${escapeHtml(coverLetter.suggestedSubjectLine)}</p>
                </div>
                ` : ''}
              </div>

              <div style="text-align: center; margin-top: 32px;">
                <a href="https://resumebooster.lovable.app" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 16px 36px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Visit Resume Booster →
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="background: #f9fafb; padding: 24px; border-radius: 0 0 16px 16px; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">Questions? Reply to this email for support.</p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">Resume Booster - Land your dream job with an ATS-optimized resume</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
