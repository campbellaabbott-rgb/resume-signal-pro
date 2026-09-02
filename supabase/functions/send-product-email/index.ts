// deploy-stamp: 2026-07-04T18:44Z
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface ProductEmailRequest {
  email: string;
  productType: string;
  productName: string;
  generatedContent?: any;
}

// Product-specific info
const productInfo: Record<string, {
  emoji: string;
  tagline: string;
  howItWorks: string[];
  nextSteps: string[];
}> = {
  basic_keyword_fix: {
    emoji: "🎯",
    tagline: "Boost your ATS score with optimized keywords",
    howItWorks: [
      "Our AI analyzed your resume against ATS requirements",
      "We identified missing keywords that could boost your score",
      "Review the suggestions and add them to your resume",
      "Re-upload to check your improved ATS score"
    ],
    nextSteps: [
      "Review the keyword analysis on the success page",
      "Update your resume with the suggested keywords",
      "Focus on critical and high-importance keywords first",
      "Re-scan to verify your improved score"
    ]
  },
  cover_letter: {
    emoji: "✉️",
    tagline: "A personalized cover letter tailored to your target role",
    howItWorks: [
      "Our AI analyzed your resume and the job requirements",
      "We crafted a personalized cover letter matching your experience",
      "Copy the letter or download it as a document",
      "Customize the greeting and company-specific details"
    ],
    nextSteps: [
      "Review your cover letter on the success page",
      "Copy or download the letter",
      "Personalize the greeting if needed",
      "Submit with your resume application"
    ]
  },
  premium_package: {
    emoji: "👑",
    tagline: "Complete resume rewrite + personalized cover letter",
    howItWorks: [
      "Our AI completely rewrote your resume for ATS optimization",
      "We added missing keywords and stronger action verbs",
      "Your cover letter is personalized to the target role",
      "Review the before/after comparison to see improvements"
    ],
    nextSteps: [
      "Review your optimized resume on the success page",
      "Check the cover letter in the second tab",
      "Copy or download both documents",
      "Submit your application with confidence"
    ]
  },
  career_bundle: {
    emoji: "📦",
    tagline: "75 full resume analyses to power your job search",
    howItWorks: [
      "75 full resume analyses have been added to your account",
      "Each analysis includes complete ATS scoring and optimization",
      "Use them across multiple job applications",
      "Credits never expire - use at your own pace"
    ],
    nextSteps: [
      "Go to the home page to start using your credits",
      "Upload your resume for each job application",
      "Track your remaining credits in the header",
      "Share with friends or family if you'd like"
    ]
  },
  scan_pack: {
    emoji: "⚡",
    tagline: "30 resume scans to optimize every application",
    howItWorks: [
      "30 scan credits have been added to your account",
      "Each scan analyzes your resume against a specific job",
      "Compare unlimited job descriptions with your credits",
      "Credits never expire"
    ],
    nextSteps: [
      "Go to the home page to start scanning",
      "Each scan uses one credit from your balance",
      "View remaining credits in the header",
      "Optimize for each job you apply to"
    ]
  },
  ats_defense: {
    emoji: "🛡️",
    tagline: "Full ATS compatibility audit with before/after optimization",
    howItWorks: [
      "Our AI audited your resume against major ATS platforms",
      "We identified parsing issues and keyword gaps",
      "Your resume was restructured for maximum ATS compatibility",
      "Review the before/after score breakdown on the success page"
    ],
    nextSteps: [
      "Review your ATS compatibility audit on the success page",
      "Apply the format and keyword recommendations",
      "Download your complete report as a PDF",
      "Re-check compatibility for each target role"
    ]
  },
  career_snapshot: {
    emoji: "📸",
    tagline: "A recruiter's-eye view of your career, with a clear plan forward",
    howItWorks: [
      "Our AI analyzed your career from a senior recruiter's perspective",
      "We evaluated your performance, trajectory, and credibility signals",
      "Identified how recruiters will perceive your background",
      "Generated strategic positioning recommendations"
    ],
    nextSteps: [
      "Review your Career Signal Score breakdown",
      "Read the recruiter perception summary",
      "Apply the top 3 priority fixes",
      "Use the positioning guidance for your next applications"
    ]
  },
  graduate_gameplan: {
    emoji: "🎓",
    tagline: "A clear, step-by-step playbook for landing your first role",
    howItWorks: [
      "Our AI evaluated your resume readiness for the job market",
      "We identified roles that match your background and experience",
      "Created a targeted application strategy for new grads",
      "Built a 30-day action plan to land your first role"
    ],
    nextSteps: [
      "Check your resume readiness verdict",
      "Review the roles targeted for your background",
      "Follow the networking scripts provided",
      "Work through the 30-day action plan"
    ]
  },
  interview_coach: {
    emoji: "🎤",
    tagline: "Personalized interview questions and model answers based on your resume",
    howItWorks: [
      "Our AI generated interview questions specific to your background",
      "Each question includes why it's asked and how to answer it",
      "Full STAR-method model answers grounded in your real experience",
      "Practice and get instant AI feedback on your answers"
    ],
    nextSteps: [
      "Review your interview questions on the success page",
      "Read through the model answers for each category",
      "Practice answering in your own words",
      "Download your prep guide as a PDF"
    ]
  },
  career_path_simulator: {
    emoji: "🧭",
    tagline: "3 realistic career paths, with a 90-day plan to start either one",
    howItWorks: [
      "Our AI analyzed your skills, experience, and career trajectory",
      "We identified 3 realistic career paths based on your background",
      "Each path includes skill gaps and a concrete 90-day action plan",
      "Pick the direction that fits and start executing this week"
    ],
    nextSteps: [
      "Review your 3 career path options",
      "Identify the skills gap for your preferred path",
      "Follow the 90-day action plan",
      "Download your roadmap as a PDF"
    ]
  },
  apply_assistant: {
    emoji: "📨",
    tagline: "A tailored resume, cover letter, and checklist — ready for you to review and submit",
    howItWorks: [
      "You pasted the job posting you're applying to",
      "Our AI tailored your resume to that specific role, using only your real experience",
      "Generated a matching cover letter and a step-by-step submission checklist",
      "Review everything and submit it yourself — nothing is sent automatically"
    ],
    nextSteps: [
      "Review your tailored resume for accuracy",
      "Read through the cover letter and the submission checklist",
      "Export both documents as PDF or Word",
      "Apply on the employer's site yourself"
    ]
  }
};

function generateProductEmailHtml(data: ProductEmailRequest): string {
  const { productName, productType, generatedContent } = data;
  const info = productInfo[productType] || productInfo.basic_keyword_fix;
  
  const howItWorksHtml = info.howItWorks.map((step, i) => 
    `<tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #f3f4f6;">
        <div style="display: flex; align-items: flex-start;">
          <span style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-block; text-align: center; line-height: 24px; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">${i + 1}</span>
          <span style="color: #374151; font-size: 14px;">${escapeHtml(step)}</span>
        </div>
      </td>
    </tr>`
  ).join('');

  const nextStepsHtml = info.nextSteps.map(step => 
    `<li style="margin-bottom: 8px; color: #374151; font-size: 14px;">✓ ${escapeHtml(step)}</li>`
  ).join('');

  // Extract key highlights from generated content if available
  let highlightsHtml = '';
  let contentSummaryHtml = '';
  
  if (generatedContent) {
    if (productType === 'basic_keyword_fix' && generatedContent.overallScore) {
      highlightsHtml = `
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: #22c55e;">${generatedContent.overallScore}%</div>
          <div style="color: #166534; font-size: 14px;">Keyword Optimization Score</div>
          ${generatedContent.missingKeywords?.length ? `<div style="color: #4b5563; font-size: 13px; margin-top: 8px;">${generatedContent.missingKeywords.length} keywords to add</div>` : ''}
        </div>
      `;
      
      // Add keyword list to email
      if (generatedContent.missingKeywords?.length > 0) {
        const topKeywords = generatedContent.missingKeywords.slice(0, 10);
        contentSummaryHtml = `
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 12px;">🎯 Top Keywords to Add:</h3>
            <ul style="margin: 0; padding-left: 20px;">
              ${topKeywords.map((k: any) => `<li style="color: #374151; margin-bottom: 6px;"><strong>${escapeHtml(k.keyword)}</strong> - ${escapeHtml(k.suggestion)}</li>`).join('')}
            </ul>
            ${generatedContent.missingKeywords.length > 10 ? `<p style="color: #6b7280; font-size: 13px; margin-top: 12px; font-style: italic;">+ ${generatedContent.missingKeywords.length - 10} more keywords on the website</p>` : ''}
          </div>
        `;
      }
    } else if (productType === 'cover_letter' && generatedContent.coverLetter) {
      highlightsHtml = `
        <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <div style="font-size: 36px; margin-bottom: 8px;">✉️</div>
          <div style="color: #1e40af; font-size: 16px; font-weight: 600;">Cover Letter Generated!</div>
        </div>
      `;
      
      // Include the actual cover letter in the email
      contentSummaryHtml = `
        <div style="background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px;">📄 Your Cover Letter:</h3>
          <div style="color: #374151; font-size: 14px; line-height: 1.7; white-space: pre-wrap; font-family: Georgia, serif;">${escapeHtml(generatedContent.coverLetter)}</div>
        </div>
      `;
    } else if (productType === 'premium_package' && generatedContent.resume?.atsScore) {
      highlightsHtml = `
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: center;">
          <div style="display: flex; justify-content: center; align-items: center; gap: 20px;">
            <div>
              <div style="font-size: 24px; font-weight: bold; color: #9ca3af;">${escapeHtml(String(generatedContent.resume.atsScore.before ?? '?'))}%</div>
              <div style="color: #6b7280; font-size: 12px;">Before</div>
            </div>
            <div style="font-size: 24px; color: #22c55e;">→</div>
            <div>
              <div style="font-size: 36px; font-weight: bold; color: #22c55e;">${escapeHtml(String(generatedContent.resume.atsScore.after ?? '?'))}%</div>
              <div style="color: #166534; font-size: 12px;">After</div>
            </div>
          </div>
          <div style="color: #166534; font-size: 14px; margin-top: 12px;">ATS Score Improvement</div>
        </div>
      `;
      
      // Include key changes and the rewritten resume
      if (generatedContent.resume.keyChanges?.length > 0) {
        contentSummaryHtml = `
          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 12px;">✨ Key Improvements Made:</h3>
            <ul style="margin: 0; padding-left: 20px;">
              ${generatedContent.resume.keyChanges.slice(0, 5).map((c: any) => `<li style="color: #374151; margin-bottom: 6px;"><strong>${escapeHtml(c.section)}:</strong> ${escapeHtml(c.reason)}</li>`).join('')}
            </ul>
          </div>
          <div style="background: #ffffff; border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h3 style="color: #1f2937; font-size: 16px; margin: 0 0 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px;">📄 Your Optimized Resume:</h3>
            <div style="color: #374151; font-size: 13px; line-height: 1.6; white-space: pre-wrap; font-family: 'Courier New', monospace; max-height: 400px; overflow-y: auto;">${escapeHtml(generatedContent.resume.rewrittenResume?.substring(0, 3000) || '')}${(generatedContent.resume.rewrittenResume?.length || 0) > 3000 ? '\n\n[Content truncated - view full version on website]' : ''}</div>
          </div>
        `;
      }
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${escapeHtml(productName)} is Ready!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 12px;">${info.emoji}</div>
              <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 700;">
                Thank You for Your Purchase!
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                ${escapeHtml(productName)}
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: white; padding: 32px;">
              
              <!-- Tagline -->
              <p style="color: #6b7280; font-size: 16px; text-align: center; margin: 0 0 24px;">
                ${escapeHtml(info.tagline)}
              </p>

              ${highlightsHtml}

              <!-- Generated Content Summary -->
              ${contentSummaryHtml}

              <!-- How It Works -->
              <div style="margin-bottom: 32px;">
                <h2 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 16px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb;">
                  📋 How It Works
                </h2>
                <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 12px; overflow: hidden;">
                  ${howItWorksHtml}
                </table>
              </div>

              <!-- Next Steps -->
              <div style="margin-bottom: 32px;">
                <h2 style="color: #1f2937; font-size: 18px; font-weight: 600; margin: 0 0 16px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb;">
                  🚀 Your Next Steps
                </h2>
                <ul style="margin: 0; padding-left: 0; list-style: none;">
                  ${nextStepsHtml}
                </ul>
              </div>

              <!-- CTA Button -->
              <div style="text-align: center; margin-top: 32px;">
                <a href="https://resumebooster.lovable.app" 
                   style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  View Your Results →
                </a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f9fafb; padding: 24px; border-radius: 0 0 16px 16px; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">
                Questions? Reply to this email or contact support.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                Resume Booster - Land your dream job with an ATS-optimized resume
              </p>
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[SEND-PRODUCT-EMAIL] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestData: ProductEmailRequest = await req.json();
    const { email, productType, productName, generatedContent } = requestData;

    // Validate email
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Valid email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!productType || !productName) {
      return new Response(
        JSON.stringify({ error: "Product type and name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SEND-PRODUCT-EMAIL] Sending ${productType} email to ${email}`);

    const resend = new Resend(resendApiKey);
    const html = generateProductEmailHtml(requestData);

    const info = productInfo[productType];
    const emoji = info?.emoji || "✨";

    const { data, error } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [email],
      subject: `${emoji} Your ${productName} is Ready!`,
      html,
    });

    // Log email send to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (error) {
      console.error("[SEND-PRODUCT-EMAIL] Resend error:", error);
      
      // Log failed email
      await supabase.rpc('log_email_send', {
        p_email_type: `product_${productType}`,
        p_recipient: email,
        p_subject: `Your ${productName} is Ready!`,
        p_status: 'failed',
        p_error_message: error.message,
      });

      return new Response(
        JSON.stringify({ error: "Failed to send email", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SEND-PRODUCT-EMAIL] Email sent successfully: ${data?.id}`);

    // Log successful email
    await supabase.rpc('log_email_send', {
      p_email_type: `product_${productType}`,
      p_recipient: email,
      p_subject: `Your ${productName} is Ready!`,
      p_status: 'sent',
      p_metadata: { resend_id: data?.id },
    });

    return new Response(
      JSON.stringify({ success: true, messageId: data?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[SEND-PRODUCT-EMAIL] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: "Failed to send email", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
