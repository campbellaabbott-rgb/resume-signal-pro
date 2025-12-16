import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT = 5;
const RATE_WINDOW_MINUTES = 60;

interface LinkedInAnalysis {
  headlineOptimization?: {
    current: string;
    improved: string;
    whyBetter: string;
  };
  aboutSectionRewrite?: string;
  experienceOptimization?: Array<{
    role: string;
    issue: string;
    improved: string;
  }>;
  skillsToAdd?: string[];
  skillsToRemove?: string[];
  seoKeywords?: string[];
  profileVisibilityTips?: string[];
  featuredSectionIdeas?: string[];
  recommendationStrategy?: string;
}

interface AnalysisEmailRequest {
  email: string;
  shareId: string;
  origin?: string;
  analysis: {
    industry?: string;
    experienceLevel?: string;
    hasLinkedIn?: boolean;
    atsScore?: {
      score: number;
      breakdown: {
        keywordMatch: number;
        formatting: number;
        structure: number;
        relevance: number;
      };
      improvements: string[];
    };
    readabilityMetrics?: {
      grade: string;
      bulletPointClarity: string;
      jargonLevel: string;
      suggestions: string[];
    };
    formatRecommendations?: {
      currentIssues: string[];
      recommendations: string[];
      sectionOrder: string[];
    };
    resumeLength?: {
      recommendedPages: number;
      currentAssessment: string;
      reasoning: string;
    };
    summaryRewrite?: {
      professionalSummary: string;
      linkedInHeadline: string;
    };
    optimizedBullets?: Array<{ original: string; improved: string; reason: string }>;
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
    actionVerbs?: Array<{ weak: string; strong: string }>;
    keywords?: string[];
    redFlags?: string[];
    linkedInAnalysis?: LinkedInAnalysis;
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

// Safe array helper
function safeArray<T>(arr: T[] | undefined | null): T[] {
  return arr ?? [];
}

// Score color helper
function getScoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#10b981';
    case 'B': return '#3b82f6';
    case 'C': return '#f59e0b';
    default: return '#ef4444';
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";

  try {
    logStep("Function started", { ip: clientIp });

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
    logStep("Received request", { email: email ? '***@***' : 'missing', shareId: shareId || 'missing', hasAnalysis: !!analysis });

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

    const baseUrl = origin || req.headers.get("origin") || "https://resumebooster.app";
    const shareUrl = shareId ? `${baseUrl}/success?share=${escapeHtml(shareId)}` : baseUrl;

    // Extract data with safe defaults
    const linkedIn = analysis.linkedInAnalysis;
    const optimizedBullets = safeArray(analysis.optimizedBullets);
    const actionVerbs = safeArray(analysis.actionVerbs);
    const keywords = safeArray(analysis.keywords);
    const redFlags = safeArray(analysis.redFlags);

    // Build ATS Score Section
    const atsScoreHtml = analysis.atsScore ? `
      <div style="margin-bottom: 32px; padding: 24px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; color: white;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <div style="width: 32px; height: 32px; background: rgba(59, 130, 246, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
            <span style="font-size: 16px;">📊</span>
          </div>
          <span style="font-size: 14px; font-weight: 500; opacity: 0.9;">ATS Compatibility Score</span>
          <span style="margin-left: auto; font-size: 28px; font-weight: 700; color: ${getScoreColor(analysis.atsScore.score)};">${analysis.atsScore.score}<span style="font-size: 16px; opacity: 0.7;">/100</span></span>
        </div>
        <div style="background: rgba(255,255,255,0.1); height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 20px;">
          <div style="background: ${getScoreColor(analysis.atsScore.score)}; height: 100%; width: ${analysis.atsScore.score}%; border-radius: 6px;"></div>
        </div>
        ${analysis.atsScore.breakdown ? `
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              ${Object.entries(analysis.atsScore.breakdown).map(([key, value]) => `
                <td style="text-align: center; padding: 12px 8px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                  <div style="font-size: 20px; font-weight: 700; color: white;">${value}</div>
                  <div style="font-size: 11px; opacity: 0.7; text-transform: capitalize;">${key.replace(/([A-Z])/g, ' $1').trim()}</div>
                </td>
              `).join('')}
            </tr>
          </table>
        ` : ''}
        ${safeArray(analysis.atsScore.improvements).length > 0 ? `
          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);">
            <p style="margin: 0 0 12px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">Top Improvements</p>
            ${analysis.atsScore.improvements.slice(0, 3).map(item => `
              <p style="margin: 0 0 8px 0; font-size: 13px; padding-left: 16px; position: relative;">
                <span style="position: absolute; left: 0; color: #3b82f6;">→</span>
                ${escapeHtml(item)}
              </p>
            `).join('')}
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build Resume Length Section
    const resumeLengthHtml = analysis.resumeLength ? `
      <div style="margin-bottom: 32px; padding: 24px; background: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 32px; height: 32px; background: #dbeafe; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
            <span style="font-size: 16px;">📄</span>
          </div>
          <span style="font-size: 14px; font-weight: 600; color: #1e293b;">Recommended Resume Length</span>
          <span style="margin-left: auto; padding: 8px 16px; background: #3b82f6; color: white; border-radius: 20px; font-size: 16px; font-weight: 700;">
            ${analysis.resumeLength.recommendedPages} ${analysis.resumeLength.recommendedPages === 1 ? 'Page' : 'Pages'}
          </span>
        </div>
        <div style="margin-bottom: 12px;">
          <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Current Assessment</p>
          <p style="margin: 0; font-size: 14px; color: #1e293b;">${escapeHtml(analysis.resumeLength.currentAssessment)}</p>
        </div>
        <div>
          <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">Why This Length?</p>
          <p style="margin: 0; font-size: 14px; color: #64748b;">${escapeHtml(analysis.resumeLength.reasoning)}</p>
        </div>
      </div>
    ` : '';

    // Build Readability & Format Section
    const readabilityFormatHtml = (analysis.readabilityMetrics || analysis.formatRecommendations) ? `
      <table style="width: 100%; border-collapse: separate; border-spacing: 16px 0; margin-bottom: 32px;">
        <tr>
          ${analysis.readabilityMetrics ? `
            <td style="width: 50%; vertical-align: top; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
              <div style="display: flex; align-items: center; margin-bottom: 16px;">
                <span style="font-size: 16px; margin-right: 8px;">📖</span>
                <span style="font-size: 14px; font-weight: 600; color: #1e293b;">Readability</span>
                <span style="margin-left: auto; padding: 4px 10px; background: ${getGradeColor(analysis.readabilityMetrics.grade)}20; color: ${getGradeColor(analysis.readabilityMetrics.grade)}; border-radius: 12px; font-size: 12px; font-weight: 700;">
                  Grade ${escapeHtml(analysis.readabilityMetrics.grade)}
                </span>
              </div>
              <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                  <span style="color: #64748b;">Jargon Level</span>
                  <span style="font-weight: 600; color: ${analysis.readabilityMetrics.jargonLevel === 'low' ? '#10b981' : analysis.readabilityMetrics.jargonLevel === 'moderate' ? '#f59e0b' : '#ef4444'}; text-transform: capitalize;">
                    ${escapeHtml(analysis.readabilityMetrics.jargonLevel)}
                  </span>
                </div>
              </div>
              ${analysis.readabilityMetrics.bulletPointClarity ? `
                <p style="margin: 0; font-size: 12px; color: #64748b;">${escapeHtml(analysis.readabilityMetrics.bulletPointClarity)}</p>
              ` : ''}
            </td>
          ` : ''}
          ${analysis.formatRecommendations ? `
            <td style="width: 50%; vertical-align: top; padding: 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
              <div style="display: flex; align-items: center; margin-bottom: 16px;">
                <span style="font-size: 16px; margin-right: 8px;">📐</span>
                <span style="font-size: 14px; font-weight: 600; color: #1e293b;">Format & Structure</span>
              </div>
              ${safeArray(analysis.formatRecommendations.currentIssues).slice(0, 2).map(issue => `
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #ef4444; padding-left: 16px; position: relative;">
                  <span style="position: absolute; left: 0;">⚠️</span>
                  ${escapeHtml(issue)}
                </p>
              `).join('')}
              ${safeArray(analysis.formatRecommendations.recommendations).slice(0, 2).map(rec => `
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #10b981; padding-left: 16px; position: relative;">
                  <span style="position: absolute; left: 0;">✓</span>
                  ${escapeHtml(rec)}
                </p>
              `).join('')}
            </td>
          ` : ''}
        </tr>
      </table>
    ` : '';

    // Build LinkedIn Section
    const linkedInHtml = linkedIn ? `
      <div style="margin-bottom: 32px; padding: 24px; background: linear-gradient(135deg, #0077b5 0%, #005885 100%); border-radius: 16px; color: white;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <div style="width: 40px; height: 40px; background: rgba(255,255,255,0.2); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
            <span style="font-size: 20px;">in</span>
          </div>
          <div>
            <h2 style="margin: 0; font-size: 18px; font-weight: 700;">LinkedIn Profile Optimization</h2>
            <p style="margin: 0; font-size: 13px; opacity: 0.9;">Personalized recommendations to boost your visibility</p>
          </div>
        </div>

        ${linkedIn.headlineOptimization ? `
          <div style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">Current Headline</p>
            <p style="margin: 0 0 12px 0; font-size: 14px; text-decoration: line-through; opacity: 0.7;">${escapeHtml(linkedIn.headlineOptimization.current) || 'No headline found'}</p>
            <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #86efac;">Improved Headline</p>
            <p style="margin: 0; font-size: 15px; font-weight: 600;">${escapeHtml(linkedIn.headlineOptimization.improved)}</p>
          </div>
        ` : ''}

        ${linkedIn.aboutSectionRewrite ? `
          <div style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7;">New About Section</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-line;">${escapeHtml(linkedIn.aboutSectionRewrite)}</p>
          </div>
        ` : ''}

        ${safeArray(linkedIn.skillsToAdd).length > 0 ? `
          <div style="margin-bottom: 12px;">
            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: #86efac;">Skills to Add</p>
            <div>${linkedIn.skillsToAdd!.map(s => `<span style="display: inline-block; margin: 4px; padding: 6px 12px; background: rgba(134, 239, 172, 0.2); border-radius: 16px; font-size: 12px;">+ ${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}

        ${safeArray(linkedIn.seoKeywords).length > 0 ? `
          <div>
            <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; opacity: 0.9;">SEO Keywords for Recruiters</p>
            <div>${linkedIn.seoKeywords!.map(k => `<span style="display: inline-block; margin: 4px; padding: 6px 12px; background: rgba(255,255,255,0.15); border-radius: 16px; font-size: 12px;">${escapeHtml(k)}</span>`).join('')}</div>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build Summary Section
    const summaryHtml = analysis.summaryRewrite?.professionalSummary ? `
      <div style="margin-bottom: 32px; padding: 24px; background: #f0f9ff; border-radius: 16px; border: 1px solid #bae6fd;">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 32px; height: 32px; background: #dbeafe; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
            <span style="font-size: 16px;">👤</span>
          </div>
          <span style="font-size: 14px; font-weight: 600; color: #1e293b;">Professional Summary</span>
        </div>
        <div style="padding: 16px; background: white; border-radius: 12px; border-left: 4px solid #3b82f6; margin-bottom: 16px;">
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #1e293b;">${escapeHtml(analysis.summaryRewrite.professionalSummary)}</p>
        </div>
        ${analysis.summaryRewrite.linkedInHeadline ? `
          <div style="padding: 12px 16px; background: white; border-radius: 8px;">
            <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">LinkedIn Headline</p>
            <p style="margin: 0; font-weight: 600; color: #1e293b; font-size: 14px;">${escapeHtml(analysis.summaryRewrite.linkedInHeadline)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build Industry Insights Section
    const industryHtml = analysis.industryInsights?.whatRecruitersLookFor ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #06b6d4;">
          <span style="font-size: 18px; margin-right: 10px;">🎯</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">${escapeHtml(analysis.industry || 'Industry')} Insights</span>
        </div>
        <div style="padding: 16px; background: #ecfeff; border-radius: 12px; margin-bottom: 12px;">
          <p style="margin: 0 0 6px 0; font-weight: 600; color: #0e7490; font-size: 13px;">What Recruiters Look For</p>
          <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.6;">${escapeHtml(analysis.industryInsights.whatRecruitersLookFor)}</p>
        </div>
        ${analysis.industryInsights.competitiveAdvantage ? `
          <div style="padding: 16px; background: #dcfce7; border-radius: 12px; margin-bottom: 12px;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #166534; font-size: 13px;">Your Competitive Edge</p>
            <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.6;">${escapeHtml(analysis.industryInsights.competitiveAdvantage)}</p>
          </div>
        ` : ''}
        ${analysis.industryInsights.commonMistakes ? `
          <div style="padding: 16px; background: #fef3c7; border-radius: 12px;">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #92400e; font-size: 13px;">Common Mistakes to Avoid</p>
            <p style="margin: 0; color: #1e293b; font-size: 14px; line-height: 1.6;">${escapeHtml(analysis.industryInsights.commonMistakes)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build Skills Gap Section
    const skillsHtml = analysis.skillsGap && (safeArray(analysis.skillsGap.missingTechnical).length || safeArray(analysis.skillsGap.missingSoft).length) ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #8b5cf6;">
          <span style="font-size: 18px; margin-right: 10px;">🧠</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">Skills Gap Analysis</span>
        </div>
        ${safeArray(analysis.skillsGap.missingTechnical).length ? `
          <div style="margin-bottom: 16px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #7c3aed; font-size: 13px;">Technical Skills to Add</p>
            <div>${analysis.skillsGap.missingTechnical.map(s => `<span style="display: inline-block; margin: 4px; padding: 8px 14px; background: #ede9fe; color: #7c3aed; border-radius: 20px; font-size: 13px; font-weight: 500;">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${safeArray(analysis.skillsGap.missingSoft).length ? `
          <div style="margin-bottom: 16px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #475569; font-size: 13px;">Soft Skills to Highlight</p>
            <div>${analysis.skillsGap.missingSoft.map(s => `<span style="display: inline-block; margin: 4px; padding: 8px 14px; background: #f1f5f9; color: #475569; border-radius: 20px; font-size: 13px; font-weight: 500;">${escapeHtml(s)}</span>`).join('')}</div>
          </div>
        ` : ''}
        ${analysis.skillsGap.recommendations ? `
          <div style="padding: 14px; background: #f8fafc; border-radius: 10px; border-left: 3px solid #8b5cf6;">
            <p style="margin: 0; color: #64748b; font-size: 13px;">💡 ${escapeHtml(analysis.skillsGap.recommendations)}</p>
          </div>
        ` : ''}
      </div>
    ` : '';

    // Build Quantification Section
    const quantHtml = safeArray(analysis.quantificationOpportunities).length ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #10b981;">
          <span style="font-size: 18px; margin-right: 10px;">📈</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">Quantification Opportunities</span>
        </div>
        ${analysis.quantificationOpportunities!.map(opp => `
          <div style="margin-bottom: 16px; padding: 16px; background: #f8fafc; border-radius: 12px;">
            <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">"${escapeHtml(opp.context)}"</p>
            <p style="margin: 0 0 12px 0; color: #1e293b; font-size: 14px;">→ ${escapeHtml(opp.suggestion)}</p>
            <div style="padding: 12px; background: #dcfce7; border-radius: 8px;">
              <p style="margin: 0 0 4px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #166534; font-weight: 600;">Example</p>
              <p style="margin: 0; font-weight: 600; color: #166534; font-size: 14px;">${escapeHtml(opp.example)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    // Build Bullets Section
    const bulletsHtml = optimizedBullets.length ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #10b981;">
          <span style="font-size: 18px; margin-right: 10px;">✓</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">ATS-Optimized Bullet Points</span>
        </div>
        ${optimizedBullets.map(b => `
          <div style="margin-bottom: 20px; padding: 20px; background: #f8fafc; border-radius: 12px;">
            <div style="margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; font-weight: 600;">Before</p>
              <p style="margin: 0; color: #94a3b8; text-decoration: line-through; font-size: 14px; line-height: 1.5;">${escapeHtml(b.original)}</p>
            </div>
            <div style="margin-bottom: 12px;">
              <p style="margin: 0 0 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #10b981; font-weight: 600;">After</p>
              <p style="margin: 0; color: #166534; font-weight: 600; font-size: 14px; line-height: 1.5;">${escapeHtml(b.improved)}</p>
            </div>
            ${b.reason ? `<p style="margin: 0; color: #64748b; font-size: 12px; font-style: italic;">💡 ${escapeHtml(b.reason)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    // Build Action Verbs Section
    const verbsHtml = actionVerbs.length ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #f59e0b;">
          <span style="font-size: 18px; margin-right: 10px;">⚡</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">Stronger Action Verbs</span>
        </div>
        <table style="width: 100%; border-collapse: collapse; background: #fffbeb; border-radius: 12px; overflow: hidden;">
          ${actionVerbs.map((v, i) => `
            <tr style="border-bottom: ${i < actionVerbs.length - 1 ? '1px solid #fde68a' : 'none'};">
              <td style="padding: 12px 16px; color: #94a3b8; text-decoration: line-through; font-size: 14px; width: 40%;">${escapeHtml(v.weak)}</td>
              <td style="padding: 12px 8px; color: #d97706; font-size: 14px; width: 20%; text-align: center;">→</td>
              <td style="padding: 12px 16px; color: #b45309; font-weight: 700; font-size: 14px; width: 40%;">${escapeHtml(v.strong)}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : '';

    // Build Keywords Section
    const keywordsHtml = keywords.length ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #3b82f6;">
          <span style="font-size: 18px; margin-right: 10px;">🔑</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">Recommended Keywords</span>
        </div>
        <div style="padding: 20px; background: #eff6ff; border-radius: 12px;">
          <div>${keywords.map(k => `<span style="display: inline-block; margin: 5px; padding: 10px 18px; background: white; color: #2563eb; border: 2px solid #bfdbfe; border-radius: 25px; font-size: 14px; font-weight: 600;">${escapeHtml(k)}</span>`).join('')}</div>
          <p style="margin: 16px 0 0 0; color: #3b82f6; font-size: 13px;">💡 Naturally incorporate these into your experience bullets and skills section.</p>
        </div>
      </div>
    ` : '';

    // Build Red Flags Section
    const redFlagsHtml = redFlags.length ? `
      <div style="margin-bottom: 32px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #ef4444;">
          <span style="font-size: 18px; margin-right: 10px;">⚠️</span>
          <span style="font-size: 16px; font-weight: 700; color: #1e293b;">Red Flags to Fix</span>
        </div>
        ${redFlags.map(r => `
          <div style="margin-bottom: 12px; padding: 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 0 12px 12px 0;">
            <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5;">${escapeHtml(r)}</p>
          </div>
        `).join('')}
      </div>
    ` : '';

    // Final Email HTML
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Resume Analysis Report</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 680px; margin: 0 auto; padding: 0; background: #f1f5f9;">
        
        <!-- Wrapper -->
        <div style="background: #f1f5f9; padding: 40px 20px;">
          <div style="background: white; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
            
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #06b6d4 100%); color: white; padding: 48px 40px; text-align: center;">
              <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.2); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                <span style="font-size: 32px;">📋</span>
              </div>
              <h1 style="margin: 0 0 8px 0; font-size: 32px; font-weight: 800; letter-spacing: -0.5px;">Resume Booster</h1>
              <p style="margin: 0 0 20px 0; font-size: 16px; opacity: 0.9;">Your Complete Analysis Report</p>
              ${analysis.industry ? `
                <div style="display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: rgba(255,255,255,0.15); border-radius: 30px; font-size: 14px; backdrop-filter: blur(10px);">
                  <span style="font-weight: 600;">${escapeHtml(analysis.industry)}</span>
                  <span style="opacity: 0.6;">•</span>
                  <span style="text-transform: capitalize;">${escapeHtml(analysis.experienceLevel || 'Professional')} Level</span>
                  ${analysis.hasLinkedIn ? `<span style="opacity: 0.6;">•</span><span>+ LinkedIn</span>` : ''}
                </div>
              ` : ''}
            </div>

            <!-- Content -->
            <div style="padding: 40px;">
              ${atsScoreHtml}
              ${resumeLengthHtml}
              ${readabilityFormatHtml}
              ${linkedInHtml}
              ${summaryHtml}
              ${industryHtml}
              ${skillsHtml}
              ${quantHtml}
              ${bulletsHtml}
              ${verbsHtml}
              ${keywordsHtml}
              ${redFlagsHtml}

              <!-- CTA -->
              <div style="text-align: center; margin: 48px 0 24px 0;">
                <a href="${shareUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 18px 48px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                  View Full Analysis Online →
                </a>
              </div>
            </div>

            <!-- Footer -->
            <div style="border-top: 1px solid #e2e8f0; padding: 32px 40px; text-align: center; background: #f8fafc;">
              <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">This analysis was generated by Resume Booster</p>
              <p style="margin: 0; color: #94a3b8; font-size: 13px;">Apply these changes and watch your interview rate improve!</p>
            </div>

          </div>
          
          <!-- Email Footer -->
          <div style="text-align: center; padding: 24px 0;">
            <p style="margin: 0; color: #94a3b8; font-size: 12px;">
              © ${new Date().getFullYear()} Resume Booster • Save this email to access your results anytime
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    logStep("Sending email");

    const emailResponse = await resend.emails.send({
      from: "Resume Booster <onboarding@resend.dev>",
      to: [email],
      subject: `Your Complete Resume Analysis Report - ${analysis.industry || 'Professional'} Resume`,
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
