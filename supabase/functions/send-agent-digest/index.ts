// Agent morning email — the last hop of the overnight loop.
//
// agent-runner already scores fresh postings against each mandate and writes
// the survivors to agent_queue with their REASONS. Until now nothing told the
// candidate: the Morning Queue was a page you had to remember to open. This
// sends the shortlist, with the same reasons the UI shows, before they're up.
//
// Discipline this inherits from the rest of the platform:
//   - Never email an empty shortlist. No picks = no send, and the cursor does
//     NOT advance, so tomorrow's mail still covers today's window.
//   - Entitlement is re-checked at SEND time against agent_subscribers, not
//     assumed from the mandate — a lapsed subscriber stops receiving.
//   - Reasons are the stored ones. This email never re-derives or embellishes:
//     if the runner didn't record a reason, the email doesn't claim one.
//   - The agent NEVER applies. Every row links out for the human to press send.
//
// Trigger on a schedule shortly after agent-runner: POST {"action":"send"}.
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE_URL = "https://resumebooster.work";
// Never more than one morning mail per ~20h, even if the cron double-fires.
const MIN_HOURS_BETWEEN_SENDS = 20;
const MAX_ROWS_IN_EMAIL = 6;

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function hmacToken(id: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "digest-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id.toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Reason = { k: string; pct?: number; n?: number; days?: number; top?: string[] };

/** Render the runner's stored reasons as plain English. Only what it recorded. */
function reasonText(reasons: unknown): string {
  const rs = Array.isArray(reasons) ? reasons as Reason[] : [];
  const out: string[] = [];
  for (const r of rs) {
    if (r.k === "fit" && typeof r.pct === "number") {
      const top = Array.isArray(r.top) ? r.top.filter(Boolean).slice(0, 3) : [];
      out.push(top.length ? `${r.pct}% match · ${top.join(", ")}` : `${r.pct}% match`);
    } else if (r.k === "fills" && typeof r.n === "number") {
      out.push(`${r.n} roles actually filled recently`);
    } else if (r.k === "fresh" && typeof r.days === "number") {
      out.push(r.days === 0 ? "posted today" : r.days === 1 ? "posted yesterday" : `posted ${r.days}d ago`);
    } else if (r.k === "salary") {
      out.push("meets your pay floor");
    }
  }
  return out.join(" · ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const url = new URL(req.url);

  // ── Unsubscribe (GET from the email) — flips email_opt_in off ──
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    const id = url.searchParams.get("id") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (!id || token !== await hmacToken(id)) {
      return new Response("Invalid unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
    }
    await supabase.from("agent_mandates").update({ email_opt_in: false }).eq("user_id", id);
    return new Response(
      "You're unsubscribed from the morning shortlist. Your Apply Agent keeps running — the picks are still waiting in your account.",
      { status: 200, headers: { "Content-Type": "text/plain" } },
    );
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const resend = new Resend(RESEND_API_KEY);

    const { data: mandates } = await supabase
      .from("agent_mandates")
      .select("user_id, email, email_opt_in, email_last_sent_at")
      .eq("email_opt_in", true)
      .limit(500);

    const list = (mandates ?? []) as Array<{ user_id: string; email: string; email_opt_in: boolean; email_last_sent_at: string | null }>;
    if (list.length === 0) return json({ ok: true, sent: 0, skipped: 0, note: "no opted-in mandates" });

    // Entitlement at SEND time — a lapsed subscriber stops receiving.
    const emails = [...new Set(list.map((m) => m.email).filter(Boolean))];
    const entitled = new Set<string>();
    if (emails.length) {
      const { data: subs } = await supabase
        .from("agent_subscribers")
        .select("email, status, current_period_end")
        .in("email", emails);
      for (const s of (subs ?? []) as Array<{ email: string; status: string; current_period_end: string | null }>) {
        const periodOk = !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now();
        if ((s.status === "active" || s.status === "trialing") && periodOk) entitled.add(s.email);
      }
    }

    // Global unsubscribes win over everything.
    const { data: suppressedRows } = await supabase.from("suppressed_emails").select("email");
    const suppressed = new Set(((suppressedRows ?? []) as Array<{ email: string }>).map((r) => r.email.toLowerCase()));

    let sent = 0, skipped = 0;
    for (const m of list) {
      if (!m.email || !entitled.has(m.email) || suppressed.has(m.email.toLowerCase())) { skipped++; continue; }

      // Rate floor: never twice in one morning.
      if (m.email_last_sent_at && Date.now() - new Date(m.email_last_sent_at).getTime() < MIN_HOURS_BETWEEN_SENDS * 3600_000) {
        skipped++; continue;
      }

      // Only picks the user hasn't been told about. Still 'ready' = not yet
      // approved or dismissed in the UI, so the mail never re-surfaces a
      // posting they already actioned.
      let q = supabase.from("agent_queue")
        .select("posting_id, title, company, location, apply_url, salary, fit_pct, reasons, created_at")
        .eq("user_id", m.user_id)
        .eq("status", "ready")
        .order("fit_pct", { ascending: false })
        .limit(MAX_ROWS_IN_EMAIL);
      if (m.email_last_sent_at) q = q.gt("created_at", m.email_last_sent_at);
      const { data: picks } = await q;

      const rows = (picks ?? []) as Array<{
        posting_id: string; title: string; company: string; location: string | null;
        apply_url: string; salary: string | null; fit_pct: number | null; reasons: unknown;
      }>;
      // Never email an empty shortlist, and DON'T advance the cursor — tomorrow's
      // mail must still cover today's window.
      if (rows.length === 0) { skipped++; continue; }

      const token = await hmacToken(m.user_id);
      const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-agent-digest?action=unsubscribe&id=${encodeURIComponent(m.user_id)}&token=${token}`;
      const queueUrl = `${SITE_URL}/account?utm_source=email&utm_medium=agent_digest#agent`;

      const itemsHtml = rows.map((r) => {
        const why = reasonText(r.reasons);
        return `
        <tr><td style="padding:12px 0;border-bottom:1px solid #eef2f7">
          <div style="font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(r.title)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(r.company)}${r.location ? " · " + escapeHtml(r.location) : ""}${r.salary ? " · " + escapeHtml(r.salary) : ""}</div>
          ${why ? `<div style="font-size:12px;color:#16a34a;margin-top:3px">${escapeHtml(why)}</div>` : ""}
        </td><td style="padding:12px 0;border-bottom:1px solid #eef2f7;text-align:right;vertical-align:middle">
          <a href="${escapeHtml(r.apply_url)}" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600">Open&nbsp;→</a>
        </td></tr>`;
      }).join("");

      const n = rows.length;
      const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Your Apply Agent · overnight shortlist</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px">
      <p style="font-size:15px;color:#0f172a;margin:0 0 4px"><b>${escapeHtml(n)}</b> ${n === 1 ? "role is" : "roles are"} worth your morning</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 16px">
        Checked overnight against your résumé, straight from companies' own job boards.
        Churny employers were skipped; each line says why it made the list.
      </p>
      <table style="width:100%;border-collapse:collapse">${itemsHtml}</table>
      <div style="text-align:center;margin-top:20px">
        <a href="${escapeHtml(queueUrl)}" style="display:inline-block;background:#2563eb;color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">Review in your queue</a>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin:16px 0 0;text-align:center">
        We never submit anything for you — you always press send.
      </p>
    </div>
    <div style="text-align:center;padding:14px 0 0">
      <a href="${escapeHtml(unsubUrl)}" style="font-size:11px;color:#94a3b8">Stop these morning emails</a>
    </div>
  </div>
</body></html>`;

      try {
        await resend.emails.send({
          from: "Resume Booster <agent@resumebooster.work>",
          to: [m.email],
          subject: n === 1 ? "1 role worth your morning" : `${n} roles worth your morning`,
          html,
        });
        await supabase.from("agent_mandates")
          .update({ email_last_sent_at: new Date().toISOString() })
          .eq("user_id", m.user_id);
        sent++;
      } catch (e) {
        // Send failed — leave the cursor alone so the next run retries this window.
        console.warn(`[AGENT-DIGEST] send failed for ${m.user_id}:`, (e as Error)?.message?.slice(0, 150));
        skipped++;
      }
    }

    return json({ ok: true, sent, skipped });
  } catch (e) {
    console.error("[AGENT-DIGEST] error:", (e as Error)?.message);
    return json({ error: "Agent digest temporarily unavailable" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
