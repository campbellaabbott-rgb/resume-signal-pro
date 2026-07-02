// Owner notifications: emails the site owner when a new account is created
// (fired by a DB trigger on auth.users) or a scan completes (fired by
// free-keyword-scan). Recipient is fixed server-side, so the worst abuse case
// is noise to the owner inbox; a per-instance rate cap bounds even that.

import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

// Cheap flood guard: max sends per instance per hour.
let sentThisWindow = 0;
let windowStart = Date.now();
const MAX_PER_HOUR = 100;

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (Date.now() - windowStart > 3600_000) { windowStart = Date.now(); sentThisWindow = 0; }
    if (sentThisWindow >= MAX_PER_HOUR) {
      return new Response(JSON.stringify({ skipped: "rate-capped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "email not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));

    // DB webhook payloads (auth.users trigger) arrive as { type: "INSERT", record: {...} }
    let kind: "signup" | "scan" | null = null;
    let subject = "";
    let lines: string[] = [];

    if (body.type === "INSERT" && body.record?.email) {
      kind = "signup";
      subject = `🎉 New account: ${body.record.email}`;
      lines = [
        `<b>${escapeHtml(body.record.email)}</b> just created an account.`,
        `Signed up at: ${escapeHtml(body.record.created_at ?? new Date().toISOString())}`,
      ];
    } else if (body.type === "signup" && body.email) {
      kind = "signup";
      subject = `🎉 New account: ${body.email}`;
      lines = [`<b>${escapeHtml(body.email)}</b> just created an account.`];
    } else if (body.type === "scan") {
      kind = "scan";
      subject = `📄 New scan: ${body.score ?? "?"}/100 (${body.industry ?? "unknown"})`;
      lines = [
        `Score: <b>${escapeHtml(body.score ?? "?")}</b>/100`,
        `Industry: <b>${escapeHtml((body.industry ?? "unknown").replace(/_/g, " "))}</b>`,
        body.country ? `Country: ${escapeHtml(body.country)}` : "",
        body.authed != null ? `Signed-in user: ${body.authed ? "yes" : "no"}` : "",
      ].filter(Boolean);
    }

    if (!kind) {
      return new Response(JSON.stringify({ error: "unrecognized payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [OWNER_EMAIL],
      subject,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">${lines.map(l => `<p style="margin:4px 0">${l}</p>`).join("")}<p style="font-size:11px;color:#94a3b8;margin-top:14px">Automated owner notification · resumebooster.work</p></div>`,
    });
    if (error) {
      console.error("[NOTIFY-OWNER] send failed:", error);
      return new Response(JSON.stringify({ error: "send failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    sentThisWindow++;
    return new Response(JSON.stringify({ success: true, kind }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[NOTIFY-OWNER] Uncaught:", e);
    return new Response(JSON.stringify({ error: "unexpected" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
