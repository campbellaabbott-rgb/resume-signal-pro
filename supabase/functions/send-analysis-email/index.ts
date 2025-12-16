import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 5; // 5 emails per hour
const RATE_WINDOW_MINUTES = 60;

interface AnalysisEmailRequest {
  email: string;
  shareId: string;
  origin?: string;
  analysis: {
    industry?: string;
    experienceLevel?: string;
    summaryRewrite?: {
      professionalSummary: string;
      linkedInHeadline: string;
    };
    optimizedBullets: Array<{ original: string; improved: string; reason: string }>;
    quantificationOpportunities?: Array<{ context: string; suggestion: string; example: string }>;
    skillsGap?: {
      missingTechnical: string[];
      missingSoft: string[];
      recommendations: string;
    };
    industryInsights?: {
      whatRecruitersLookFor: string;
      competitiveAdvantage: string;
      commonMistakes: string;
    };
    actionVerbs: Array<{ weak: string; strong: string }>;
    keywords: string[];
    redFlags: string[];
  };
}

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-ANALYSIS-EMAIL] ${step}${detailsStr}`);
};

function isValidEmail(email: string): boolean {
  const regex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return regex.test(email) && email.length <= 254;
}

function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Get client IP for rate limiting
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";

  try {
    logStep("Function started", { ip: clientIp });

    // Check persistent rate limit
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: allowed, error: rlError } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp,
      p_function: 'send-analysis-email',
      p_max_requests: RATE_LIMIT,
      p_window_minutes: RATE_WINDOW_MINUTES
    });

    if (rlError) {
      console.error("[SEND-ANALYSIS-EMAIL] Rate limit check error:", rlError);
    } else if (!allowed) {
      logStep("Rate limit exceeded", { ip: clientIp });
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { email, shareId, origin, analysis }: AnalysisEmailRequest = await req.json();
    logStep("Received request", { email: email ? '***@***' : 'missing', shareId: shareId || 'missing', hasAnalysis: !!analysis, origin: origin || 'missing' });

    if (!email || !analysis) {
      return new Response(
        JSON.stringify({ error: "Email and analysis data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidEmail(email)) {
      logStep("Invalid email format");
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify shareId exists in database if provided
    if (shareId) {
      const { data: analysisExists } = await supabase
        .from('resume_analyses')
        .select('id')
        .eq('share_id', shareId)
        .maybeSingle();

      if (!analysisExists) {
        logStep("Analysis not found for shareId");
        return new Response(
          JSON.stringify({ error: "Analysis not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Use origin from request or fall back to header
    const baseUrl = origin || req.headers.get("origin") || "https://resumebooster.app";
    const shareUrl = shareId ? `${baseUrl}/success?share=${escapeHtml(shareId)}` : baseUrl;

    // Build summary section
    const summaryHtml = analysis.summaryRewrite?.professionalSummary ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 8px; margin-bottom: 16px;">📝 Your Professional Summary</h2>
        <div style="padding: 16px; background: #f0f7ff; border-radius: 8px; border-left: 4px solid #0066cc;">
          <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #333;">${escapeHtml(analysis.summaryRewrite.professionalSummary)}</p>
        </div>
        ${analysis.summaryRewrite.linkedInHeadline ? `
          <div style="margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px;">
            <p style="margin: 0 0 4px 0; font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px;">LinkedIn Headline</p>
            <p style="margin: 0; font-weight: 600; color: #333;">${escapeHtml(analysis.summaryRewrite.linkedInHeadline)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build industry insights section
    const industryHtml = analysis.industryInsights?.whatRecruitersLookFor ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #17a2b8; padding-bottom: 8px; margin-bottom: 16px;">🎯 ${escapeHtml(analysis.industry || 'Industry')} Insights</h2>
        <div style="padding: 16px; background: #e8f4f8; border-radius: 8px; margin-bottom: 12px;">
          <p style="margin: 0 0 4px 0; font-weight: 600; color: #0c5460;">What Recruiters Look For</p>
          <p style="margin: 0; color: #333; font-size: 14px;">${escapeHtml(analysis.industryInsights.whatRecruitersLookFor)}</p>
        </div>
        ${analysis.industryInsights.competitiveAdvantage ? `
          <div style="padding: 16px; background: #d4edda; border-radius: 8px; margin-bottom: 12px;">
            <p style="margin: 0 0 4px 0; font-weight: 600; color: #155724;">Your Competitive Edge</p>
            <p style="margin: 0; color: #333; font-size: 14px;">${escapeHtml(analysis.industryInsights.competitiveAdvantage)}</p>
          </div>
        ` : ''}
        ${analysis.industryInsights.commonMistakes ? `
          <div style="padding: 16px; background: #fff3cd; border-radius: 8px;">
            <p style="margin: 0 0 4px 0; font-weight: 600; color: #856404;">Common Mistakes to Avoid</p>
            <p style="margin: 0; color: #333; font-size: 14px;">${escapeHtml(analysis.industryInsights.commonMistakes)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build skills gap section
    const skillsHtml = analysis.skillsGap && (analysis.skillsGap.missingTechnical?.length || analysis.skillsGap.missingSoft?.length) ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #6f42c1; padding-bottom: 8px; margin-bottom: 16px;">🧠 Skills Gap Analysis</h2>
        ${analysis.skillsGap.missingTechnical?.length ? `
          <div style="margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #6f42c1; font-size: 14px;">Technical Skills to Add</p>
            <div>${analysis.skillsGap.missingTechnical.map(s => `<span style="display: inline-block; margin: 4px; padding: 6px 12px; background: #f3e8ff; color: #6f42c1; border-radius: 16px; font-size: 13px;">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${analysis.skillsGap.missingSoft?.length ? `
          <div style="margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; font-weight: 600; color: #495057; font-size: 14px;">Soft Skills to Highlight</p>
            <div>${analysis.skillsGap.missingSoft.map(s => `<span style="display: inline-block; margin: 4px; padding: 6px 12px; background: #e9ecef; color: #495057; border-radius: 16px; font-size: 13px;">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${analysis.skillsGap.recommendations ? `
          <div style="padding: 12px; background: #f8f9fa; border-radius: 8px;">
            <p style="margin: 0; color: #6c757d; font-size: 14px;">💡 ${escapeHtml(analysis.skillsGap.recommendations)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build quantification opportunities section
    const quantHtml = analysis.quantificationOpportunities?.length ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #28a745; padding-bottom: 8px; margin-bottom: 16px;">📊 Quantification Opportunities</h2>
        ${analysis.quantificationOpportunities.map(opp => `
          <div style="margin-bottom: 16px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; color: #6c757d; font-size: 14px;">"${escapeHtml(opp.context)}"</p>
            <p style="margin: 0 0 12px 0; color: #333; font-size: 14px;">→ ${escapeHtml(opp.suggestion)}</p>
            <div style="padding: 12px; background: #d4edda; border-radius: 6px;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #155724; text-transform: uppercase; letter-spacing: 0.5px;">Example</p>
              <p style="margin: 0; font-weight: 600; color: #155724;">${escapeHtml(opp.example)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    // Build bullets section
    const bulletsHtml = analysis.optimizedBullets?.length ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #28a745; padding-bottom: 8px; margin-bottom: 16px;">✓ ATS-Optimized Bullet Points</h2>
        ${analysis.optimizedBullets.map(b => `
          <div style="margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px;">
            <div style="margin-bottom: 12px;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px;">Before</p>
              <p style="margin: 0; color: #6c757d; text-decoration: line-through; font-size: 14px;">${escapeHtml(b.original)}</p>
            </div>
            <div style="margin-bottom: 12px;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #28a745; text-transform: uppercase; letter-spacing: 0.5px;">After</p>
              <p style="margin: 0; color: #155724; font-weight: 600; font-size: 14px;">${escapeHtml(b.improved)}</p>
            </div>
            <p style="margin: 0; color: #6c757d; font-size: 13px; font-style: italic;">💡 ${escapeHtml(b.reason)}</p>
          </div>
        `).join('')}
      </div>
    ` : '';

    // Build action verbs section
    const verbsHtml = analysis.actionVerbs?.length ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #fd7e14; padding-bottom: 8px; margin-bottom: 16px;">⚡ Stronger Action Verbs</h2>
        <table style="width: 100%; border-collapse: collapse;">
          ${analysis.actionVerbs.map(v => `
            <tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef; color: #6c757d; text-decoration: line-through;">${escapeHtml(v.weak)}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e9ecef; color: #6c757d;">→</td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef; color: #fd7e14; font-weight: 600;">${escapeHtml(v.strong)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '';

    // Build keywords section
    const keywordsHtml = analysis.keywords?.length ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 8px; margin-bottom: 16px;">🔑 Recommended Keywords</h2>
        <div>${analysis.keywords.map(k => `<span style="display: inline-block; margin: 4px; padding: 8px 14px; background: #e7f1ff; color: #0066cc; border-radius: 20px; font-size: 14px; font-weight: 500;">${escapeHtml(k)}</span>`).join('')}</div>
        <p style="margin: 16px 0 0 0; color: #6c757d; font-size: 13px;">💡 Naturally incorporate these keywords into your experience bullets and skills section.</p>
      </div>
    ` : '';

    // Build red flags section
    const redFlagsHtml = analysis.redFlags?.length ? `
      <div style="margin-bottom: 32px;">
        <h2 style="color: #333; border-bottom: 2px solid #dc3545; padding-bottom: 8px; margin-bottom: 16px;">⚠️ Red Flags to Fix</h2>
        ${analysis.redFlags.map(r => `
          <div style="margin-bottom: 12px; padding: 14px; background: #fff5f5; border-left: 4px solid #dc3545; border-radius: 4px;">
            <p style="margin: 0; color: #721c24; font-size: 14px;">${escapeHtml(r)}</p>
          </div>
        `).join('')}
      </div>
    ` : '';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 640px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
        <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #0066cc, #0052a3); color: white; padding: 32px; text-align: center;">
            <h1 style="margin: 0 0 8px 0; font-size: 28px;">Resume Booster</h1>
            <p style="margin: 0; opacity: 0.9;">Your Complete Analysis Report</p>
            ${analysis.industry ? `
              <div style="margin-top: 16px;">
                <span style="display: inline-block; padding: 6px 14px; background: rgba(255,255,255,0.2); border-radius: 20px; font-size: 13px;">
                  ${escapeHtml(analysis.industry)} • ${escapeHtml(analysis.experienceLevel || 'Professional')} Level
                </span>
              </div>
            ` : ''}
          </div>

          <!-- Content -->
          <div style="padding: 32px;">
            ${summaryHtml}
            ${industryHtml}
            ${skillsHtml}
            ${quantHtml}
            ${bulletsHtml}
            ${verbsHtml}
            ${keywordsHtml}
            ${redFlagsHtml}

            <!-- CTA -->
            <div style="text-align: center; margin: 40px 0 20px 0;">
              <a href="${shareUrl}" style="display: inline-block; background: #0066cc; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">View Analysis Online</a>
            </div>
          </div>

          <!-- Footer -->
          <div style="border-top: 1px solid #e9ecef; padding: 24px; text-align: center; background: #f8f9fa;">
            <p style="margin: 0 0 8px 0; color: #6c757d; font-size: 14px;">This analysis was generated by Resume Booster</p>
            <p style="margin: 0; color: #6c757d; font-size: 13px;">Save this email to access your results anytime</p>
          </div>

        </div>
      </body>
      </html>
    `;

    logStep("Sending email");

    const emailResponse = await resend.emails.send({
      from: "Resume Booster <onboarding@resend.dev>",
      to: [email],
      subject: `Your Complete Resume Analysis - ${analysis.industry || 'Professional'} Resume`,
      html: emailHtml,
    });

    logStep("Email sent successfully");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("[SEND-ANALYSIS-EMAIL] Error:", error);
    return new Response(JSON.stringify({ error: "Failed to send email. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});