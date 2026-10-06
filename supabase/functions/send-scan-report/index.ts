// deploy-stamp: 2026-10-04T22:00Z
// Sends the free scan summary to the user's email — our first lead-capture
// touchpoint. Uses the same Resend setup as send-analysis-email and stores
// the address in the leads table so follow-up campaigns have a source.
//
// A DOOR ANYONE CAN KNOCK ON, SO EVERYTHING ABOUT IT IS BOUNDED (2026-10-04).
// The free scan has no session to ask for, and this sends from our verified
// domain to whatever address the body names, so it cannot prove the address
// belongs to the caller. What it does instead:
//   - counts per NETWORK (the caller's /24 or /48, from the platform's address
//     via clientAddress, never the first forwarded hop, which the caller
//     writes): 12 an hour. The old per-first-hop limit could be reset by
//     writing a new x-forwarded-for on every request;
//   - counts per RECIPIENT: 3 reports a day, however many networks ask, and
//     at most one fix-plan drip a month;
//   - stops at 300 reports a day overall;
//   - sends nothing to an address that unsubscribed, bounced or complained;
//   - prints a SENTENCE only when free-keyword-scan sealed it: the issues,
//     fix steps, occupation and report id must match the seal in the scan's
//     reportMeta.mailSeal (_shared/scan-mail-seal.ts), so the words in a mail
//     from our domain are our scanner's, never a caller's. An unsealed request
//     gets the numbers and our own copy only, no drip, and its own much
//     smaller daily ceiling, so it cannot use up the sealed allowance;
//   - a seal is good for a week, and one report id is mailed at most
//     PER_REPORT times a month, whoever asks and to whichever addresses: one
//     free scan cannot be replayed to a list of strangers;
//   - the verdict sentence is ours, built from numbers: the scanner's carried
//     the model's reading of the resume's job title, which is the resume
//     author's free text;
//   - clamps every number, clips every text field, drops every link, bare
//     domain, e-mail address and phone number from them (_shared/mail-text.ts),
//     and escapes all of it.
// The counters are mail_door_take (20261004100000), whose windows are as long
// as they say; check_rate_limit's are not (each call there sweeps every row
// older than its own window, and its callers' windows run from 24 minutes).
//
// IT NO LONGER TOUCHES THE MARKET-PULSE LIST. A ticked box here used to write
// the address into that list, unconfirmed, for any address anyone typed
// (defect sweep 1.59); the pulse now has its own double opt-in in
// send-market-pulse, and a subscribePulse field in this body is ignored.
//
// AND THE FIX-PLAN SEQUENCE NEEDS ITS OWN CLICK. A ticked drip box used to
// queue four mails to the typed address at once. Now it only puts a button in
// the report mail, which goes to that address; POST {action:"confirm-drip",
// token} from the button's page (/fix-plan/confirm) queues the sequence, once a
// month per address at most (_shared/scan-drip-link.ts).

import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { networkBucket } from "../_shared/network-bucket.ts";
import { scanMailSealValid } from "../_shared/scan-mail-seal.ts";
import { mailSafeText } from "../_shared/mail-text.ts";
import { openDripLink, signDripLink, type DripPlan } from "../_shared/scan-drip-link.ts";
import { alertOwnerOnce } from "../_shared/owner-alert.ts";

// Provable from outside without sending anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "send-scan-report.2026-10-06.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PER_NETWORK_PER_HOUR = 12;
const PER_RECIPIENT_PER_DAY = 3;
const ALL_PER_DAY = 300;
/** Requests without a valid seal: numbers-only mails, on a ceiling of their own. */
const UNSEALED_PER_DAY = 40;
/** Sends of one sealed report (its report id) in PER_REPORT_WINDOW_MIN, to any addresses. */
const PER_REPORT = 3;
const PER_REPORT_WINDOW_MIN = 30 * 1440;
const DRIP_ONCE_PER_DAYS = 30;
const SITE_URL = "https://resumebooster.work";
const FROM = "Resume Booster <reports@resumebooster.work>";

const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * The report as this function will render it: every field below is rebuilt
 * from the request by cleanReport, never passed through. The request itself is
 * untyped input from anyone.
 */
interface ScanReport {
  score: number;
  projectedScore: number | null;
  scoreBreakdown: { keywords: number; format: number; quantification: number } | null;
  peerPercentile: number | null;
  applicationPassRate: number | null;
  redFlags: Array<{ issue: string }>;
  fixRoadmap: { steps: Array<{ order: number | null; step: string; minutes: number; scoreImpact: number }>; totalMinutes: number } | null;
  industry: string | null;
  reportId: string | null;
  scoreBand: { low: number; high: number } | null;
  findingsSummary: { critical: number; warnings: number; passed: number } | null;
  keywordSource: { source: "onet" | "job_description" | "model"; occupation?: string; code?: string } | null;
  /** The box was ticked: the report mail carries the button that starts the fix-plan sequence. */
  dripOptIn: boolean;
  /**
   * The sentences matched free-keyword-scan's seal. When false, every
   * sentence field above is empty (redFlags, fixRoadmap, occupation,
   * reportId): a mail carries no words a caller wrote.
   */
  sealed: boolean;
}

/** A finite number, rounded and clamped to [lo, hi]; null for anything else. */
function num(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
}

/**
 * Plain text, one line, at most `max` characters, with every link, bare
 * domain, e-mail address and phone number taken out (_shared/mail-text.ts).
 * The scan writes these sentences from a resume the caller chose; a way to
 * reach someone in one is never ours, and a mail from our domain must not
 * carry a stranger's.
 */
const plain = mailSafeText;

/**
 * The verdict line, in our words and from numbers only. The scanner's own
 * verdict named the model's reading of the resume's current job title, which
 * is whatever the resume's author typed, so it is never mailed.
 */
function verdictOf(r: ScanReport): string {
  if (r.applicationPassRate === null) return "";
  const crit = r.findingsSummary?.critical ?? 0;
  return `This resume will pass roughly ${r.applicationPassRate}% of ATS filters` +
    (crit > 0 ? ` — ${crit} critical issue${crit === 1 ? " is" : "s are"} holding it back.` : ".");
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The request, rebuilt field by field; null when there is no score to report.
 * `sealed` says whether the request's sentences matched the scan's seal; when
 * it is false they are all dropped, and only numbers and fixed enums remain.
 */
function cleanReport(b: Record<string, unknown>, sealed: boolean): ScanReport | null {
  const score = num(b.score, 0, 100);
  if (score === null) return null;
  if (!sealed) b = { ...b, redFlags: undefined, fixRoadmap: undefined, reportId: undefined, keywordSource: isObj(b.keywordSource) ? { ...b.keywordSource, occupation: undefined } : b.keywordSource };
  const sb = isObj(b.scoreBreakdown) ? b.scoreBreakdown : null;
  const band = isObj(b.scoreBand) ? b.scoreBand : null;
  const fs = isObj(b.findingsSummary) ? b.findingsSummary : null;
  const ks = isObj(b.keywordSource) ? b.keywordSource : null;
  const fr = isObj(b.fixRoadmap) ? b.fixRoadmap : null;
  const steps = fr && Array.isArray(fr.steps)
    ? fr.steps.filter(isObj).slice(0, 8).map((s) => ({
      order: num(s.order, 1, 99),
      step: plain(s.step, 240),
      minutes: num(s.minutes, 0, 600) ?? 0,
      scoreImpact: num(s.scoreImpact, -100, 100) ?? 0,
    })).filter((s) => s.step)
    : [];
  const source = ks && (ks.source === "onet" || ks.source === "job_description" || ks.source === "model") ? ks.source : null;
  const code = ks && typeof ks.code === "string" && /^\d{2}-\d{4}(?:\.\d{2})?$/.test(ks.code) ? ks.code : undefined;
  const occupation = ks ? plain(ks.occupation, 120) || undefined : undefined;
  const reportId = typeof b.reportId === "string" && /^[A-Za-z0-9]{6,32}$/.test(b.reportId) ? b.reportId : null;
  const low = band ? num(band.low, 0, 100) : null;
  const high = band ? num(band.high, 0, 100) : null;
  return {
    score,
    projectedScore: num(b.projectedScore, 0, 100),
    scoreBreakdown: sb
      ? { keywords: num(sb.keywords, 0, 100) ?? 0, format: num(sb.format, 0, 100) ?? 0, quantification: num(sb.quantification, 0, 100) ?? 0 }
      : null,
    peerPercentile: num(b.peerPercentile, 0, 100),
    applicationPassRate: num(b.applicationPassRate, 0, 100),
    redFlags: Array.isArray(b.redFlags)
      ? b.redFlags.filter(isObj).slice(0, 3).map((f) => ({ issue: plain(f.issue, 240) })).filter((f) => f.issue)
      : [],
    fixRoadmap: steps.length ? { steps, totalMinutes: num(fr?.totalMinutes, 0, 6000) ?? 0 } : null,
    industry: plain(b.industry, 64) || null,
    reportId,
    scoreBand: low !== null && high !== null ? { low, high } : null,
    findingsSummary: fs
      ? { critical: num(fs.critical, 0, 999) ?? 0, warnings: num(fs.warnings, 0, 999) ?? 0, passed: num(fs.passed, 0, 999) ?? 0 }
      : null,
    keywordSource: source ? { source, ...(occupation ? { occupation } : {}), ...(code ? { code } : {}) } : null,
    dripOptIn: b.dripOptIn === true,
    sealed,
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/**
 * One count at a mail door (mail_door_take, 20261004100000). Answers "ok" only
 * when the database said yes: a door that cannot count stays shut.
 */
async function take(admin: Admin, door: string, bucket: string, max: number, windowMinutes: number): Promise<"ok" | "full" | "error"> {
  const { data, error } = await admin.rpc("mail_door_take", {
    p_door: door, p_bucket: bucket, p_max: max, p_window_minutes: windowMinutes,
  });
  if (error) {
    console.error(`[SEND-SCAN-REPORT] ${door} count failed:`, error.message?.slice(0, 160));
    return "error";
  }
  return data === true ? "ok" : "full";
}


const recipientBucket = async (serviceKey: string, email: string) =>
  (await sha256Hex(`${serviceKey}:scan-report-recipient:${email}`)).slice(0, 32);

/**
 * THE FIX-PLAN SEQUENCE, queued for `plan.email` -- called only from the
 * confirm-drip action, after the inbox's owner pressed the button the report
 * mail carried. Four mails, days 2/4/6/14 from the click.
 */
async function queueDrip(admin: Admin, plan: DripPlan): Promise<void> {
  const email = plan.email;
  // Get-or-create the address's unsubscribe token
  let token: string | null = null;
  const { data: existing } = await admin.from("email_unsubscribe_tokens").select("token").eq("email", email).maybeSingle();
  if (existing?.token) {
    token = existing.token;
  } else {
    token = crypto.randomUUID().replace(/-/g, "");
    await admin.from("email_unsubscribe_tokens").insert({ token, email });
  }
  const score = plan.score;
  const rescanUrl = `${SITE_URL}/?utm_source=email&utm_medium=scan_report&utm_campaign=rescan`;
  const unsubUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-scan-report?action=unsubscribe&token=${token}`;
  const footer = `<p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:18px">Part of the fix-plan emails started from the button in your scan report from resumebooster.work. <a href="${unsubUrl}" style="color:#94a3b8">Unsubscribe</a> any time — remaining emails cancel too.</p>`;
  const wrap = (inner: string) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #e2e8f0">${inner}</div>${footer}</div></body></html>`;

  const steps = plan.steps;
  const topSteps = steps.slice(0, 3);
  const restSteps = steps.slice(3, 6);
  const rid = plan.reportId;
  const day2 = wrap(`
    <h2 style="font-size:17px;color:#0f172a;margin:0 0 8px">Day 2: your ${topSteps.length ? "three highest-impact fixes" : "fix plan"}</h2>
    <p style="font-size:13px;color:#475569">Two days ago your resume scored ${score}/100${rid ? ` (report #${escapeHtml(rid)})` : ""}. These fixes move the score most per minute:</p>
    ${topSteps.length ? `<ol style="font-size:13px;color:#334155;padding-left:18px">${topSteps.map((s) => `<li style="margin-bottom:6px">${escapeHtml(s.step)} <span style="color:#94a3b8">(~${s.minutes} min, ≈+${s.scoreImpact} pts)</span></li>`).join("")}</ol>` : `<p style="font-size:13px;color:#334155">Open your report's fix plan and work top to bottom — it's ordered by impact per minute.</p>`}
    <p style="font-size:13px;color:#475569">Doing them in the free builder is fastest: <a href="${SITE_URL}/builder?utm_source=email&utm_medium=drip&utm_campaign=day2" style="color:#2563eb">open the builder</a>.</p>`);
  const day4 = wrap(`
    <h2 style="font-size:17px;color:#0f172a;margin:0 0 8px">Day 4: the rest of the plan</h2>
    ${restSteps.length ? `<p style="font-size:13px;color:#475569">If the big three are done, these finish the job:</p><ol start="4" style="font-size:13px;color:#334155;padding-left:18px">${restSteps.map((s) => `<li style="margin-bottom:6px">${escapeHtml(s.step)} <span style="color:#94a3b8">(~${s.minutes} min)</span></li>`).join("")}</ol>` : `<p style="font-size:13px;color:#475569">If the first fixes are done, do one pass for weak bullets: every bullet needs an action verb, a scope, and an outcome. Your report graded each one.</p>`}
    <p style="font-size:13px;color:#475569">Stuck on wording? The report's rewrites are copy-ready.</p>`);
  const day6 = wrap(`
    <h2 style="font-size:17px;color:#0f172a;margin:0 0 8px">Day 6: verify the fixes worked</h2>
    <p style="font-size:13px;color:#475569">You scored ${score}/100 last week. Rescan the fixed version — same rubric, so the before/after is real: <a href="${rescanUrl}" style="color:#2563eb">rescan free</a>.</p>
    <p style="font-size:13px;color:#475569">And if you've applied anywhere with it, one anonymous click tells us how it went — that's how we measure what actually works: <a href="${SITE_URL}/?outcome=interview&rid=${encodeURIComponent(rid ?? "")}" style="color:#2563eb">got interviews</a> · <a href="${SITE_URL}/?outcome=no_response&rid=${encodeURIComponent(rid ?? "")}" style="color:#2563eb">no response</a>.</p>`);
  // Day 14: THE outcome ask — the one question the capture checkbox
  // promises. Links land on the homepage handler (?outcome=&rid=) which
  // records via the record_scan_outcome RPC, anonymously.
  const day14 = wrap(`
    <h2 style="font-size:17px;color:#0f172a;margin:0 0 8px">One question — did it work?</h2>
    <p style="font-size:13px;color:#475569">Two weeks ago your resume scored ${score}/100 and you got a fix plan. One anonymous click, honest answer either way:</p>
    <p style="font-size:14px;font-weight:600"><a href="${SITE_URL}/?outcome=interview&rid=${encodeURIComponent(rid ?? "")}" style="color:#2563eb">I got interviews</a> &nbsp;·&nbsp; <a href="${SITE_URL}/?outcome=no_response&rid=${encodeURIComponent(rid ?? "")}" style="color:#2563eb">No response yet</a> &nbsp;·&nbsp; <a href="${SITE_URL}/?outcome=rejected&rid=${encodeURIComponent(rid ?? "")}" style="color:#2563eb">Rejected</a></p>
    <p style="font-size:13px;color:#475569">Every answer sharpens the public benchmarks — measuring what actually works is the whole product.</p>
    <p style="font-size:13px;color:#475569">Still mid-fix? <a href="${rescanUrl}" style="color:#2563eb">Rescan free</a> first — same rubric, so the before/after is real.</p>`);

  const DAY = 86400;
  const drips: Array<{ html: string; subject: string; delay: number }> = [
    { html: day2, subject: "Day 2: your three highest-impact resume fixes", delay: 2 * DAY },
    { html: day4, subject: "Day 4: finishing your resume fix plan", delay: 4 * DAY },
    { html: day6, subject: "Day 6: did the fixes work? Verify free", delay: 6 * DAY },
    { html: day14, subject: "One question: did the new resume get interviews?", delay: 14 * DAY },
  ];
  for (const d of drips) {
    await admin.rpc("enqueue_email_delayed", {
      queue_name: "transactional_emails",
      payload: {
        message_id: crypto.randomUUID(),
        to: email,
        from: FROM,
        sender_domain: "notify.resumebooster.work",
        subject: d.subject,
        html: d.html,
        text: "",
        purpose: "transactional",
        label: "fix-plan-drip",
        unsubscribe_token: token,
        queued_at: new Date().toISOString(),
      },
      delay_seconds: d.delay,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // One-click unsubscribe for the fix-plan drip (linked from every drip
  // email). Inserts into suppressed_emails, which the queue processor checks
  // before every non-auth send — so already-queued day-4/6 emails are
  // silently dropped too.
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "unsubscribe") {
      const token = url.searchParams.get("token") ?? "";
      const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
      const { data: row } = await admin.from("email_unsubscribe_tokens").select("email").eq("token", token).maybeSingle();
      if (!row) return new Response("Invalid unsubscribe link.", { status: 400, headers: { "Content-Type": "text/plain" } });
      await admin.from("suppressed_emails").upsert({ email: row.email, reason: "unsubscribe" }, { onConflict: "email" });
      await admin.from("email_unsubscribe_tokens").update({ used_at: new Date().toISOString() }).eq("token", token);
      return new Response(
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'><h2>You're unsubscribed.</h2><p>No more emails from us. Your remaining fix-plan emails are cancelled too.</p></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response("Not found", { status: 404 });
  }

  try {
    const raw = await req.json().catch(() => null);
    if (!isObj(raw)) return reply({ success: false, error: "Body must be a JSON object" }, 400);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // ── The button in a report mail: start the fix-plan sequence ──────────
    if (raw.action === "confirm-drip") {
      const plan = await openDripLink(serviceKey, raw.token);
      if (!plan) return reply({ success: false, error: "This link has expired or is not valid." }, 410);
      const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
      const net = await networkBucket(req.headers, serviceKey, "scan-report");
      const atNet = await take(admin, "send-scan-report:drip-confirm", net, 20, 60);
      if (atNet === "error") return reply({ success: false, error: "Could not start it right now. Try the button again shortly." }, 503);
      if (atNet === "full") return reply({ success: false, error: "Too many requests. Please try again later." }, 429);
      const { data: suppressed, error: supErr } = await admin
        .from("suppressed_emails").select("email").eq("email", plan.email).maybeSingle();
      if (supErr) return reply({ success: false, error: "Could not start it right now. Try the button again shortly." }, 503);
      if (suppressed) return reply({ success: true, queued: false, reason: "opted_out" });
      // ONE SEQUENCE PER ADDRESS PER 30 DAYS, however many buttons are pressed.
      const due = await take(admin, "send-scan-report:drip", await recipientBucket(serviceKey, plan.email), 1, DRIP_ONCE_PER_DAYS * 1440);
      if (due === "error") return reply({ success: false, error: "Could not start it right now. Try the button again shortly." }, 503);
      if (due === "full") return reply({ success: true, queued: false, reason: "already_started" });
      try {
        await queueDrip(admin, plan);
      } catch (e) {
        console.error("[SEND-SCAN-REPORT] drip enqueue failed:", e instanceof Error ? e.message.slice(0, 160) : String(e));
        return reply({ success: false, error: "Could not start it right now. Try the button again shortly." }, 503);
      }
      console.log("[SEND-SCAN-REPORT] fix-plan drip queued after its button was pressed (4 emails)");
      return reply({ success: true, queued: true });
    }

    const email = (typeof raw.email === "string" ? raw.email : "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return reply({ success: false, error: "Invalid email address" }, 400);
    }
    // The sentences print only if free-keyword-scan sealed exactly these, in
    // the last week, for a report id this function can count.
    const sealed = (await scanMailSealValid(serviceKey, raw, raw.mailSeal))
      && typeof raw.reportId === "string" && /^[A-Za-z0-9]{6,32}$/.test(raw.reportId);
    // From here on `body` is the rebuilt report, never the request.
    const body = cleanReport(raw, sealed);
    if (!body) return reply({ success: false, error: "Missing score" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
    const ownerMail = async (m: { to: string[]; subject: string; html: string }) => {
      if (resend) await resend.emails.send({ from: FROM, ...m });
    };

    // 1. THE NETWORK. Twelve an hour from one /24 (or /48), keyed on the
    //    platform's address. The previous key was the FIRST x-forwarded-for
    //    hop, which the caller writes, so a fresh header was a fresh allowance.
    const net = await networkBucket(req.headers, serviceKey, "scan-report");
    const atNet = await take(admin, "send-scan-report", net, PER_NETWORK_PER_HOUR, 60);
    if (atNet === "error") return reply({ success: false, error: "Could not send right now. Please try again shortly." }, 503);
    if (atNet === "full") return reply({ success: false, error: "Too many requests. Please try again later." }, 429);

    // 2. THE RECIPIENT. Three reports a day to one address, however many
    //    networks ask: a stranger rotating networks still reaches a given
    //    inbox three times. The bucket is a keyed hash, never the address.
    const recipient = await recipientBucket(serviceKey, email);
    const atRecipient = await take(admin, "send-scan-report:recipient", recipient, PER_RECIPIENT_PER_DAY, 1440);
    if (atRecipient === "error") return reply({ success: false, error: "Could not send right now. Please try again shortly." }, 503);
    if (atRecipient === "full") {
      return reply({ success: false, error: "That address has already been sent several reports today. Try again tomorrow, or use the PDF download." }, 429);
    }

    // 3. THE REPORT. One sealed report goes out at most PER_REPORT times a
    //    month, to any addresses: its sentences came from a resume the caller
    //    chose, so one free scan must not become a mailing to strangers. Taken
    //    before the day's ceiling, so a replay never draws on what real scans'
    //    mails need.
    if (body.sealed && body.reportId) {
      const reportBucket = (await sha256Hex(`${serviceKey}:scan-report-report:${body.reportId}`)).slice(0, 32);
      const atReport = await take(admin, "send-scan-report:report", reportBucket, PER_REPORT, PER_REPORT_WINDOW_MIN);
      if (atReport === "error") return reply({ success: false, error: "Could not send right now. Please try again shortly." }, 503);
      if (atReport === "full") {
        return reply({ success: false, error: "This report has already been emailed several times. Use the PDF download, or run a fresh scan next month." }, 429);
      }
    }

    // 4. EVERYONE. A day's ceiling, so the worst case is a number. Unsealed
    //    requests (numbers only) have a small ceiling of their own, so a flood
    //    of them can never use up the allowance real scans' mails draw on.
    //    Reaching either tells the owner (once a day).
    const ceilingDoor = sealed ? "send-scan-report:all" : "send-scan-report:unsealed";
    const atAll = await take(admin, ceilingDoor, "all", sealed ? ALL_PER_DAY : UNSEALED_PER_DAY, 1440);
    if (atAll !== "ok") {
      console.error(`[SEND-SCAN-REPORT] daily ceiling: ${atAll}`);
      if (atAll === "full") await alertOwnerOnce(admin, ceilingDoor, "reached its daily ceiling", ownerMail);
      return reply({ success: false, error: "Report emails are paused for today. The PDF download works meanwhile." }, 503);
    }

    // 5. THE RECIPIENT'S OWN WORD, LAST. An address that unsubscribed,
    //    bounced or complained gets nothing from here, whoever typed it. The
    //    answer is the ordinary one: whether an address opted out of our mail
    //    is its owner's business. It is asked only after every count, so no
    //    count's refusal (a full inbox day, a full report, a full day) can
    //    tell a suppressed address from one that is not.
    const { data: suppressed, error: supErr } = await admin
      .from("suppressed_emails").select("email").eq("email", email).maybeSingle();
    if (supErr) return reply({ success: false, error: "Could not send right now. Please try again shortly." }, 503);
    if (suppressed) return reply({ success: true });

    // Store the lead (non-blocking failure — email still sends)
    try {
      await admin.rpc("save_free_scan_lead", {
        p_email: email,
        p_ats_score: body.score,
        p_industry: body.industry,
      });
    } catch (e) {
      console.warn("[SEND-SCAN-REPORT] Lead save failed (continuing):", e);
    }

    if (!resend) {
      console.error("[SEND-SCAN-REPORT] RESEND_API_KEY not configured");
      return reply({ success: false, error: "Email service not configured" }, 503);
    }

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
    const verdict = verdictOf(body);
    if (verdict) {
      rows.push(`<p style="font-size:15px;line-height:1.55;color:#111;font-weight:600;margin:0 0 12px">${escapeHtml(verdict)}</p>`);
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

    // Without the seal there are no sentences to print, so the mail says where
    // they are instead -- in our words, not the caller's.
    if (!body.sealed) {
      rows.push(`<p style="font-size:13px;color:#475569;margin:14px 0 0">The full findings and your fix plan are on the results page where you ran the scan. A fresh scan is free and takes about a minute.</p>`);
    }

    // THE FIX-PLAN SEQUENCE ASKS, IT DOES NOT START. A ticked box puts this
    // button in the mail that goes to the address; nothing is queued until
    // its page is opened and its button pressed. Sealed reports only: the
    // sequence is the fix plan's steps, and an unsealed request has none.
    let dripLink = "";
    if (body.dripOptIn && body.sealed) {
      const token = await signDripLink(serviceKey, {
        email,
        score,
        reportId: body.reportId,
        steps: (body.fixRoadmap?.steps ?? []).slice(0, 6).map((s) => ({ step: s.step, minutes: s.minutes, scoreImpact: s.scoreImpact })),
      });
      if (token) dripLink = `${SITE_URL}/fix-plan/confirm#d=${token}`;
    }
    if (dripLink) {
      rows.push(`
        <div style="margin:18px 0 0;padding:14px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;text-align:center">
          <p style="font-size:13px;color:#1e3a8a;margin:0 0 10px">You asked to break this plan into four short emails over two weeks: the top fixes, the rest, a rescan reminder, and one question. They start only if you press this button.</p>
          <a href="${escapeHtml(dripLink)}" style="display:inline-block;background:#2563eb;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Start my fix-plan emails</a>
          <p style="font-size:11px;color:#64748b;margin:8px 0 0">The button works for 7 days. Ignore it and nothing more is sent.</p>
        </div>`);
    }

    const preheader = `Your resume scored ${score}/100 — ${body.fixRoadmap?.totalMinutes ? `a ${body.fixRoadmap.totalMinutes}-minute fix plan is inside.` : body.sealed ? "your fix plan is inside." : "your scan summary is inside."}`;

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
      Your resume text is deleted within 24 hours of your scan, and the report that quotes it within 7 days. Every copy we keep, and for how long: resumebooster.work/trust<br>
      You received this because this address was entered for a scan report at resumebooster.work. If that wasn't you, ignore it.<br>
      Follow-up emails come only if the button for them in this email is pressed, and every one has an unsubscribe link.
    </p>
  </div>
</body></html>`;

    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      subject: body.sealed
        ? `Your resume scored ${Math.round(body.score)}/100 — here's your fix plan`
        : `Your resume scored ${Math.round(body.score)}/100 — your scan summary`,
      html,
    });

    if (error) {
      console.error("[SEND-SCAN-REPORT] Resend error:", error);
      return reply({ success: false, error: "Failed to send email" }, 502);
    }
    if (body.dripOptIn && !body.sealed) console.log("[SEND-SCAN-REPORT] no fix-plan button: the report was not sealed by the scan");

    return reply({ success: true });
  } catch (e) {
    console.error("[SEND-SCAN-REPORT] Uncaught:", e);
    return reply({ success: false, error: "Unexpected error" }, 500);
  }
});
