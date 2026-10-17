// MAIL-WATCH: A MAIL CLASS THAT STOPS SENDING RINGS (critical-path plan
// 2026-10-12, CP-I; register CP-013, CP-021, CP-052, CP-003).
//
// Nothing alarmed when mail stopped. The heartbeat's mail check was
// report-only, bounces and complaints were never read, a delivered order
// whose mail never left looked delivered, and a cron whose function answered
// 500 on every run kept every light green. This runs every 15 minutes on the
// email cron key (20261011142000) and checks:
//
//   R1  a class failing: in the last hour, a template (email_send_log) or a
//       purchase mail type (email_logs) with 3 or more refusals making up at
//       least half of its attempts;
//   R2  paid orders with no purchase mail: orders written in the last 24
//       hours that should be mailed, and not one purchase mail sent;
//   R3  mail stuck: an email_send_log row 'pending' for over 2 minutes with no
//       later row for the same message;
//   R4  the queue gave up: a message the sign-in drain dead-lettered (its
//       'dlq' row in email_send_log) in the last 24 hours;
//   R5  bounces and complaints: 3 or more in 24 hours, at least 5% of sends;
//   R6  DNS drift, read over DNS-over-HTTPS: the 'send' SPF names Amazon SES,
//       Resend's DKIM key is published, DMARC is published;
//   R7  the daily canaries, when CANARY_EMAIL is set: once a day a
//       transactional mail leaves through the shared sender (its log row must
//       read sent), and a sign-in code is requested for the canary account
//       (its queued mail must be logged sent within 10 minutes; auth mail goes
//       through Lovable and Mailgun, so 'sent' is the row, not a delivery);
//   R8  a delivered order whose mail never left, 30 minutes on (products
//       mailed with their content; the ones made on their own page are mailed
//       a link and are R2's);
//   R9  the dead-man pair and the cron answers: the heartbeat's own cron has
//       run in the last 40 minutes, and the crons' HTTP calls did not answer
//       5xx or time out 3 or more times in the last hour.
//
// Each rule says ok, alarm or unknown (a read that failed is unknown, never
// ok and never an alarm). An alarm mails the owner once per rule per six
// hours, from our domain with Resend's onboarding sender as the fallback, and
// the door is given back when no sender accepted it. When HC_PING_URL is set
// (healthchecks.io, outside Supabase and Resend), every run pings it, and a
// run with an alarm pings its /fail. The run is stamped in job_board_meta
// (mail_watch_run, counts and states only: that table has an anon reader);
// the canaries keep their own stamp there (mail_watch_canary, timestamps and
// a sanitised error only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isScheduledCaller } from "../_shared/email-cron.ts";
// R1's transport: one way out for a mail, with its email_send_log row.
import { sendMail } from "../_shared/send-mail.ts";

// Provable from outside: every response, the preflight included, carries this.
const FN_BUILD = "mail-watch.2026-10-11.22";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-email-cron",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export type RuleState = "ok" | "alarm" | "unknown";
export type Rule = { id: string; state: RuleState; detail: string };

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const FAIL_STATUSES = new Set(["failed", "rate_limited"]);
/** Orders whose subscription or entitlement is the delivery: nothing is mailed for them by product mail. */
const NOT_MAILED = new Set(["pro_subscription", "apply_agent", "agent_pass", "unknown"]);
const MADE_ON_ITS_PAGE = new Set(["full_analysis", "freelance_boost", "freelance_transition_pro"]);

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Array<Record<string, unknown>> | null> {
  try {
    const { data, error } = await q;
    return error || !Array.isArray(data) ? null : data as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}

/** R1: a template or purchase-mail type refused at least 3 times, and at least half the time, in the last hour. */
async function classFailing(db: Db): Promise<Rule> {
  const sendLog = await rows(db.from("email_send_log").select("template_name, status").gte("created_at", iso(HOUR)).limit(5000));
  const logs = await rows(db.from("email_logs").select("email_type, status").gte("created_at", iso(HOUR)).limit(5000));
  if (!sendLog && !logs) return { id: "R1", state: "unknown", detail: "neither mail log could be read" };
  const tally = new Map<string, { failed: number; total: number }>();
  const count = (key: string, status: string) => {
    if (status === "pending" || status === "delivered" || status === "delayed") return;
    const t = tally.get(key) ?? { failed: 0, total: 0 };
    t.total++;
    if (FAIL_STATUSES.has(status)) t.failed++;
    tally.set(key, t);
  };
  for (const r of sendLog ?? []) count(`send_log:${String(r.template_name ?? "mail")}`, String(r.status ?? ""));
  for (const r of logs ?? []) count(`email_logs:${String(r.email_type ?? "mail")}`, String(r.status ?? ""));
  const failing = [...tally.entries()].filter(([, t]) => t.failed >= 3 && t.failed * 2 >= t.total);
  return failing.length
    ? { id: "R1", state: "alarm", detail: `failing in the last hour: ${failing.map(([k, t]) => `${k} ${t.failed}/${t.total}`).join(", ")}` }
    : { id: "R1", state: "ok", detail: `${tally.size} mail classes sent in the last hour; none failing` };
}

/** R2: orders that should be mailed were written in the last 24 hours, and no purchase mail was sent. */
async function ordersWithNoMail(db: Db): Promise<Rule> {
  const orders = await rows(db.from("product_deliveries").select("product_type, generation_error").gte("created_at", iso(24 * HOUR)).limit(2000));
  const sent = await rows(db.from("email_logs").select("email_type").eq("status", "sent").gte("created_at", iso(24 * HOUR)).limit(2000));
  if (!orders || !sent) return { id: "R2", state: "unknown", detail: "orders or the purchase-mail log could not be read" };
  const mailable = orders.filter((o) => !NOT_MAILED.has(String(o.product_type)) && !String(o.generation_error ?? "").startsWith("undeliverable_retired"));
  const productMails = sent.filter((m) => String(m.email_type ?? "").startsWith("product_")).length;
  if (mailable.length > 0 && productMails === 0) {
    return { id: "R2", state: "alarm", detail: `${mailable.length} paid order(s) in 24 hours and not one purchase mail sent` };
  }
  return { id: "R2", state: "ok", detail: `${mailable.length} mailable order(s), ${productMails} purchase mail(s) sent in 24 hours` };
}

/** R3: a send logged pending for over 2 minutes that no later row for its message settled. */
async function mailStuck(db: Db): Promise<Rule> {
  const pending = await rows(db.from("email_send_log").select("message_id, template_name, created_at").eq("status", "pending")
    .gte("created_at", iso(24 * HOUR)).lt("created_at", iso(2 * 60_000)).limit(500));
  if (!pending) return { id: "R3", state: "unknown", detail: "the send log could not be read" };
  const ids = [...new Set(pending.map((r) => String(r.message_id ?? "")).filter(Boolean))];
  if (ids.length === 0) return { id: "R3", state: "ok", detail: "nothing pending past 2 minutes" };
  const later = await rows(db.from("email_send_log").select("message_id, status, created_at").in("message_id", ids.slice(0, 200)).limit(2000));
  if (!later) return { id: "R3", state: "unknown", detail: "the later rows of pending messages could not be read" };
  const settled = new Set(later.filter((r) => String(r.status) !== "pending").map((r) => String(r.message_id)));
  const stuck = ids.filter((id) => !settled.has(id));
  return stuck.length
    ? { id: "R3", state: "alarm", detail: `${stuck.length} message(s) pending for over 2 minutes` }
    : { id: "R3", state: "ok", detail: "every pending message was settled" };
}

/** R4: a message the sign-in drain gave up on (process-email-queue's 'dlq' row) in 24 hours. */
async function deadLettered(db: Db): Promise<Rule> {
  const r = await rows(db.from("email_send_log").select("template_name").eq("status", "dlq").gte("created_at", iso(24 * HOUR)).limit(500));
  if (!r) return { id: "R4", state: "unknown", detail: "the send log could not be read" };
  if (r.length === 0) return { id: "R4", state: "ok", detail: "nothing dead-lettered in 24 hours" };
  const kinds = [...new Set(r.map((x) => String(x.template_name ?? "mail")))];
  return { id: "R4", state: "alarm", detail: `${r.length} message(s) the queue gave up on in 24 hours: ${kinds.join(", ")}` };
}

/** R5: bounces and complaints in 24 hours. */
async function bounces(db: Db): Promise<Rule> {
  const r = await rows(db.from("email_send_log").select("status").gte("created_at", iso(24 * HOUR)).in("status", ["sent", "bounced", "complained"]).limit(10000));
  if (!r) return { id: "R5", state: "unknown", detail: "the send log could not be read" };
  const sent = r.filter((x) => x.status === "sent").length;
  const bad = r.filter((x) => x.status === "bounced" || x.status === "complained").length;
  const rate = sent > 0 ? bad / sent : bad > 0 ? 1 : 0;
  return bad >= 3 && rate >= 0.05
    ? { id: "R5", state: "alarm", detail: `${bad} bounce(s) or complaint(s) against ${sent} send(s) in 24 hours` }
    : { id: "R5", state: "ok", detail: `${bad} bounce(s) or complaint(s), ${sent} send(s) in 24 hours` };
}

/** The TXT records of a name, over Cloudflare's DNS-over-HTTPS; null when the lookup failed. */
async function txt(name: string, fetchImpl: typeof fetch): Promise<string[] | null> {
  try {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const body = await r.json() as { Status?: number; Answer?: Array<{ data?: string }> };
    if (body.Status !== 0 && body.Status !== 3) return null;
    return (body.Answer ?? []).map((a) => String(a.data ?? "").replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch {
    return null;
  }
}

/** R6: the records every paid mail depends on are still published. */
async function dnsDrift(fetchImpl: typeof fetch): Promise<Rule> {
  const [spf, dkim, dmarc] = await Promise.all([
    txt("send.resumebooster.work", fetchImpl), txt("resend._domainkey.resumebooster.work", fetchImpl), txt("_dmarc.resumebooster.work", fetchImpl),
  ]);
  if (!spf || !dkim || !dmarc) return { id: "R6", state: "unknown", detail: "a DNS-over-HTTPS lookup failed" };
  const wrong: string[] = [];
  if (!spf.some((t) => t.startsWith("v=spf1") && t.includes("include:amazonses.com"))) wrong.push("the 'send' SPF does not include amazonses.com");
  if (!dkim.some((t) => /\bp=/.test(t))) wrong.push("Resend's DKIM key is not published");
  if (!dmarc.some((t) => t.startsWith("v=DMARC1"))) wrong.push("no DMARC record");
  return wrong.length ? { id: "R6", state: "alarm", detail: wrong.join("; ") } : { id: "R6", state: "ok", detail: "SPF, DKIM and DMARC published" };
}

const CANARY_KIND = "canary-transactional";
const CANARY_FROM = "Resume Booster Alerts <alerts@resumebooster.work>";
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
/** Nothing with an address in it reaches the stamp or the owner's mail subject. */
const noAddress = (s: string) => s.replace(/[^\s@<>"]+@[^\s@<>"]+/g, "(address)");
type CanaryStamp = { mail_sent_at?: string; auth_requested_at?: string; auth_error?: string | null };
type AuthClient = {
  auth: { signInWithOtp: (p: { email: string; options?: { shouldCreateUser?: boolean } }) => Promise<{ error: { message?: string } | null }> };
};

/**
 * R7: the daily canaries. Once a day a transactional mail leaves for
 * CANARY_EMAIL through the shared sender, and a sign-in code is requested for
 * that address (the account must exist: shouldCreateUser false). The next
 * runs judge them by their log rows: the canary's own row must read sent (or
 * delivered), and the sign-in's queued mail must be logged sent within ten
 * minutes of the request. Without CANARY_EMAIL nothing is sent and the rule
 * is unknown; a request that could not be made (no account, no anon key) is
 * unknown too, never ok and never an alarm: only a mail that should have left
 * and did not rings.
 */
async function canaries(db: Db, fetchImpl: typeof fetch, anon: AuthClient | null): Promise<Rule> {
  const to = (Deno.env.get("CANARY_EMAIL") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { id: "R7", state: "unknown", detail: "CANARY_EMAIL is not set: no canary is sent (owner step)" };
  const stampRows = await rows(db.from("job_board_meta").select("v").eq("k", "mail_watch_canary").limit(1));
  if (!stampRows) return { id: "R7", state: "unknown", detail: "the canary stamp could not be read" };
  const stamp = (stampRows[0]?.v ?? {}) as CanaryStamp;
  const next: CanaryStamp = { ...stamp };
  const wrong: string[] = [];
  const unsure: string[] = [];
  const fine: string[] = [];
  const now = Date.now();
  const at = new Date(now).toISOString();

  // The transactional canary.
  const mailAt = Date.parse(String(stamp.mail_sent_at ?? ""));
  if (!Number.isFinite(mailAt) || now - mailAt > 24 * HOUR) {
    const sent = await sendMail({
      cls: "transactional", kind: CANARY_KIND, to, from: CANARY_FROM,
      subject: "Resume Booster mail canary",
      html: `<p>The daily canary: a transactional mail that proves the paid mail path still leaves. Sent ${at}.</p>`,
      idempotencyKey: `canary:${at.slice(0, 10)}`, metadata: { canary: true },
    }, { admin: db, fetchImpl });
    next.mail_sent_at = at;
    if (sent.ok) fine.push("transactional canary sent now");
    else wrong.push(`the transactional canary was refused: ${noAddress(String(sent.error ?? sent.status))}`);
  } else {
    const log = await rows(db.from("email_send_log").select("status, created_at").eq("template_name", CANARY_KIND)
      .gte("created_at", new Date(mailAt - 60_000).toISOString()).order("created_at", { ascending: false }).limit(5));
    if (!log) unsure.push("the canary's log row could not be read");
    else if (!log[0]) wrong.push("the transactional canary sent today left no log row");
    else {
      const status = String(log[0].status ?? "");
      if (status === "sent" || status === "delivered") fine.push(`transactional canary ${status}`);
      else wrong.push(`the transactional canary is ${status}`);
    }
  }

  // The sign-in canary.
  if (!anon) unsure.push("no anon key: the sign-in canary cannot be requested");
  else {
    const authAt = Date.parse(String(stamp.auth_requested_at ?? ""));
    if (!Number.isFinite(authAt) || now - authAt > 24 * HOUR) {
      let err: string | null = null;
      try {
        const { error } = await anon.auth.signInWithOtp({ email: to, options: { shouldCreateUser: false } });
        err = error ? String(error.message ?? "refused") : null;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      next.auth_requested_at = at;
      next.auth_error = err ? noAddress(err).slice(0, 120) : null;
      if (err) unsure.push(`the sign-in canary could not be requested: ${next.auth_error} (the canary account must exist)`);
      else fine.push("sign-in canary requested now");
    } else if (stamp.auth_error) {
      unsure.push(`the sign-in canary could not be requested: ${stamp.auth_error} (the canary account must exist)`);
    } else if (now - authAt > 10 * 60_000) {
      const log = await rows(db.from("email_send_log").select("status").eq("recipient_email", to).neq("template_name", CANARY_KIND)
        .gte("created_at", new Date(authAt - 60_000).toISOString()).in("status", ["sent", "delivered"]).limit(5));
      if (!log) unsure.push("the sign-in canary's log rows could not be read");
      else if (log.length === 0) wrong.push(`the sign-in canary requested ${Math.round((now - authAt) / 60_000)} minutes ago has no sent mail`);
      else fine.push("sign-in canary mailed");
    } else fine.push("sign-in canary requested under 10 minutes ago");
  }

  try {
    await db.from("job_board_meta").upsert({ k: "mail_watch_canary", v: next, updated_at: at }, { onConflict: "k" });
  } catch {
    unsure.push("the canary stamp could not be written");
  }

  if (wrong.length) return { id: "R7", state: "alarm", detail: wrong.join("; ") };
  if (unsure.length) return { id: "R7", state: "unknown", detail: [...unsure, ...fine].join("; ") };
  return { id: "R7", state: "ok", detail: fine.join("; ") };
}

/** R8: an order delivered 30 minutes to a day ago, mailed with its content, whose mail never left. */
async function deliveredUnmailed(db: Db): Promise<Rule> {
  const r = await rows(db.from("product_deliveries").select("product_type, email_sent_at, email_success")
    .eq("status", "delivered").gte("created_at", iso(24 * HOUR)).lt("created_at", iso(30 * 60_000)).limit(2000));
  if (!r) return { id: "R8", state: "unknown", detail: "orders could not be read" };
  const unmailed = r.filter((o) => !NOT_MAILED.has(String(o.product_type)) && !MADE_ON_ITS_PAGE.has(String(o.product_type))
    && !o.email_sent_at && o.email_success !== true);
  return unmailed.length
    ? { id: "R8", state: "alarm", detail: `${unmailed.length} delivered order(s) with no mail sent: ${[...new Set(unmailed.map((o) => o.product_type))].join(", ")}` }
    : { id: "R8", state: "ok", detail: `${r.length} order(s) delivered in the window; every one mailed` };
}

/** R9: the heartbeat's own cron has run, and the crons' calls are not answered 5xx or timing out. */
async function deadMan(db: Db): Promise<Rule> {
  let health: Array<Record<string, unknown>> | null = null;
  let http: Array<Record<string, unknown>> | null = null;
  try { health = await rows(db.rpc("get_cron_health", { p_hours: 2 })); } catch { health = null; }
  try { http = await rows(db.rpc("cron_http_refusals", { p_minutes: 60 })); } catch { http = null; }
  if (!health && !http) return { id: "R9", state: "unknown", detail: "neither cron reader answered" };
  const wrong: string[] = [];
  if (health) {
    const hb = health.find((j) => j.ch_jobname === "scan-heartbeat-sentinel");
    const last = Date.parse(String(hb?.ch_last_start ?? ""));
    if (!hb) wrong.push("the heartbeat's cron (scan-heartbeat-sentinel) is not scheduled");
    else if (hb.ch_active === false) wrong.push("the heartbeat's cron is inactive");
    else if (!Number.isFinite(last) || Date.now() - last > 40 * 60_000) wrong.push("the heartbeat's cron has not run in 40 minutes");
  }
  const h = http?.[0];
  if (h && h.available === true) {
    const bad = Number(h.server_errors ?? 0) + Number(h.timed_out ?? 0);
    if (bad >= 3) wrong.push(`${bad} cron call(s) answered 5xx or timed out in the last hour`);
  }
  return wrong.length ? { id: "R9", state: "alarm", detail: wrong.join("; ") } : { id: "R9", state: "ok", detail: "the heartbeat runs and the crons are answered" };
}

const OWNER_ALERT_SENDERS = ["Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>"];
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));

/** One mail per alarming rule per six hours; the door is given back when no sender accepted it. */
async function alarmOwner(db: Db, rule: Rule, fetchImpl: typeof fetch): Promise<boolean> {
  const door = "owner-alert:mail-watch";
  try {
    const { data: first, error } = await db.rpc("mail_door_take", { p_door: door, p_bucket: rule.id, p_max: 1, p_window_minutes: 360 });
    if (error || first !== true) return false;
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const owner = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";
    const admin = Deno.env.get("ADMIN_EMAIL") ?? owner;
    let sent = false;
    if (apiKey) {
      for (const from of OWNER_ALERT_SENDERS) {
        try {
          const res = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from, to: [from.includes("resend.dev") ? admin : owner],
              subject: `Mail watch ${rule.id}: ${rule.detail.slice(0, 90)}`,
              html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111"><p><b>${esc(rule.id)}</b>: ${esc(rule.detail)}</p><p>mail-watch checks every 15 minutes and mails once per rule per six hours while it lasts.</p></div>`,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (res.ok) { sent = true; break; }
        } catch { /* the next sender */ }
      }
    }
    if (!sent) await db.from("mail_door_counts").delete().eq("door", door).eq("bucket", rule.id);
    return sent;
  } catch {
    return false;
  }
}

/** healthchecks.io: a ping per run, /fail when a rule alarmed. Never throws. */
async function pingHealthcheck(alarm: boolean, fetchImpl: typeof fetch): Promise<boolean | null> {
  const url = Deno.env.get("HC_PING_URL") ?? "";
  if (!/^https:\/\/hc-ping\.com\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/.test(url)) return null;
  try {
    const r = await fetchImpl(alarm ? `${url}/fail` : url, { method: "GET", signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } }) as unknown as Db;
  // The cron (x-email-cron, from the vault) or our own servers; nobody else.
  if (!(await isScheduledCaller(req.headers, db, serviceKey))) return json({ error: "Unauthorized" }, 401);

  const fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  // The sign-in canary is requested as a visitor would: with the publishable key.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const anon = anonKey
    ? createClient(Deno.env.get("SUPABASE_URL") ?? "", anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as AuthClient
    : null;
  const rules = await Promise.all([
    classFailing(db), ordersWithNoMail(db), mailStuck(db), deadLettered(db), bounces(db), dnsDrift(fetchImpl),
    canaries(db, fetchImpl, anon), deliveredUnmailed(db), deadMan(db),
  ]);
  const alarms = rules.filter((r) => r.state === "alarm");
  const alerted: string[] = [];
  for (const rule of alarms) if (await alarmOwner(db, rule, fetchImpl)) alerted.push(rule.id);
  const pinged = await pingHealthcheck(alarms.length > 0, fetchImpl);

  const at = new Date().toISOString();
  try {
    await db.from("job_board_meta").upsert({
      k: "mail_watch_run",
      v: { at, build: FN_BUILD, rules: rules.map((r) => ({ id: r.id, state: r.state })), alarms: alarms.length, alerted: alerted.length, pinged },
      updated_at: at,
    }, { onConflict: "k" });
  } catch { /* the stamp is how a missed run is noticed, never a reason to fail one */ }

  return json({ at, build: FN_BUILD, rules, alarms: alarms.map((r) => r.id), alerted, pinged });
});
