// deploy-stamp: 2026-10-09T14:00Z
//
// The owner's support tool (x-admin-key): regenerate a customer's Premium
// Package and email it to them. Platform sweep L6-23 found it would quietly
// deliver the wrong thing: with no job title it targeted "Investment Banking
// Analyst at Top Investment Bank" whoever the customer was; it saved the copy
// as product type 'premiumPackage', which recovery (keyed on
// 'premium_package') never matches; the copy's session id was never returned,
// so nobody could hand it to the customer; and the email linked the old
// lovable.app host. A job title is now required, the copy is saved under the
// type recovery reads, its id is returned to the owner, and the link is
// resumebooster.work.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { keyMatches } from "../_shared/admin-key.ts";
import { purchaseLinkFor } from "../_shared/purchase-links.ts";
import { CUSTOMER_REPLY_TO } from "../_shared/customer-mail.ts";
import { callAIForUsableReply, describeError, looksLikeBrokenJson, type UsableReply } from "../_shared/ai-fallback.ts";

// Provable from outside without the key: every response, the preflight
// included, carries this in x-fn-build.
// 2026-11-03.1 (audit-rest, FA-2): the two model calls walk the shared chain
// the paid writers walk (_shared/ai-fallback.ts callAIForUsableReply), in the
// premium package's order (gpt-5, gemini-2.5-pro, gpt-5-mini), each inside
// the chain's 125 s; this function's own fetchWithRetry (gpt-5 only, 60 s
// three times, no deadline) is gone. A reply cut off at its cap, empty, or
// with no résumé in it asks the next model (prose is still a letter); it
// used to ship as the delivery with an invented "ATS 60 -> 90", and the mail
// printed 60% -> 92% for a reply that named no score. When no model writes
// the résumé nothing is saved or mailed, and the log says so. The customer
// mail, the saved product name and the owner's answer no longer name a model
// (the chain may answer with another). Bodies (messages,
// max_completion_tokens 12000 and 4000) are unchanged. Nothing else changed
// since main 21518390.
const FN_BUILD = "admin-regenerate-delivery.2026-11-03.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};

/** The product type recovery and the success page read for this product. */
const PREMIUM_PACKAGE_PRODUCT_TYPE = "premium_package";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[ADMIN-REGENERATE] ${step}`, details ? JSON.stringify(details) : '');
};

// Declare EdgeRuntime for TypeScript
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

// The premium package's order (generate-premium-package MODEL_FALLBACK_ORDER).
const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'openai/gpt-5-mini',
];

/**
 * One model call on the shared chain: every model in order, each call inside
 * the chain's own 125 s, until a reply `read` accepts.
 */
async function askAI<T>(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxCompletionTokens: number,
  context: string,
  read: (data: unknown) => T | null,
): Promise<UsableReply<T>> {
  return await callAIForUsableReply(apiKey, {
    messages,
    maxCompletionTokens,
    models: MODEL_FALLBACK_ORDER,
    context: `ADMIN-REGENERATE ${context}`,
    read,
  });
}

/** The text a reply wrote, or null when it wrote none. */
function contentOf(data: unknown): string | null {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

/** The JSON object a reply carries, or null. */
// deno-lint-ignore no-explicit-any
function jsonObjectOf(content: string | null): Record<string, any> | null {
  const match = content?.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A reply's JSON when it carries the part delivered, a non-empty string in `field`; else null. */
// deno-lint-ignore no-explicit-any
function partOf(content: string | null, field: "rewrittenResume" | "coverLetter"): Record<string, any> | null {
  const parsed = jsonObjectOf(content);
  return parsed && typeof parsed[field] === "string" && parsed[field].trim() ? parsed : null;
}

/** A gateway refusal (429, 402) as the error that ends the regeneration. */
async function refusalOf(reply: { response: Response; modelUsed: string }, part: string): Promise<Error> {
  const errorText = await reply.response.text().catch(() => "");
  logStep(`${part} AI API error`, { status: reply.response.status, model: reply.modelUsed, error: errorText.slice(0, 200) });
  return new Error(`${part} AI API error: ${reply.response.status}`);
}

async function processRegeneration(newSessionId: string, email: string, resumeText: string, jobTitle: string, jobCompany: string, jobDescription?: string) {
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

    // Step 1: Generate the rewritten resume
    logStep("Generating rewritten resume");
    
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

TARGET JOB TITLE: ${jobTitle}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION:\n${jobDescription}` : 'No job description was provided: tailor to the target job title above, using only what the resume supports.'}`;

    // NO SYNTHESISED DELIVERY: a reply with no résumé in it (prose, cut off,
    // or JSON that does not parse) asks the next model; when none writes
    // one, the chain throws and nothing is saved or mailed.
    const resumeReply = await askAI(
      apiKey,
      [
        { role: "system", content: resumeSystemPrompt },
        { role: "user", content: resumeUserPrompt }
      ],
      12000,
      "Resume generation",
      (data) => partOf(contentOf(data), "rewrittenResume"),
    );
    if (!resumeReply.ok) throw await refusalOf(resumeReply, "Resume");
    const resumeResult = resumeReply.value;

    logStep("Resume rewrite complete", { 
      model: resumeReply.modelUsed,
      keywordsAdded: resumeResult.addedKeywords?.length,
      changesCount: resumeResult.keyChanges?.length,
      resumeLength: resumeResult.rewrittenResume?.length
    });

    // Step 2: Generate the cover letter
    logStep("Generating cover letter");

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

TARGET ROLE: ${jobTitle}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB REQUIREMENTS:\n${jobDescription}` : ''}`;

    // Prose is still a letter; broken JSON, an empty reply, or JSON with no
    // letter in it asks the next model.
    // deno-lint-ignore no-explicit-any
    const readLetter = (data: unknown): Record<string, any> | null => {
      const content = contentOf(data);
      if (!content) return null;
      if (jsonObjectOf(content)) return partOf(content, "coverLetter");
      if (looksLikeBrokenJson(content)) return null;
      logStep("Cover letter came back as prose; the prose is the letter");
      return {
        coverLetter: content,
        openingLine: "",
        keySkillsHighlighted: [],
        personalizedElements: [],
        suggestedSubjectLine: `Application for ${jobTitle}`
      };
    };
    const coverLetterReply = await askAI(
      apiKey,
      [
        { role: "system", content: coverLetterSystemPrompt },
        { role: "user", content: coverLetterUserPrompt }
      ],
      4000,
      "Cover letter generation",
      readLetter,
    );
    if (!coverLetterReply.ok) throw await refusalOf(coverLetterReply, "Cover letter");
    const coverLetterResult = coverLetterReply.value;

    logStep("Cover letter generated", { model: coverLetterReply.modelUsed, coverLetterLength: coverLetterResult.coverLetter?.length });

    // Combine results
    const generatedContent = {
      resume: resumeResult,
      coverLetter: coverLetterResult,
      jobDetails: { title: jobTitle, company: jobCompany },
      generatedAt: new Date().toISOString(),
      regenerated: { resumeModel: resumeReply.modelUsed, coverLetterModel: coverLetterReply.modelUsed },
    };

    // Step 3: Save to database
    logStep("Saving to database");
    
    const { error: insertError } = await supabase
      .from('purchased_content')
      .insert({
        customer_email: email,
        product_type: PREMIUM_PACKAGE_PRODUCT_TYPE,
        product_name: 'Premium Package (Regenerated)',
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
    const emailHtml = generatePremiumPackageEmail(email, generatedContent, newSessionId);
    
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [email],
      reply_to: CUSTOMER_REPLY_TO,
      subject: "👑 Your Regenerated Premium Package is Ready!",
      html: emailHtml,
    });

    if (emailError) {
      logStep("Email send error", { error: emailError.message });
    } else {
      logStep("Email sent successfully", { emailId: emailData?.id });
    }

    logStep("Background task completed successfully", { email });

  } catch (error) {
    // describeError: a parse error's message can quote the reply's words.
    console.error("[ADMIN-REGENERATE] Background task error; nothing was saved or mailed:", describeError(error));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require admin API key for this privileged endpoint (constant-time; an
    // unset key opens nothing).
    if (!keyMatches(req.headers.get("x-admin-key") ?? "", Deno.env.get("ADMIN_API_KEY") ?? "")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, resumeText, jobTitle, jobCompany, jobDescription } = await req.json();

    if (!email || !resumeText) {
      return new Response(
        JSON.stringify({ error: "Email and resume text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // The package is tailored to a role. Without one this used to target an
    // investment-banking analyst, whoever the customer was.
    const title = typeof jobTitle === "string" ? jobTitle.trim().slice(0, 200) : "";
    if (!title) {
      return new Response(
        JSON.stringify({ error: "jobTitle is required: the package is tailored to the customer's target role" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const company = typeof jobCompany === "string" ? jobCompany.trim().slice(0, 200) : "";

    // The copy's id, decided now and handed back, so the owner can give it to
    // the customer for the success page's "recover a previous purchase".
    const newSessionId = `manual_regen_${crypto.randomUUID()}`;
    logStep("Request received, starting background processing", { email, jobTitle: title, jobCompany: company, sessionId: newSessionId });

    // Start background processing
    EdgeRuntime.waitUntil(
      processRegeneration(newSessionId, email, resumeText, title, company, jobDescription)
    );

    // Return immediate response
    return new Response(
      JSON.stringify({
        success: true,
        message: "The premium package is being regenerated. This takes 2-3 minutes; the customer is emailed when it is ready, and nothing is sent if no model writes it (see the function's log).",
        estimatedTime: "2-3 minutes",
        email: email,
        sessionId: newSessionId,
        productType: PREMIUM_PACKAGE_PRODUCT_TYPE,
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

function generatePremiumPackageEmail(email: string, generatedContent: any, sessionId: string): string {
  const resume = generatedContent.resume;
  const coverLetter = generatedContent.coverLetter;
  
  const keyChangesHtml = (Array.isArray(resume.keyChanges) ? resume.keyChanges : []).slice(0, 8).map((c: any) => 
    `<li style="color: #374151; margin-bottom: 8px;"><strong>${escapeHtml(c?.section)}:</strong> ${escapeHtml(c?.reason)}</li>`
  ).join('') || '';
  const addedKeywords: unknown[] = Array.isArray(resume.addedKeywords) ? resume.addedKeywords : [];
  // The scores the reply wrote, or no score block: 60% -> 92% was printed
  // for a reply that named none.
  const scoreOf = (v: unknown) => {
    const n = Math.round(Number(v));
    return typeof v === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  };
  const before = scoreOf(resume.atsScore?.before);
  const after = scoreOf(resume.atsScore?.after);

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
                Regenerated for you, tailored to your target role
              </p>
            </td>
          </tr>

          <!-- ATS Score -->
          <tr>
            <td style="background: white; padding: 32px;">
              ${before !== null && after !== null ? `
              <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center;">
                <div style="font-size: 28px; font-weight: bold; color: #9ca3af; display: inline-block;">${before}%</div>
                <span style="font-size: 28px; color: #22c55e; margin: 0 16px;">→</span>
                <div style="font-size: 42px; font-weight: bold; color: #22c55e; display: inline-block;">${after}%</div>
                <div style="color: #166534; font-size: 15px; margin-top: 16px; font-weight: 600;">ATS Score Improvement</div>
              </div>
              ` : ''}

              ${keyChangesHtml ? `
              <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="color: #1f2937; font-size: 18px; margin: 0 0 16px;">✨ Key Improvements Made:</h3>
                <ul style="margin: 0; padding-left: 24px;">${keyChangesHtml}</ul>
              </div>
              ` : ''}

              ${addedKeywords.length ? `
              <div style="background: #eff6ff; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="color: #1e40af; font-size: 18px; margin: 0 0 16px;">🎯 ${addedKeywords.length} ATS Keywords Added:</h3>
                <p style="color: #374151; font-size: 14px; line-height: 1.8; margin: 0;">
                  ${addedKeywords.slice(0, 25).map((k) => `<span style="background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 4px; margin: 3px; display: inline-block; font-size: 13px;">${escapeHtml(String(k))}</span>`).join('')}
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
                <a href="${escapeHtml(purchaseLinkFor("premium_package", sessionId))}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 16px 36px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Open your package →
                </a>
                <p style="color: #6b7280; font-size: 12px; margin: 16px 0 0;">Order reference: <span style="font-family: 'Courier New', monospace;">${escapeHtml(sessionId)}</span></p>
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
