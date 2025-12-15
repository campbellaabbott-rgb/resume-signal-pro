import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisEmailRequest {
  email: string;
  shareId: string;
  analysis: {
    overallScore: number;
    summary: string;
    atsOptimizedBullets: Array<{ original: string; improved: string; explanation: string }>;
    actionVerbs: Array<{ weak: string; strong: string; context: string }>;
    keywordSuggestions: Array<{ keyword: string; reason: string; priority: string }>;
    redFlags: Array<{ issue: string; impact: string; fix: string }>;
    topStrengths: string[];
    criticalFixes: string[];
  };
}

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-ANALYSIS-EMAIL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { email, shareId, analysis }: AnalysisEmailRequest = await req.json();
    logStep("Received request", { email, shareId, hasAnalysis: !!analysis });

    if (!email || !analysis) {
      throw new Error("Email and analysis data are required");
    }

    const shareUrl = `https://resumebooster.app/success?share=${shareId}`;

    // Build the email HTML
    const bulletsHtml = analysis.atsOptimizedBullets?.slice(0, 3).map(b => `
      <div style="margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px;">
        <p style="margin: 0 0 8px 0; color: #dc3545; text-decoration: line-through;">${b.original}</p>
        <p style="margin: 0 0 8px 0; color: #28a745; font-weight: 600;">${b.improved}</p>
        <p style="margin: 0; color: #6c757d; font-size: 14px;">${b.explanation}</p>
      </div>
    `).join('') || '';

    const redFlagsHtml = analysis.redFlags?.slice(0, 3).map(r => `
      <div style="margin-bottom: 12px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
        <p style="margin: 0 0 4px 0; font-weight: 600; color: #856404;">${r.issue}</p>
        <p style="margin: 0; color: #856404; font-size: 14px;"><strong>Fix:</strong> ${r.fix}</p>
      </div>
    `).join('') || '';

    const strengthsHtml = analysis.topStrengths?.map(s => `
      <li style="margin-bottom: 8px; color: #155724;">${s}</li>
    `).join('') || '';

    const keywordsHtml = analysis.keywordSuggestions?.slice(0, 5).map(k => `
      <span style="display: inline-block; margin: 4px; padding: 6px 12px; background: #e7f1ff; color: #0066cc; border-radius: 16px; font-size: 14px;">${k.keyword}</span>
    `).join('') || '';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #0066cc; margin: 0;">Resume Booster</h1>
          <p style="color: #6c757d; margin: 8px 0 0 0;">Your Analysis Results</p>
        </div>

        <div style="background: linear-gradient(135deg, #0066cc, #0052a3); color: white; padding: 24px; border-radius: 12px; text-align: center; margin-bottom: 32px;">
          <p style="margin: 0 0 8px 0; font-size: 14px; opacity: 0.9;">Overall Score</p>
          <p style="margin: 0; font-size: 48px; font-weight: bold;">${analysis.overallScore}/100</p>
        </div>

        <div style="margin-bottom: 32px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 8px;">Summary</h2>
          <p style="color: #555;">${analysis.summary}</p>
        </div>

        ${analysis.topStrengths?.length ? `
        <div style="margin-bottom: 32px;">
          <h2 style="color: #333; border-bottom: 2px solid #28a745; padding-bottom: 8px;">✓ Top Strengths</h2>
          <ul style="padding-left: 20px;">
            ${strengthsHtml}
          </ul>
        </div>
        ` : ''}

        ${analysis.atsOptimizedBullets?.length ? `
        <div style="margin-bottom: 32px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 8px;">ATS-Optimized Bullets</h2>
          ${bulletsHtml}
          ${analysis.atsOptimizedBullets.length > 3 ? `<p style="color: #6c757d; font-style: italic;">+ ${analysis.atsOptimizedBullets.length - 3} more improvements in full report</p>` : ''}
        </div>
        ` : ''}

        ${analysis.redFlags?.length ? `
        <div style="margin-bottom: 32px;">
          <h2 style="color: #333; border-bottom: 2px solid #ffc107; padding-bottom: 8px;">⚠ Red Flags to Fix</h2>
          ${redFlagsHtml}
        </div>
        ` : ''}

        ${analysis.keywordSuggestions?.length ? `
        <div style="margin-bottom: 32px;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 8px;">Suggested Keywords</h2>
          <div>${keywordsHtml}</div>
        </div>
        ` : ''}

        <div style="text-align: center; margin: 40px 0;">
          <a href="${shareUrl}" style="display: inline-block; background: #0066cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Full Analysis</a>
        </div>

        <div style="border-top: 1px solid #e9ecef; padding-top: 24px; text-align: center; color: #6c757d; font-size: 14px;">
          <p style="margin: 0 0 8px 0;">This analysis was generated by Resume Booster</p>
          <p style="margin: 0;">Save this email to access your results anytime</p>
        </div>

      </body>
      </html>
    `;

    logStep("Sending email");

    const emailResponse = await resend.emails.send({
      from: "Resume Booster <onboarding@resend.dev>",
      to: [email],
      subject: `Your Resume Analysis: Score ${analysis.overallScore}/100`,
      html: emailHtml,
    });

    logStep("Email sent successfully", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
