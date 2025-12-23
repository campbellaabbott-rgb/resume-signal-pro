import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// HTML escape function to prevent XSS attacks
function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface AnalysisEmailRequest {
  email: string;
  analysisData: {
    industry?: string;
    experienceLevel?: string;
    atsScore?: {
      score: number;
      breakdown?: Record<string, number>;
      improvements?: string[];
    };
    summaryRewrite?: {
      professionalSummary?: string;
      linkedInHeadline?: string;
    };
    redFlags?: string[];
    keywords?: string[];
    actionPlan?: string[];
    hasLinkedIn?: boolean;
    hasJobDescription?: boolean;
    jobMatch?: {
      score?: number;
      matchedRequirements?: string[];
      missingRequirements?: string[];
    };
  };
  shareId?: string;
}

function generateEmailHtml(data: AnalysisEmailRequest): string {
  const { analysisData, shareId } = data;
  const atsScore = analysisData.atsScore?.score || 0;
  const scoreColor = atsScore >= 80 ? '#22c55e' : atsScore >= 60 ? '#eab308' : '#ef4444';
  
  // Escape all user-provided content to prevent XSS
  const actionPlanHtml = analysisData.actionPlan?.slice(0, 5).map((item, i) => 
    `<li style="margin-bottom: 8px; color: #374151;">${i + 1}. ${escapeHtml(item)}</li>`
  ).join('') || '';

  const redFlagsHtml = analysisData.redFlags?.slice(0, 3).map(flag => 
    `<li style="margin-bottom: 4px; color: #dc2626;">⚠️ ${escapeHtml(flag)}</li>`
  ).join('') || '';

  const keywordsHtml = analysisData.keywords?.slice(0, 8).map(kw => 
    `<span style="display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 16px; margin: 4px; font-size: 14px;">${escapeHtml(kw)}</span>`
  ).join('') || '';

  // Validate shareId format before using in URL
  const safeShareId = shareId && /^[a-f0-9]{24,32}$/.test(shareId) ? shareId : null;
  const viewResultsUrl = safeShareId 
    ? `https://resumebooster.lovable.app/success?share=${safeShareId}`
    : 'https://resumebooster.lovable.app';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Resume Analysis Results</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; border-radius: 16px 16px 0 0; text-align: center;">
              <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">
                ✨ Your Resume Analysis is Ready!
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">
                Thank you for using Resume Booster
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: white; padding: 32px;">
              
              <!-- ATS Score -->
              <div style="text-align: center; margin-bottom: 32px;">
                <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">ATS Compatibility Score</p>
                <div style="display: inline-block; width: 120px; height: 120px; border-radius: 50%; border: 8px solid ${scoreColor}; line-height: 104px; text-align: center;">
                  <span style="font-size: 36px; font-weight: 700; color: ${scoreColor};">${atsScore}</span>
                </div>
                <p style="margin: 12px 0 0; color: #6b7280; font-size: 14px;">
                  ${atsScore >= 80 ? 'Excellent! Your resume is well-optimized.' : atsScore >= 60 ? 'Good, but there\'s room for improvement.' : 'Needs work to pass ATS systems.'}
                </p>
              </div>

              <!-- Industry & Level -->
              <div style="background: #f9fafb; padding: 16px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="color: #6b7280;">Industry:</span>
                <strong style="color: #111827; margin-left: 4px;">${escapeHtml(analysisData.industry || 'General')}</strong>
                <span style="color: #d1d5db; margin: 0 12px;">|</span>
                <span style="color: #6b7280;">Level:</span>
                <strong style="color: #111827; margin-left: 4px; text-transform: capitalize;">${escapeHtml(analysisData.experienceLevel || 'Mid')}</strong>
              </div>

              ${analysisData.hasJobDescription && analysisData.jobMatch ? `
              <!-- Job Match Score -->
              <div style="background: #fef3c7; padding: 16px; border-radius: 12px; margin-bottom: 24px; border-left: 4px solid #f59e0b;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #92400e;">📋 Job Match Score: ${escapeHtml(analysisData.jobMatch.score || 0)}%</p>
                <p style="margin: 0; color: #78350f; font-size: 14px;">
                  Your resume ${(analysisData.jobMatch.score || 0) >= 70 ? 'aligns well' : 'needs optimization'} for the target job description.
                </p>
              </div>
              ` : ''}

              <!-- Action Plan -->
              ${actionPlanHtml ? `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px; font-weight: 600;">
                  🎯 Your Action Plan
                </h2>
                <ol style="margin: 0; padding-left: 20px; color: #374151;">
                  ${actionPlanHtml}
                </ol>
              </div>
              ` : ''}

              <!-- Red Flags -->
              ${redFlagsHtml ? `
              <div style="background: #fef2f2; padding: 16px; border-radius: 12px; margin-bottom: 24px;">
                <h3 style="margin: 0 0 12px; color: #991b1b; font-size: 16px;">Issues to Fix</h3>
                <ul style="margin: 0; padding-left: 16px; list-style: none;">
                  ${redFlagsHtml}
                </ul>
              </div>
              ` : ''}

              <!-- Keywords to Add -->
              ${keywordsHtml ? `
              <div style="margin-bottom: 24px;">
                <h3 style="margin: 0 0 12px; color: #111827; font-size: 16px;">🔑 Keywords to Add</h3>
                <div>
                  ${keywordsHtml}
                </div>
              </div>
              ` : ''}

              <!-- Professional Summary -->
              ${analysisData.summaryRewrite?.professionalSummary ? `
              <div style="background: #f0fdf4; padding: 16px; border-radius: 12px; margin-bottom: 24px; border-left: 4px solid #22c55e;">
                <h3 style="margin: 0 0 8px; color: #166534; font-size: 16px;">✍️ Optimized Summary</h3>
                <p style="margin: 0; color: #166534; font-size: 14px; line-height: 1.6;">
                  "${escapeHtml(analysisData.summaryRewrite.professionalSummary)}"
                </p>
              </div>
              ` : ''}

              <!-- CTA Button -->
              <div style="text-align: center; margin-top: 32px;">
                <a href="${viewResultsUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px;">
                  View Full Analysis →
                </a>
                <p style="margin: 16px 0 0; color: #9ca3af; font-size: 12px;">
                  Your results are saved and available anytime
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f9fafb; padding: 24px; border-radius: 0 0 16px 16px; text-align: center;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">
                Questions? Just reply to this email.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                © ${new Date().getFullYear()} Resume Booster. All rights reserved.
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[SEND-ANALYSIS-EMAIL] Function called");

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[SEND-ANALYSIS-EMAIL] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestData: AnalysisEmailRequest = await req.json();
    
    if (!requestData.email || !requestData.analysisData) {
      console.error("[SEND-ANALYSIS-EMAIL] Missing required fields");
      return new Response(
        JSON.stringify({ success: false, error: "Missing email or analysis data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(requestData.email)) {
      console.error("[SEND-ANALYSIS-EMAIL] Invalid email format");
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SEND-ANALYSIS-EMAIL] Sending to: ${requestData.email}`);

    const resend = new Resend(RESEND_API_KEY);
    const html = generateEmailHtml(requestData);

    // Sanitize ATS score for subject line (ensure it's a valid number)
    const safeAtsScore = Math.min(100, Math.max(0, Math.round(requestData.analysisData.atsScore?.score || 0)));
    
    const { data, error } = await resend.emails.send({
      from: "Resume Booster <onboarding@resend.dev>",
      to: [requestData.email],
      subject: `Your Resume Analysis is Ready! (ATS Score: ${safeAtsScore}/100)`,
      html,
    });

    // Log email send to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (error) {
      console.error("[SEND-ANALYSIS-EMAIL] Resend error:", error);
      
      // Log failed email
      await supabase.rpc('log_email_send', {
        p_email_type: 'analysis_results',
        p_recipient: requestData.email,
        p_subject: `Resume Analysis (ATS Score: ${safeAtsScore}/100)`,
        p_status: 'failed',
        p_error_message: error.message,
      });

      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[SEND-ANALYSIS-EMAIL] Email sent successfully:", data?.id);

    // Log successful email
    await supabase.rpc('log_email_send', {
      p_email_type: 'analysis_results',
      p_recipient: requestData.email,
      p_subject: `Resume Analysis (ATS Score: ${safeAtsScore}/100)`,
      p_status: 'sent',
      p_metadata: { resend_id: data?.id },
    });

    return new Response(
      JSON.stringify({ success: true, messageId: data?.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[SEND-ANALYSIS-EMAIL] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Failed to send email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
