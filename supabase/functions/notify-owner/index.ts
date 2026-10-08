// deploy-stamp: 2026-10-08T12:00Z
// Owner notifications: emails the site owner when a new account is created
// (fired by a DB trigger on auth.users) or a scan completes (fired by
// free-keyword-scan). Recipient is fixed server-side.
//
// IT ANSWERED ANYONE (register L10-13). Any script could POST {type:'signup',
// email:'ceo@bigco.com'} in a loop: a forgeable "New account" signal (and this
// project has a recorded fake-audience history), and every send spent the
// Resend quota paid delivery shares, bounded only by a per-isolate counter.
// Now it answers only our own callers -- the auth.users trigger sends the
// vault's cron key as x-email-cron (20261008123000), free-keyword-scan sends
// the service role -- and the hourly ceiling is counted in the database
// (mail_door_take), not in one isolate's memory.
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isScheduledCaller } from "../_shared/email-cron.ts";

const FN_BUILD = "notify-owner.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";
/** Owner notes an hour, all kinds together, counted in the database. */
const MAX_PER_HOUR = 100;

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** One line for a subject: no control characters, no line breaks, clipped. */
const subjectSafe = (s: string, max = 120): string =>
  s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    if (!(await isScheduledCaller(req.headers, admin, serviceKey))) {
      return json({ error: "Owner notes come from our own servers only." }, 401);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[NOTIFY-OWNER] RESEND_API_KEY not configured; note not sent");
      return json({ error: "email not configured" }, 503);
    }

    const body = await req.json().catch(() => ({}));

    // DB webhook payloads (auth.users trigger) arrive as { type: "INSERT", record: {...} }
    let kind: "signup" | "scan" | null = null;
    let subject = "";
    let lines: string[] = [];

    if (body.type === "INSERT" && body.record?.email) {
      kind = "signup";
      subject = `🎉 New account: ${subjectSafe(String(body.record.email))}`;
      lines = [
        `<b>${escapeHtml(body.record.email)}</b> just created an account.`,
        `Signed up at: ${escapeHtml(body.record.created_at ?? new Date().toISOString())}`,
      ];
    } else if (body.type === "signup" && body.email) {
      kind = "signup";
      subject = `🎉 New account: ${subjectSafe(String(body.email))}`;
      lines = [`<b>${escapeHtml(body.email)}</b> just created an account.`];
    } else if (body.type === "scan") {
      kind = "scan";
      subject = subjectSafe(`📄 New scan: ${body.score ?? "?"}/100 (${body.industry ?? "unknown"})`);
      lines = [
        `Score: <b>${escapeHtml(body.score ?? "?")}</b>/100`,
        `Industry: <b>${escapeHtml(String(body.industry ?? "unknown").replace(/_/g, " "))}</b>`,
        body.country ? `Country: ${escapeHtml(body.country)}` : "",
        body.authed != null ? `Signed-in user: ${body.authed ? "yes" : "no"}` : "",
      ].filter(Boolean);
    }

    if (!kind) return json({ error: "unrecognized payload" }, 400);

    // The ceiling, counted where every isolate sees the same number.
    const { data: allowed, error: doorErr } = await admin.rpc("mail_door_take", {
      p_door: "notify-owner", p_bucket: "all", p_max: MAX_PER_HOUR, p_window_minutes: 60,
    });
    if (doorErr) {
      console.error("[NOTIFY-OWNER] the hourly count could not be taken; note not sent:", doorErr.message?.slice(0, 160));
      return json({ error: "try again later" }, 503);
    }
    if (allowed !== true) return json({ skipped: "rate-capped" });

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [OWNER_EMAIL],
      subject,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#111">${lines.map(l => `<p style="margin:4px 0">${l}</p>`).join("")}<p style="font-size:11px;color:#94a3b8;margin-top:14px">Automated owner notification · resumebooster.work</p></div>`,
    });
    if (error) {
      console.error("[NOTIFY-OWNER] send failed:", error);
      return json({ error: "send failed" }, 502);
    }

    return json({ success: true, kind });
  } catch (e) {
    console.error("[NOTIFY-OWNER] Uncaught:", e);
    return json({ error: "unexpected" }, 500);
  }
});
