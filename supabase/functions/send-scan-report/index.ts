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

    const scoreColor = body.score >= 70 ? "#22c55e" : body.score >= 50 ? "#f59e0b" : "#ef4444";
    const rows: string[] = [];

    if (body.verdict) {
      rows.push(`<p style="font-size:15px;line-height:1.5;color:#111;font-weight:600">${escapeHtml(body.verdict)}</p>`);
    }
    rows.push(`
      <div style="text-align:center;padding:16px 0">
        <span style="font-size:44px;font-weight:800;color:${scoreColor}">${escapeHtml(Math.round(body.score))}</span>
        <span style="font-size:16px;color:#666">/100 ATS score</span>
        ${body.projectedScore ? `<div style="font-size:13px;color:#22c55e;margin-top:4px">→ ~${escapeHtml(Math.round(body.projectedScore))} after the fixes below</div>` : ""}
      </div>`);

    if (body.scoreBreakdown) {
      rows.push(`<p style="font-size:13px;color:#444">Keyword match: <b>${escapeHtml(body.scoreBreakdown.keywords)}%</b> · Format: <b>${escapeHtml(body.scoreBreakdown.format)}%</b> · Quantification: <b>${escapeHtml(body.scoreBreakdown.quantification)}%</b></p>`);
    }
    if (body.peerPercentile != null || body.applicationPassRate != null) {
      rows.push(`<p style="font-size:13px;color:#444">${body.peerPercentile != null ? `Peer percentile: <b>${escapeHtml(body.peerPercentile)}</b>` : ""}${body.peerPercentile != null && body.applicationPassRate != null ? " · " : ""}${body.applicationPassRate != null ? `Est. ATS pass rate: <b>${escapeHtml(body.applicationPassRate)}%</b>` : ""}</p>`);
    }
    if (body.redFlags && body.redFlags.length > 0) {
      rows.push(`<h3 style="font-size:14px;color:#111;margin:18px 0 6px">Top issues</h3><ol style="font-size:13px;color:#444;padding-left:18px;margin:0">${body.redFlags.slice(0, 3).map(f => `<li style="margin-bottom:4px">${escapeHtml(f.issue)}</li>`).join("")}</ol>`);
    }
    if (body.fixRoadmap && body.fixRoadmap.steps.length > 0) {
      rows.push(`<h3 style="font-size:14px;color:#111;margin:18px 0 6px">Your ${escapeHtml(body.fixRoadmap.totalMinutes)}-minute fix plan</h3><ol style="font-size:13px;color:#444;padding-left:18px;margin:0">${body.fixRoadmap.steps.map(s => `<li style="margin-bottom:4px">${escapeHtml(s.step)} <span style="color:#888">(~${escapeHtml(s.minutes)} min, +${escapeHtml(s.scoreImpact)} pts)</span></li>`).join("")}</ol>`);
    }

    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e5e5">
      <h1 style="font-size:18px;color:#2563eb;margin:0 0 4px">Resume Booster</h1>
      <p style="font-size:12px;color:#888;margin:0 0 16px">Your free scan summary</p>
      ${rows.join("\n")}
      <div style="text-align:center;margin-top:24px">
        <a href="https://resumebooster.app" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none">Get the full analysis</a>
      </div>
      <p style="font-size:11px;color:#aaa;margin-top:20px">Your resume was never stored — this summary contains only the analysis results you requested.</p>
    </div>
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
