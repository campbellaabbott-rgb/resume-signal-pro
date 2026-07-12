// Feature 5 — tracked-job closure alerts. For users who opted in, detect when
// a posting they're tracking has left the board (server-side, so it doesn't
// depend on them opening their account) and email them once per closure.
// Opt-in: user_profiles.closure_alerts_opt_in. Schedule: POST { action:"send" }.
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE_URL = "https://resumebooster.work";

function escapeHtml(x: string | number | null | undefined): string {
  if (x === undefined || x === null) return "";
  return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
async function hmacToken(id: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "closure-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id.toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // Unsubscribe — turns the profile flag off.
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const uid = url.searchParams.get("uid") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (!uid || token !== (await hmacToken(uid))) return new Response("Invalid unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
    await supabase.from("user_profiles").update({ closure_alerts_opt_in: false }).eq("user_id", uid);
    return new Response(
      "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>Turned off.</h2><p>No more closure alerts. Your application tracker still shows posting status when you visit.</p></body></html>",
      { headers: { "Content-Type": "text/html" } },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "send") return new Response(JSON.stringify({ error: "POST { action: 'send' }" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const resend = new Resend(RESEND_API_KEY);
    const boardBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // Opted-in users only.
    const { data: profiles } = await supabase.from("user_profiles").select("user_id").eq("closure_alerts_opt_in", true).limit(1000);
    const optedIn = (profiles ?? []).map((p) => p.user_id as string);
    if (optedIn.length === 0) return new Response(JSON.stringify({ ok: true, detected: 0, notified: 0, reason: "no opted-in users" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ── Detection: tracked jobs still believed open — are they still on the
    // board? A job_id no longer in the corpus means the posting closed.
    const { data: openApps } = await supabase
      .from("user_applications")
      .select("id, job_id, user_id")
      .in("user_id", optedIn)
      .not("job_id", "is", null)
      .is("posting_closed_at", null)
      .limit(4000);
    const ids = [...new Set((openApps ?? []).map((a) => a.job_id as string))];
    let detected = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const resp = await fetch(boardBase, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exists", ids: batch }),
      }).then((r) => r.json()).catch(() => null);
      const open = (resp as { open?: Record<string, boolean> } | null)?.open;
      if (!open) continue;
      const closedIds = batch.filter((id) => open[id] === false);
      if (closedIds.length === 0) continue;
      const nowIso = new Date().toISOString();
      for (let j = 0; j < closedIds.length; j += 100) {
        const { count } = await supabase.from("user_applications")
          .update({ posting_closed_at: nowIso, posting_checked_at: nowIso }, { count: "exact" })
          .in("job_id", closedIds.slice(j, j + 100)).is("posting_closed_at", null);
        detected += count ?? 0;
      }
    }

    // ── Notification: closed but not yet emailed, for opted-in users.
    const { data: toNotify } = await supabase
      .from("user_applications")
      .select("id, user_id, company, role, posting_closed_at")
      .in("user_id", optedIn)
      .not("posting_closed_at", "is", null)
      .is("posting_closed_notified_at", null)
      .limit(2000);

    const byUser = new Map<string, Array<{ id: string; company: string; role: string }>>();
    for (const a of toNotify ?? []) {
      const arr = byUser.get(a.user_id as string) ?? [];
      arr.push({ id: a.id as string, company: (a.company as string) ?? "A company", role: (a.role as string) ?? "" });
      byUser.set(a.user_id as string, arr);
    }

    let notified = 0;
    for (const [uid, apps] of byUser) {
      const { data: userRes } = await supabase.auth.admin.getUserById(uid);
      const email = userRes?.user?.email?.toLowerCase();
      const notifiedIds = apps.map((a) => a.id);
      if (!email) {
        await supabase.from("user_applications").update({ posting_closed_notified_at: new Date().toISOString() }).in("id", notifiedIds);
        continue;
      }
      const { data: sup } = await supabase.from("suppressed_emails").select("email").eq("email", email).maybeSingle();
      if (sup) {
        await supabase.from("user_applications").update({ posting_closed_notified_at: new Date().toISOString() }).in("id", notifiedIds);
        continue;
      }
      const token = await hmacToken(uid);
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-closed-jobs?action=unsubscribe&uid=${encodeURIComponent(uid)}&token=${token}`;
      const rows = apps.slice(0, 20).map((a) => `<li style="margin:0 0 6px;font-size:14px;color:#0f172a"><b>${escapeHtml(a.company)}</b>${a.role ? ` — ${escapeHtml(a.role)}` : ""}</li>`).join("");
      const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Application tracker</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px">
      <p style="font-size:15px;color:#0f172a;margin:0 0 4px"><b>${apps.length}</b> posting${apps.length === 1 ? "" : "s"} you're tracking ${apps.length === 1 ? "has" : "have"} closed</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 14px">${apps.length === 1 ? "It's" : "They're"} no longer on the company's job board — no point waiting on ${apps.length === 1 ? "it" : "them"} anymore.</p>
      <ul style="margin:0 0 14px;padding-left:18px">${rows}</ul>
      <div style="text-align:center;margin:18px 0 4px">
        <a href="${SITE_URL}/jobs?utm_source=email&utm_medium=closure_alert" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;text-decoration:none">Find fresh openings</a>
      </div>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:14px 0 0">You asked to be told when a tracked posting closes. <a href="${escapeHtml(unsubUrl)}" style="color:#94a3b8">Turn off</a>.</p>
  </div>
</body></html>`;
      try {
        await resend.emails.send({ from: "Resume Booster <reports@resumebooster.work>", to: email, subject: apps.length === 1 ? `A posting you're tracking closed — ${apps[0].company}` : `${apps.length} tracked postings have closed`, html });
        await supabase.from("user_applications").update({ posting_closed_notified_at: new Date().toISOString() }).in("id", notifiedIds);
        notified += apps.length;
      } catch (e) {
        console.error("[NOTIFY-CLOSED] send failed:", e instanceof Error ? e.message : e);
      }
    }
    return new Response(JSON.stringify({ ok: true, detected, notified, users: byUser.size }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[NOTIFY-CLOSED] error:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "notify run failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
