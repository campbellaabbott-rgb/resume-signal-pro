// deploy-stamp: 2026-10-04T22:00Z
// Market pulse -- the product's retention loop. Sends each CONFIRMED
// subscriber a short email with the current must-have keywords for their
// industry and a free-rescan nudge.
//
// Four actions, and who may use each:
//   POST {action:"subscribe", email, industry?, score?}  anyone (the report
//     page). Records a request and mails a single-use confirmation link to that
//     address -- at most one per address per 7 days, three in any 90 days while
//     unconfirmed, never to a suppressed address, and five requests an hour per
//     network (mail_door_take). Past 100 confirmation mails in a day only
//     networks that have not asked today are served, and 400 stops it for
//     everyone; either one tells the owner. Nothing else is ever sent to an
//     address that has not clicked its link.
//   POST {action:"confirm", token}  anyone holding a link from that mail.
//   POST {action:"send"}  the daily cron (x-email-cron, a vault key) or our own
//     service role. Nobody else: this used to answer any caller, so N
//     concurrent posts mailed every due subscriber N times (defect sweep 2.23).
//   GET ?action=unsubscribe&email=&token=  the HMAC link in pulse mails
//     already sent: it changes nothing and redirects to the confirm page on
//     resumebooster.work (mail scanners follow every link). Unsubscribing is a
//     POST with the same parameters -- that page's button, or the mail
//     client's RFC 8058 one-click (List-Unsubscribe-Post) -- register L10-14.
//
// WHY THE OPT-IN CHANGED (defect sweep 1.59). The report page's box was
// pre-ticked, and the address it subscribed was whatever anyone typed, so the
// list held people who never asked -- and the pulse then told them they had.
// Rows from that era stay unconfirmed and are never mailed.

import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { KEYWORD_FREQUENCY } from "../_shared/market-intelligence.ts";
import { sameSecret } from "../_shared/service-caller.ts";
import { networkBucket } from "../_shared/network-bucket.ts";
import { isScheduledCaller } from "../_shared/email-cron.ts";
import { alertOwnerOnce } from "../_shared/owner-alert.ts";
import { oneClickHeaders, oneClickUrl, redirectToConfirm, unsubscribeParams, unsubscribePageUrl } from "../_shared/unsubscribe-link.ts";

// Provable from outside without sending anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "send-market-pulse.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const SITE_URL = "https://resumebooster.work";
const CONFIRM_PATH = "/market-pulse/confirm";
const BATCH = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
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

/** An industry we have a table for, or "general" -- never a caller's string. */
function knownIndustry(v: unknown): string {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(KEYWORD_FREQUENCY, v) ? v : "general";
}

function confirmEmailHtml(industryLabel: string, link: string): string {
  return `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
    </div>
    <div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e2e8f0">
      <p style="font-size:15px;color:#111;font-weight:600;margin:0 0 12px">Confirm your monthly market pulse</p>
      <p style="font-size:14px;color:#444;margin:0 0 12px">Someone, hopefully you, asked us to email this address once a month with the keywords ${escapeHtml(industryLabel)} job postings are screening for.</p>
      <p style="font-size:14px;color:#444;margin:0 0 18px">Nothing is sent unless you confirm.</p>
      <div style="text-align:center">
        <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:12px 26px;border-radius:10px;text-decoration:none">Confirm the monthly pulse</a>
      </div>
      <p style="font-size:12px;color:#64748b;margin:18px 0 0">The link works once and expires in 7 days. If this wasn't you, ignore this email: without a click, this address gets no market pulse.</p>
    </div>
  </div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const url = new URL(req.url);

  // ── Unsubscribe (_shared/unsubscribe-link.ts) ───────────────────────────
  // A GET changes nothing and opens the confirm page; only a POST unsubscribes.
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    return redirectToConfirm("market-pulse", { email: url.searchParams.get("email") ?? "", token: url.searchParams.get("token") ?? "" });
  }

  if (req.method !== "POST") return json({ error: "POST an action." }, 405);

  const un = await unsubscribeParams(req, url);
  if (un) {
    const email = (un.email ?? "").toLowerCase();
    if (!email || !sameSecret(un.token ?? "", await hmacToken(email))) return json({ error: "invalid unsubscribe link" }, 400);
    const { error: unErr } = await supabase.from("market_pulse_subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("email", email);
    if (unErr) {
      console.error("[MARKET-PULSE] unsubscribe failed:", unErr.message);
      return json({ error: "could not unsubscribe right now" }, 503);
    }
    return json({ unsubscribed: true });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // ── Subscribe: a confirmation request, never a subscription ──────────
    if (body.action === "subscribe") {
      const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
      if (!EMAIL_RE.test(email)) return json({ success: false, error: "Enter a valid email address." }, 400);
      const industry = knownIndustry(body.industry);
      // A confirmation promises a monthly pulse, and the batch can only build
      // one for an industry with a keyword table. Anything else would be a
      // confirmed subscriber who never hears from us, so it is not offered.
      if (!buildDigest(industry)) {
        return json({ success: false, error: `The monthly pulse covers ${Object.keys(KEYWORD_FREQUENCY).map((k) => k.replace(/_/g, " ")).join(", ")} postings, and not this field yet.` }, 422);
      }
      const rawScore = Math.round(Number(body.score));
      const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, rawScore)) : null;

      // Five an hour per network (mail_door_take, whose window lasts as long
      // as it says). A count that cannot be taken keeps the door shut.
      const net = await networkBucket(req.headers, serviceKey, "market-pulse");
      const { data: allowed, error: rlError } = await supabase.rpc("mail_door_take", {
        p_door: "send-market-pulse:subscribe", p_bucket: net, p_max: 5, p_window_minutes: 60,
      });
      if (rlError) return json({ success: false, error: "Could not record that right now." }, 503);
      if (allowed !== true) return json({ success: false, error: "Too many requests. Please try again later." }, 429);

      const token = randomToken();
      const { data, error } = await supabase.rpc("market_pulse_request_confirm", {
        p_email: email, p_industry: industry, p_score: score, p_token_hash: await sha256Hex(token), p_net: net,
      }).maybeSingle();
      if (error) {
        console.error("[MARKET-PULSE] request_confirm failed:", error.message?.slice(0, 160));
        return json({ success: false, error: "Could not record that right now." }, 503);
      }
      const d = data as { pc_send?: boolean; pc_reason?: string } | null;
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (d?.pc_reason === "shed" || d?.pc_reason === "paused") {
        // The day is busy enough that real visitors may be turned away: the
        // owner hears once a day.
        await alertOwnerOnce(supabase, "send-market-pulse:subscribe",
          d.pc_reason === "paused" ? "reached its daily ceiling" : "passed its soft ceiling and is serving only new networks",
          async (m) => { if (RESEND_API_KEY) await new Resend(RESEND_API_KEY).emails.send({ from: "Resume Booster <reports@resumebooster.work>", ...m }); });
        // These two are about the caller's network and the day, never about
        // the address, so saying so tells nobody anything about that address.
        return d.pc_reason === "paused"
          ? json({ success: false, error: "Sign-ups are paused for today. Please try again tomorrow." }, 503)
          : json({ success: false, error: "Too many sign-ups from your network today. Please try again tomorrow." }, 429);
      }
      if (d?.pc_send) {
        if (!RESEND_API_KEY) return json({ success: false, error: "Email service not configured" }, 503);
        const link = `${SITE_URL}${CONFIRM_PATH}#t=${token}`;
        const { error: sendErr } = await new Resend(RESEND_API_KEY).emails.send({
          from: "Resume Booster <reports@resumebooster.work>",
          to: [email],
          subject: "Confirm your monthly market pulse",
          html: confirmEmailHtml(industry.replace(/_/g, " "), link),
        });
        if (sendErr) {
          console.error("[MARKET-PULSE] confirmation send failed");
          return json({ success: false, error: "Could not send the confirmation email." }, 502);
        }
      }
      // THE SAME ANSWER WHATEVER THE ADDRESS'S STATE. Whether that address is
      // already confirmed, recently asked, or suppressed is its owner's
      // business, not the business of whoever typed it.
      return json({ success: true, pending: true });
    }

    // ── Confirm: the click from the confirmation mail ─────────────────────
    if (body.action === "confirm") {
      const token = String(body.token ?? "");
      if (!/^[0-9a-f]{64}$/.test(token)) return json({ success: false, error: "This link is not valid." }, 400);
      const net = await networkBucket(req.headers, serviceKey, "market-pulse");
      const { data: allowed, error: rlError } = await supabase.rpc("mail_door_take", {
        p_door: "send-market-pulse:confirm", p_bucket: net, p_max: 20, p_window_minutes: 60,
      });
      if (rlError) return json({ success: false, error: "Could not confirm right now. Try the link again shortly." }, 503);
      if (allowed !== true) return json({ success: false, error: "Too many requests. Please try again later." }, 429);
      const { data, error } = await supabase.rpc("market_pulse_confirm", { p_token_hash: await sha256Hex(token) }).maybeSingle();
      if (error) return json({ success: false, error: "Could not confirm right now. Try the link again shortly." }, 503);
      const d = data as { cf_confirmed?: boolean } | null;
      if (!d?.cf_confirmed) return json({ success: false, error: "This link has expired or was already used." }, 410);
      return json({ success: true, confirmed: true });
    }

    // ── Batch send: the cron, or our own service role, and nobody else ───
    if (body.action === "send") {
      if (!(await isScheduledCaller(req.headers, supabase, serviceKey))) {
        return json({ error: "The batch send is for the scheduler only." }, 401);
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY not configured" }, 503);
      const resend = new Resend(RESEND_API_KEY);

      // THE CLAIM IS THE SELECTION. market_pulse_claim_batch stamps
      // last_sent_at in the statement that chooses the rows (FOR UPDATE SKIP
      // LOCKED), confirmed and unsuppressed rows only, so a second trigger in
      // flight gets a disjoint set or nothing -- never the same subscriber.
      const { data: claimed, error } = await supabase.rpc("market_pulse_claim_batch", { p_limit: BATCH });
      if (error) throw error;
      let sent = 0, skipped = 0;

      for (const sub of (claimed ?? []) as Array<{ cl_email: string; cl_industry: string; cl_last_score: number | null; cl_confirmed_at: string; cl_prev_sent_at: string | null }>) {
        // The label goes into a subject line and the body, so it is one of
        // our own industry names, whatever the row holds: a row written
        // before 2026-10-04 could carry any string a caller sent.
        const industry = knownIndustry(sub.cl_industry);
        const digest = buildDigest(industry);
        if (!digest) { skipped++; continue; }
        const token = await hmacToken(sub.cl_email);
        const unsubParams = { email: sub.cl_email, token };
        const unsubUrl = unsubscribePageUrl("market-pulse", unsubParams);
        const unsubHeaders = oneClickHeaders(oneClickUrl(Deno.env.get("SUPABASE_URL") ?? "", "send-market-pulse", unsubParams));
        const rescanUrl = `${SITE_URL}/?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan`;
        const industryLabel = industry.replace(/_/g, " ");
        const confirmedOn = String(sub.cl_confirmed_at ?? "").slice(0, 10);

        // Personal progress -- accounts with scan history get THEIR trend, not
        // just their industry's. Service-role RPC resolves scores by email.
        let progressHtml = "";
        try {
          const { data: trend } = await supabase.rpc("get_user_score_trend", { p_email: sub.cl_email });
          if (Array.isArray(trend) && trend.length >= 2) {
            const newest = Number(trend[0].ats_score);
            const oldest = Number(trend[trend.length - 1].ats_score);
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
      <p style="font-size:13px;color:#444;margin:16px 0 0">${sub.cl_last_score ? `Your last scan scored <b>${escapeHtml(sub.cl_last_score)}/100</b>. ` : ""}Resumes drift out of date as postings change — a fresh scan takes about 60 seconds and is free.</p>
      <div style="text-align:center;margin-top:20px">
        <a href="${rescanUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:12px 26px;border-radius:10px;text-decoration:none">Rescan my resume free</a>
      </div>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;line-height:1.5">
      You confirmed this monthly pulse${confirmedOn ? ` on ${escapeHtml(confirmedOn)}` : ""} by clicking the link we emailed you.<br>
      <a href="${escapeHtml(unsubUrl)}" style="color:#94a3b8">Unsubscribe</a> — no login needed.
    </p>
  </div>
</body></html>`;

        const { error: sendErr } = await resend.emails.send({
          from: "Resume Booster <reports@resumebooster.work>",
          to: [sub.cl_email],
          subject: `${industryLabel} postings shifted — is your resume current?`,
          html,
          headers: unsubHeaders,
        });
        if (sendErr) {
          console.error("[MARKET-PULSE] send failed for one subscriber", sendErr);
          // Give the claim back, so a failed send is retried by the next run
          // rather than silently costing this subscriber a month.
          await supabase.from("market_pulse_subscribers")
            .update({ last_sent_at: sub.cl_prev_sent_at })
            .eq("email", sub.cl_email);
          skipped++;
          continue;
        }
        sent++;
      }

      console.log(`[MARKET-PULSE] Batch complete: sent=${sent} skipped=${skipped}`);
      return json({ success: true, sent, skipped });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error("[MARKET-PULSE] Uncaught:", e);
    return json({ error: "Unexpected error" }, 500);
  }
});
