// deploy-stamp: 2026-07-04T18:44Z
// Sends the free scan summary to the user's email — our first lead-capture
// touchpoint. Uses the same Resend setup as send-analysis-email and stores
// the address in the leads table so follow-up campaigns have a source.

import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface ScanReportRequest {
  email: string;
  verdict?: string;
  score: number;
  projectedScore?: number | null;
  scoreBreakdown?: { keywords: number; format: number; quantification: number } | null;
  peerPercentile?: number | null;
  applicationPassRate?: number | null;
  redFlags?: Array<{ issue: string }>;
  fixRoadmap?: { steps: Array<{ order: number; step: string; minutes: number; scoreImpact: number }>; totalMinutes: number } | null;
  industry?: string;
  subscribePulse?: boolean;
  reportId?: string | null;
  scoreBand?: { low: number; high: number } | null;
  findingsSummary?: { critical: number; warnings: number; passed: number } | null;
  keywordSource?: { source: string; occupation?: string; code?: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ScanReportRequest = await req.json();
    const email = (body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof body.score !== "number" || !Number.isFinite(body.score)) {
      return new Response(JSON.stringify({ success: false, error: "Missing score" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Store the lead (non-blocking failure — email still sends)
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      await supabase.rpc("save_free_scan_lead", {
        p_email: email,
        p_ats_score: Math.round(body.score),
        p_industry: body.industry ?? null,
      });
      // Market pulse opt-in — explicit checkbox in the report UI
      if (body.subscribePulse) {
        await supabase.from("market_pulse_subscribers").upsert({
          email,
          industry: body.industry ?? "general",
          last_score: Math.round(body.score),
          unsubscribed_at: null,
        });
      }
    } catch (e) {
      console.warn("[SEND-SCAN-REPORT] Lead save failed (continuing):", e);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[SEND-SCAN-REPORT] RESEND_API_KEY not configured");
      return new Response(JSON.stringify({ success: false, error: "Email service not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SITE_URL = "https://resumebooster.work";
    const ctaUrl = `${SITE_URL}/?utm_source=email&utm_medium=scan_report&utm_campaign=free_scan#pricing`;
    const rescanUrl = `${SITE_URL}/?utm_source=email&utm_medium=scan_report&utm_campaign=rescan`;

    const score = Math.round(body.score);
    const scoreColor = score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
    const scoreBg = score >= 70 ? "#f0fdf4" : score >= 50 ? "#fffbeb" : "#fef2f2";
    const scoreLabel = score >= 70 ? "Good" : score >= 50 ? "Needs work" : "At risk";

    // Email-safe horizontal bar (nested divs degrade gracefully in Outlook)
    const bar = (label: string, value: number, color: string) => `
      <tr>
        <td style="padding:4px 0;font-size:12px;color:#555;width:110px">${escapeHtml(label)}</td>
        <td style="padding:4px 0">
          <div style="background:#eee;border-radius:6px;height:8px;width:100%">
            <div style="background:${color};border-radius:6px;height:8px;width:${Math.min(Math.max(value, 2), 100)}%"></div>
          </div>
        </td>
        <td style="padding:4px 0 4px 8px;font-size:12px;font-weight:700;color:#111;width:36px;text-align:right">${escapeHtml(value)}%</td>
      </tr>`;

    const rows: string[] = [];

    if (body.reportId) {
      rows.push(`<p style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 4px">Resume Diagnostic Report &nbsp;·&nbsp; #${escapeHtml(body.reportId)} &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</p>`);
    }
    if (body.findingsSummary) {
      const fs = body.findingsSummary;
      rows.push(`<p style="font-size:13px;margin:0 0 10px"><span style="color:#dc2626;font-weight:700">${escapeHtml(fs.critical)} critical</span> &nbsp;·&nbsp; <span style="color:#d97706;font-weight:700">${escapeHtml(fs.warnings)} warning${fs.warnings === 1 ? "" : "s"}</span> &nbsp;·&nbsp; <span style="color:#16a34a;font-weight:700">${escapeHtml(fs.passed)} passed</span></p>`);
    }
    if (body.verdict) {
      rows.push(`<p style="font-size:15px;line-height:1.55;color:#111;font-weight:600;margin:0 0 12px">${escapeHtml(body.verdict)}</p>`);
    }

    // Score panel
    rows.push(`
      <div style="background:${scoreBg};border:1px solid ${scoreColor}22;border-radius:12px;text-align:center;padding:20px 16px;margin:0 0 16px">
        <div style="font-size:52px;font-weight:800;color:${scoreColor};line-height:1">${escapeHtml(score)}<span style="font-size:18px;font-weight:400;color:#888">/100</span></div>
        <div style="display:inline-block;background:${scoreColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;margin-top:8px;letter-spacing:0.5px;text-transform:uppercase">${scoreLabel}</div>
        ${body.projectedScore && Math.round(body.projectedScore) > score ? `<div style="font-size:13px;color:#16a34a;margin-top:10px;font-weight:600">↗ Projected ~${escapeHtml(Math.round(body.projectedScore))} after your fix plan</div>` : ""}
        ${body.scoreBand ? `<div style="font-size:11px;color:#888;margin-top:6px">Modeling band ${escapeHtml(Math.round(body.scoreBand.low))}–${escapeHtml(Math.round(body.scoreBand.high))} — spans our deterministic calculation and the AI estimate</div>` : ""}
      </div>`);

    // Breakdown bars
    if (body.scoreBreakdown) {
      const sb = body.scoreBreakdown;
      rows.push(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
          ${bar("Keyword match", sb.keywords, "#2563eb")}
          ${bar("Format", sb.format, "#d97706")}
          ${bar("Quantification", sb.quantification, "#16a34a")}
        </table>`);
    }

    // Comparison stat boxes
    if (body.peerPercentile != null || body.applicationPassRate != null) {
      rows.push(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>
          ${body.peerPercentile != null ? `<td width="49%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:center;padding:12px 8px"><div style="font-size:22px;font-weight:800;color:#111">${escapeHtml(body.peerPercentile)}<span style="font-size:12px;color:#888">th</span></div><div style="font-size:11px;color:#666">percentile in your industry</div></td>` : ""}
          ${body.peerPercentile != null && body.applicationPassRate != null ? `<td width="2%"></td>` : ""}
          ${body.applicationPassRate != null ? `<td width="49%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:center;padding:12px 8px"><div style="font-size:22px;font-weight:800;color:#111">${escapeHtml(body.applicationPassRate)}<span style="font-size:12px;color:#888">%</span></div><div style="font-size:11px;color:#666">est. ATS pass rate</div></td>` : ""}
        </tr></table>`);
    }

    // Top issues with severity accents
    if (body.redFlags && body.redFlags.length > 0) {
      rows.push(`
        <h3 style="font-size:13px;color:#111;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">⚠️ Top issues</h3>
        ${body.redFlags.slice(0, 3).map((f, i) => `
          <div style="border-left:3px solid #dc2626;background:#fef2f2;border-radius:0 8px 8px 0;padding:8px 12px;margin:0 0 6px">
            <span style="font-size:13px;color:#333"><b style="color:#dc2626">${i + 1}.</b> ${escapeHtml(f.issue)}</span>
          </div>`).join("")}`);
    }

    // Fix plan as a checklist
    if (body.fixRoadmap && body.fixRoadmap.steps.length > 0) {
      rows.push(`
        <h3 style="font-size:13px;color:#111;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">✅ Your ${escapeHtml(body.fixRoadmap.totalMinutes)}-minute fix plan</h3>
        ${body.fixRoadmap.steps.slice(0, 8).map(s => `
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 6px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td style="font-size:13px;color:#333;line-height:1.4"><b style="color:#2563eb">${escapeHtml(s.order ?? "")}.</b> ${escapeHtml(s.step)}</td>
              <td style="white-space:nowrap;text-align:right;padding-left:10px;vertical-align:top">
                <span style="font-size:11px;color:#888">~${escapeHtml(s.minutes)} min</span>
                <span style="display:inline-block;background:#f0fdf4;color:#16a34a;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px;margin-left:4px">+${escapeHtml(s.scoreImpact)} pts</span>
              </td>
            </tr></table>
          </div>`).join("")}`);
    }

    if (body.keywordSource?.source === "onet" && body.keywordSource.code) {
      rows.push(`<p style="font-size:11px;color:#888;margin:14px 0 0">Keyword expectations sourced from O*NET ${escapeHtml(body.keywordSource.code)} (U.S. Department of Labor${body.keywordSource.occupation ? ` — ${escapeHtml(body.keywordSource.occupation)}` : ""}). Every quoted line in your full report is verified against your resume.</p>`);
    } else if (body.keywordSource?.source === "job_description") {
      rows.push(`<p style="font-size:11px;color:#888;margin:14px 0 0">Keyword analysis matched against the job posting you provided. Every quoted line in your full report is verified against your resume.</p>`);
    }

    const preheader = `Your resume scored ${score}/100 — ${body.fixRoadmap?.totalMinutes ? `a ${body.fixRoadmap.totalMinutes}-minute fix plan is inside.` : "your fix plan is inside."}`;

    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f1f5f9">${escapeHtml(preheader)}</div>
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Free scan summary · ${escapeHtml(new Date().toISOString().slice(0, 10))}</div>
    </div>
    <div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e2e8f0">
      ${rows.join("\n")}
      <div style="text-align:center;margin-top:22px">
        <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:700;padding:13px 30px;border-radius:10px;text-decoration:none">Get the full analysis →</a>
        <div style="margin-top:10px"><a href="${rescanUrl}" style="font-size:12px;color:#64748b;text-decoration:underline">Made the fixes? Rescan free to see your new score</a></div>
      </div>
      ${body.reportId ? `
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center">
        <p style="font-size:12px;color:#64748b;margin:0 0 8px">Applied with this resume? One click helps us measure which scores actually land interviews (anonymous):</p>
        <a href="https://resumebooster.work/?outcome=interview&rid=${escapeHtml(body.reportId)}" style="font-size:12px;color:#2563eb;text-decoration:underline;margin:0 6px">🎉 Got interviews</a>
        <a href="https://resumebooster.work/?outcome=no_response&rid=${escapeHtml(body.reportId)}" style="font-size:12px;color:#2563eb;text-decoration:underline;margin:0 6px">📭 No response</a>
        <a href="https://resumebooster.work/?outcome=rejected&rid=${escapeHtml(body.reportId)}" style="font-size:12px;color:#2563eb;text-decoration:underline;margin:0 6px">❌ Rejected</a>
      </div>` : ""}
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;line-height:1.5">
      Your resume was never stored — this summary contains only the analysis results you requested.<br>
      You received this because you asked for your scan report at resumebooster.work. No follow-up emails unless you ask.
    </p>
  </div>
</body></html>`;

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [email],
      subject: `Your resume scored ${Math.round(body.score)}/100 — here's your fix plan`,
      html,
    });

    if (error) {
      console.error("[SEND-SCAN-REPORT] Resend error:", error);
      return new Response(JSON.stringify({ success: false, error: "Failed to send email" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[SEND-SCAN-REPORT] Uncaught:", e);
    return new Response(JSON.stringify({ success: false, error: "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
