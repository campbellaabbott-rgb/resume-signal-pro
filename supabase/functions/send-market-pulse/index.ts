// deploy-stamp: 2026-07-04T18:44Z
// Market pulse — the product's retention loop. Sends each opted-in subscriber
// a short email with the current must-have keywords for their industry and a
// free-rescan nudge. Trigger on a schedule (Supabase dashboard cron or any
// external scheduler) with: POST /send-market-pulse { "action": "send" }.
// Unsubscribe is a GET link with an HMAC token so it works from any mail client.

import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KEYWORD_FREQUENCY } from "../_shared/market-intelligence.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://resumebooster.work";
// Resend at most every 28 days per subscriber, regardless of trigger cadence
const MIN_DAYS_BETWEEN_SENDS = 28;

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function hmacToken(email: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "pulse-secret";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

function buildDigest(industry: string): { mustHave: string[]; common: string[] } | null {
  const table = KEYWORD_FREQUENCY[industry] ?? KEYWORD_FREQUENCY["general"];
  if (!table) return null;
  const mustHave = Object.entries(table).filter(([, w]) => w === 3).map(([k]) => k).slice(0, 6);
  const common = Object.entries(table).filter(([, w]) => w === 2).map(([k]) => k).slice(0, 6);
  if (mustHave.length === 0 && common.length === 0) return null;
  return { mustHave, common };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const url = new URL(req.url);

  // ── Unsubscribe (GET link from the email) ────────────────────────────────
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const email = (url.searchParams.get("email") ?? "").toLowerCase();
    const token = url.searchParams.get("token") ?? "";
    const expected = await hmacToken(email);
    if (!email || token !== expected) {
      return new Response("Invalid unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
    }
    await supabase.from("market_pulse_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("email", email);
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>You're unsubscribed.</h2><p>No more market pulse emails. You can re-subscribe from any future scan.</p></body></html>",
      { headers: { "Content-Type": "text/html" } },
    );
  }

  // ── Batch send (scheduled trigger) ───────────────────────────────────────
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "send") {
      return new Response(JSON.stringify({ error: "POST { action: 'send' } to run a pulse batch" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const resend = new Resend(RESEND_API_KEY);

    const cutoff = new Date(Date.now() - MIN_DAYS_BETWEEN_SENDS * 24 * 3600 * 1000).toISOString();
    const { data: subs, error } = await supabase
      .from("market_pulse_subscribers")
      .select("email, industry, last_score, last_sent_at")
      .is("unsubscribed_at", null)
      .or(`last_sent_at.is.null,last_sent_at.lt.${cutoff}`)
      .limit(200); // batch cap per invocation — schedule handles the rest

    if (error) throw error;
    let sent = 0, skipped = 0;

    for (const sub of subs ?? []) {
      const digest = buildDigest(sub.industry);
      if (!digest) { skipped++; continue; }
      const token = await hmacToken(sub.email);
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-market-pulse?action=unsubscribe&email=${encodeURIComponent(sub.email)}&token=${token}`;
      const rescanUrl = `${SITE_URL}/?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan`;
      const industryLabel = sub.industry.replace(/_/g, " ");

      // Personal progress — accounts with scan history get THEIR trend, not
      // just their industry's. Service-role RPC resolves scores by email.
      let progressHtml = "";
      try {
        const { data: trend } = await supabase.rpc("get_user_score_trend", { p_email: sub.email });
        if (Array.isArray(trend) && trend.length >= 2) {
          const newest = trend[0].ats_score;
          const oldest = trend[trend.length - 1].ats_score;
          const diff = newest - oldest;
          const diffColor = diff >= 0 ? "#16a34a" : "#dc2626";
          progressHtml = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:0 0 16px">
        <h3 style="font-size:12px;color:#111;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">Your progress</h3>
        <p style="font-size:13px;color:#444;margin:0">
          Across your last ${trend.length} scans: <b>${escapeHtml(oldest)}</b> → <b>${escapeHtml(newest)}</b>
          <span style="color:${diffColor};font-weight:700">(${diff >= 0 ? "+" : ""}${escapeHtml(diff)})</span>
          ${diff > 0 ? " — keep going." : diff === 0 ? " — a fresh scan against this month's keywords could move it." : " — worth a fresh look at the fix plan."}
        </p>
      </div>`;
        }
      } catch { /* progress is a bonus, never blocks the pulse */ }

      const kwPills = (words: string[], bg: string, color: string) =>
        words.map(w => `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;margin:0 4px 6px 0">${escapeHtml(w)}</span>`).join("");

      const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Market pulse · ${escapeHtml(industryLabel)}</div>
    </div>
    <div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e2e8f0">
      <p style="font-size:15px;color:#111;font-weight:600;margin:0 0 12px">Here's what ${escapeHtml(industryLabel)} job postings are screening for right now.</p>
      ${progressHtml}
      ${digest.mustHave.length ? `<h3 style="font-size:12px;color:#111;margin:14px 0 8px;text-transform:uppercase;letter-spacing:0.5px">In 80%+ of postings</h3><div>${kwPills(digest.mustHave, "#fef2f2", "#dc2626")}</div>` : ""}
      ${digest.common.length ? `<h3 style="font-size:12px;color:#111;margin:14px 0 8px;text-transform:uppercase;letter-spacing:0.5px">In 50–79% of postings</h3><div>${kwPills(digest.common, "#fffbeb", "#d97706")}</div>` : ""}
      <p style="font-size:13px;color:#444;margin:16px 0 0">${sub.last_score ? `Your last scan scored <b>${escapeHtml(sub.last_score)}/100</b>. ` : ""}Resumes drift out of date as postings change — a fresh scan takes about 60 seconds and is free.</p>
      <div style="text-align:center;margin-top:20px">
        <a href="${rescanUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:12px 26px;border-radius:10px;text-decoration:none">Rescan my resume free</a>
      </div>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;line-height:1.5">
      You asked for market updates when you emailed yourself a scan report.<br>
      <a href="${unsubUrl}" style="color:#94a3b8">Unsubscribe</a> — one click, no login.
    </p>
  </div>
</body></html>`;

      const { error: sendErr } = await resend.emails.send({
        from: "Resume Booster <reports@resumebooster.work>",
        to: [sub.email],
        subject: `${industryLabel} postings shifted — is your resume current?`,
        html,
      });
      if (sendErr) { console.error("[MARKET-PULSE] send failed for", sub.email, sendErr); skipped++; continue; }
      await supabase.from("market_pulse_subscribers")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("email", sub.email);
      sent++;
    }

    console.log(`[MARKET-PULSE] Batch complete: sent=${sent} skipped=${skipped}`);
    return new Response(JSON.stringify({ success: true, sent, skipped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[MARKET-PULSE] Uncaught:", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
