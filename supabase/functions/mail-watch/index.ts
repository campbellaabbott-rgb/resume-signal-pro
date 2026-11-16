// MAIL-WATCH: A MAIL CLASS THAT IS REFUSED, STUCK OR STOPPED RINGS
// (critical-path plan 2026-10-12, CP-I; register CP-013, CP-021, CP-052,
// CP-003; bug round 2026-11-08).
//
// What it can and cannot see. R1 counts the log rows a class writes, so it
// sees a class whose sends are refused, never one that stopped trying (no
// attempt, no row). A scheduled class that stops is seen by R10 when its job
// fails or is switched off, and by R11 when its job runs and sends nothing:
// R11 reads the run stamp each scheduled mail function writes, so a class
// that writes none is not watched that way.
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
//   R2  paid orders with no purchase mail: each order written 15 minutes to
//       24 hours ago that should be mailed, judged by its own mail (a sent
//       purchase mail to its address since it was written; a delivered Full
//       Analysis by its report mail only, one waiting for its buyer by its
//       link mail or its report); an order marked email_failed rings until a
//       retry closes it;
//   R3  mail stuck: an email_send_log row 'pending' for over 2 minutes with no
//       later row for the same message;
//   R4  the queue gave up: a message the sign-in drain dead-lettered (its
//       'dlq' row in email_send_log) in the last 24 hours;
//   R5  bounces and complaints: 3 or more in 24 hours, at least 5% of sends;
//   R6  DNS drift, read over DNS-over-HTTPS: the 'send' SPF names Amazon SES
//       and every name it includes exists and publishes SPF (one that does
//       not is a permerror, so every mail fails SPF), Resend's DKIM key is
//       published, DMARC is published;
//   R7  the daily canaries, when CANARY_EMAIL is set: once a day a
//       transactional mail leaves through the shared sender (its log row must
//       read sent), and a sign-in code is requested for the canary account
//       (its queued mail must be logged sent within 10 minutes; auth mail goes
//       through Lovable and Mailgun, so 'sent' is the row, not a delivery);
//   R8  a delivered order whose mail never left, 30 minutes on (products
//       mailed with their content; the ones made on their own page are mailed
//       a link and are R2's);
//   R9  the dead-man pair and the cron answers: the heartbeat's own cron has
//       run in the last 40 minutes, no cron call was refused (401/403) in the
//       last hour, and fewer than 3 answered 5xx in the last 3 hours, read
//       with cron_http_answers (20261011200000), the rule scan-heartbeat
//       uses. A timeout is reported, never judged: no cron sets pg_net's
//       timeout, so every call to a function that runs past its 5-second
//       default reads timed_out.
//   R10 every other scheduled job, read with get_cron_health over 26 hours:
//       a job whose last run failed and that failed at least half its runs
//       (a SQL cron cancelled every run included) or ran only once (a daily,
//       weekly or monthly job), and a job switched off after it ran; over
//       the last hour and the last 3 hours, a job whose 3 or more runs there
//       all failed (so a job failing every run rings within the hour, or 3
//       for an hourly one); and, read with cron_disarmed_jobs
//       (20261103120000), an active job whose vault secret is gone, so it
//       runs, succeeds and posts nothing.
//   R11 a scheduled mail class that stopped: each class's run stamp
//       (job_board_meta mail_run:<class> = {at, due, sent, givenBack,
//       refused}, everyHours optional) older than its cadence plus 2 hours,
//       or mail due and none sent on two runs in a row. No stamp is unknown.
//
// Each rule says ok, alarm or unknown (a read that failed is unknown, never
// ok and never an alarm). An alarm mails the owner once per failing member
// (an order, a mail class, a job) per six hours, so a second order left
// unmailed is said within one run and an unchanged set stays quiet; a rule
// with no members mails once per six hours. It goes from our domain with
// Resend's onboarding sender as the fallback, and the doors are given back
// when no sender accepted it. When HC_PING_URL is set (healthchecks.io,
// outside Supabase and Resend), every completed run pings it, and only a run
// with an alarm that reached no sender pings its /fail: the alarms go by mail,
// so a standing alarm cannot blind the dead-man check. The run is stamped in
// job_board_meta (mail_watch_run, counts and states only: that table has an
// anon reader); the canaries keep their own stamp there (mail_watch_canary,
// timestamps and a sanitised error only), and R11 its memory of the runs it
// has seen (mail_watch_runs_seen, class names, times and counts).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isScheduledCaller } from "../_shared/email-cron.ts";
// R1's transport: one way out for a mail, with its email_send_log row.
import { sendMail } from "../_shared/send-mail.ts";

// Provable from outside: every response, the preflight included, carries this.
// 2026-10-11.29 (wave 4 round 2 integration): R9 judges refusals and 5xx
// answers only, as scan-heartbeat does; timeouts are reported, not judged.
// 2026-10-11.30 (wave 4 merges main 899be058): no change of its own; the
// _shared/send-mail.ts it bundles keeps its deadline armed until the Resend
// body is read (R1 hotfix, process-email-queue 2026-10-14.2).
// 2026-11-03.1 (audit-rest money: S13-081, S13-109): R2 judges each order
// by its own mail, so a Pro member's Full Analysis (mailed only its report)
// no longer reads as unmailed and a report that never left does; R10 rings
// for any scheduled job failing, cancelled every run, switched off or
// disarmed by a missing vault secret (cron_disarmed_jobs, 20261103120000).
const FN_BUILD = "mail-watch.2026-11-03.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-email-cron",
  "Access-Control-Expose-Headers": "x-fn-build",
  "x-fn-build": FN_BUILD,
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

export type RuleState = "ok" | "alarm" | "unknown";
/** One thing a rule found failing: an order, a mail class, a job. Its key is hashed into the owner-alert door, its label named in the mail. */
export type Member = { key: string; label: string };
export type Rule = { id: string; state: RuleState; detail: string; members?: Member[] };

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
    ? {
      id: "R1", state: "alarm", detail: `failing in the last hour: ${failing.map(([k, t]) => `${k} ${t.failed}/${t.total}`).join(", ")}`,
      members: failing.map(([k]) => ({ key: k, label: k })),
    }
    : { id: "R1", state: "ok", detail: `${tally.size} mail classes sent in the last hour; none failing` };
}

/** An order this young is not judged yet: its mail is sent in the background. */
const R2_GRACE_MS = 15 * 60_000;
/** A mail counts for an order from this long before the order's row (the webhook may mail first). */
const R2_LEAD_MS = 10 * 60_000;
const lowerTrim = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * R2 (S13-109): each order owed a mail, 15 minutes to 24 hours old, judged by
 * its own mail. It used to count every purchase mail sent in the day against
 * every order, so one buyer's mail hid another's missing one, and a Pro
 * member's Full Analysis (a delivered order mailed only its report,
 * 'analysis_results') rang "not one purchase mail" on a quiet day. An order
 * is answered by a sent purchase mail ('product_' anything) to its address
 * since it was written; an order with no address cannot be mailed and is
 * counted, not judged.
 *
 * And by its state (RC-S13-109). A Full Analysis marked delivered was made by
 * analyze-resume, which then sends the report, so only a sent report since it
 * was made answers it: the purchase-link mail it was sent at payment used to
 * answer it too, and hid a report that never left. One made under 15 minutes
 * ago is not judged yet. A Full Analysis in any other state is answered by its
 * link mail or its report. An order marked email_failed rings whatever else
 * reached its address, until a retry closes it (retry-failed-deliveries moves
 * it on when the mail leaves).
 */
async function ordersWithNoMail(db: Db): Promise<Rule> {
  const orders = await rows(db.from("product_deliveries")
    .select("id, product_type, status, generation_error, customer_email, created_at, content_generation_completed_at")
    .gte("created_at", iso(24 * HOUR)).lt("created_at", iso(R2_GRACE_MS)).limit(2000));
  const purchaseMails = await rows(db.from("email_logs").select("email_type, recipient, created_at").eq("status", "sent")
    .like("email_type", "product_%").gte("created_at", iso(25 * HOUR)).limit(5000));
  const reportMails = await rows(db.from("email_logs").select("email_type, recipient, created_at").eq("status", "sent")
    .eq("email_type", "analysis_results").gte("created_at", iso(25 * HOUR)).limit(5000));
  if (!orders || !purchaseMails || !reportMails) return { id: "R2", state: "unknown", detail: "orders or the purchase-mail log could not be read" };
  const mailable = orders.filter((o) => !NOT_MAILED.has(String(o.product_type)) && !String(o.generation_error ?? "").startsWith("undeliverable_retired"));
  const mailsTo = new Map<string, Array<{ report: boolean; at: number }>>();
  for (const [list, report] of [[purchaseMails, false], [reportMails, true]] as const) {
    for (const m of list) {
      const to = lowerTrim(m.recipient);
      if (to) mailsTo.set(to, [...(mailsTo.get(to) ?? []), { report, at: Date.parse(String(m.created_at ?? "")) }]);
    }
  }
  const now = Date.now();
  let unaddressed = 0;
  let madeJustNow = 0;
  const unmailed: Array<{ o: Record<string, unknown>; why: "unmailed" | "report" | "failed" }> = [];
  for (const o of mailable) {
    const to = lowerTrim(o.customer_email);
    if (!to) { unaddressed++; continue; }
    const type = String(o.product_type);
    const status = String(o.status ?? "");
    const mails = mailsTo.get(to) ?? [];
    if (status === "email_failed") { unmailed.push({ o, why: "failed" }); continue; }
    if (type === "full_analysis" && status === "delivered") {
      const made = Date.parse(String(o.content_generation_completed_at ?? ""));
      if (Number.isFinite(made) && now - made < R2_GRACE_MS) { madeJustNow++; continue; }
      const since = (Number.isFinite(made) ? made : Date.parse(String(o.created_at ?? ""))) - R2_LEAD_MS;
      if (!mails.some((m) => m.report && !(m.at < since))) unmailed.push({ o, why: "report" });
      continue;
    }
    const since = Date.parse(String(o.created_at ?? "")) - R2_LEAD_MS;
    if (!mails.some((m) => !(m.at < since) && (!m.report || type === "full_analysis"))) unmailed.push({ o, why: "unmailed" });
  }
  const notes = [
    ...(unaddressed ? [`${unaddressed} with no address, not judged`] : []),
    ...(madeJustNow ? [`${madeJustNow} made under 15 minutes ago, not judged yet`] : []),
  ].map((n) => `; ${n}`).join("");
  if (unmailed.length > 0) {
    const reports = unmailed.filter((u) => u.why === "report").length;
    const failed = unmailed.filter((u) => u.why === "failed").length;
    const why = [
      ...(reports ? [`${reports} delivered Full Analysis with no report mail sent`] : []),
      ...(failed ? [`${failed} marked email_failed and not yet resent`] : []),
    ].map((n) => `; ${n}`).join("");
    return {
      id: "R2", state: "alarm",
      detail: `${unmailed.length} of ${mailable.length} paid order(s) in 24 hours with no purchase mail sent to the buyer: ${[...new Set(unmailed.map((u) => u.o.product_type))].join(", ")}${why}${notes}`,
      members: unmailed.map(({ o, why }) => {
        const id = String(o.id ?? `${String(o.created_at ?? "")}|${String(o.product_type)}`);
        return { key: id, label: `${String(o.product_type)} order ${id.slice(0, 8)}${why === "report" ? " (report not sent)" : why === "failed" ? " (email_failed)" : ""}` };
      }),
    };
  }
  return { id: "R2", state: "ok", detail: `${mailable.length} mailable order(s) in 24 hours, every addressed one mailed${notes}` };
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
  return {
    id: "R4", state: "alarm", detail: `${r.length} message(s) the queue gave up on in 24 hours: ${kinds.join(", ")}`,
    members: kinds.map((k) => ({ key: k, label: k })),
  };
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

/** A name's TXT records and its DNS status (0 answered, 3 NXDOMAIN), over Cloudflare's DNS-over-HTTPS; null when the lookup failed. */
async function lookupTxt(name: string, fetchImpl: typeof fetch): Promise<{ status: number; records: string[] } | null> {
  try {
    const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const body = await r.json() as { Status?: number; Answer?: Array<{ data?: string }> };
    if (body.Status !== 0 && body.Status !== 3) return null;
    return { status: body.Status, records: (body.Answer ?? []).map((a) => String(a.data ?? "").replace(/^"|"$/g, "").replace(/"\s*"/g, "")) };
  } catch {
    return null;
  }
}

const isSpf = (t: string) => /^v=spf1(\s|$)/i.test(t);

/**
 * R6: the records every paid mail depends on are still published. The 'send'
 * SPF (Resend's return path) must name Amazon SES, and every name it includes
 * must exist and publish an SPF record of its own: an include that does not
 * (NXDOMAIN, or no record) is a permerror, and every mail fails SPF (NB-9).
 * Read one level down, as verify section 94 reads it. A lookup that failed is
 * unknown, never ok.
 */
async function dnsDrift(fetchImpl: typeof fetch): Promise<Rule> {
  const [spf, dkim, dmarc] = await Promise.all([
    lookupTxt("send.resumebooster.work", fetchImpl), lookupTxt("resend._domainkey.resumebooster.work", fetchImpl), lookupTxt("_dmarc.resumebooster.work", fetchImpl),
  ]);
  if (!spf || !dkim || !dmarc) return { id: "R6", state: "unknown", detail: "a DNS-over-HTTPS lookup failed" };
  const wrong: string[] = [];
  const unsure: string[] = [];
  const record = spf.records.find(isSpf);
  if (!record) wrong.push("the 'send' name publishes no SPF record");
  else {
    const includes = [...new Set([...record.matchAll(/\binclude:([^\s]+)/gi)].map((m) => m[1].toLowerCase()))];
    if (!includes.includes("amazonses.com")) wrong.push("the 'send' SPF does not include amazonses.com");
    const answers = await Promise.all(includes.slice(0, 10).map(async (name) => ({ name, r: await lookupTxt(name, fetchImpl) })));
    for (const { name, r } of answers) {
      if (!r) unsure.push(`the SPF include ${name} could not be looked up`);
      else if (r.status === 3) wrong.push(`the 'send' SPF includes ${name}, which does not exist (NXDOMAIN): a permerror, so every mail fails SPF (owner: set the TXT 'send' to v=spf1 include:amazonses.com ~all, then re-verify the domain in Resend)`);
      else if (!r.records.some(isSpf)) wrong.push(`the 'send' SPF includes ${name}, which publishes no SPF record: a permerror, so every mail fails SPF`);
    }
  }
  if (!dkim.records.some((t) => /\bp=/.test(t))) wrong.push("Resend's DKIM key is not published");
  if (!dmarc.records.some((t) => t.startsWith("v=DMARC1"))) wrong.push("no DMARC record");
  if (wrong.length) return { id: "R6", state: "alarm", detail: [...wrong, ...unsure].join("; ") };
  if (unsure.length) return { id: "R6", state: "unknown", detail: unsure.join("; ") };
  return { id: "R6", state: "ok", detail: "SPF (every include resolves), DKIM and DMARC published" };
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
  const r = await rows(db.from("product_deliveries").select("id, product_type, email_sent_at, email_success")
    .eq("status", "delivered").gte("created_at", iso(24 * HOUR)).lt("created_at", iso(30 * 60_000)).limit(2000));
  if (!r) return { id: "R8", state: "unknown", detail: "orders could not be read" };
  const unmailed = r.filter((o) => !NOT_MAILED.has(String(o.product_type)) && !MADE_ON_ITS_PAGE.has(String(o.product_type))
    && !o.email_sent_at && o.email_success !== true);
  return unmailed.length
    ? {
      id: "R8", state: "alarm", detail: `${unmailed.length} delivered order(s) with no mail sent: ${[...new Set(unmailed.map((o) => o.product_type))].join(", ")}`,
      members: unmailed.map((o) => {
        const id = String(o.id ?? `${String(o.product_type)}|${String(o.email_sent_at ?? "")}`);
        return { key: id, label: `${String(o.product_type)} order ${id.slice(0, 8)}` };
      }),
    }
    : { id: "R8", state: "ok", detail: `${r.length} order(s) delivered in the window; every one mailed` };
}

/** R9: the heartbeat's own cron has run, and the crons' calls are neither refused nor answered 5xx again and again. */
async function deadMan(db: Db): Promise<Rule> {
  let health: Array<Record<string, unknown>> | null = null;
  let http: Array<Record<string, unknown>> | null = null;
  try { health = await rows(db.rpc("get_cron_health", { p_hours: 2 })); } catch { health = null; }
  try { http = await rows(db.rpc("cron_http_answers", { p_minutes: 60, p_error_minutes: 180 })); } catch { http = null; }
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
  let timeouts = "";
  if (h && h.available === true) {
    const refused = Number(h.refused ?? 0);
    const errors = Number(h.server_errors ?? 0);
    const timedOut = Number(h.timed_out ?? 0);
    if (refused > 0) wrong.push(`${refused} cron call(s) refused (401/403) in the last hour`);
    if (errors >= 3) wrong.push(`${errors} cron call(s) answered 5xx in the last 3 hours`);
    if (timedOut > 0) timeouts = ` (${timedOut} call(s) outlived pg_net's 5-second wait, which is not judged)`;
  }
  return wrong.length
    ? { id: "R9", state: "alarm", detail: wrong.join("; ") + timeouts }
    : { id: "R9", state: "ok", detail: "the heartbeat runs and the crons are answered" + timeouts };
}

/**
 * R10 (S13-081): every scheduled job, not only the heartbeat's. R9 asked
 * get_cron_health one question (has scan-heartbeat-sentinel run); a SQL cron
 * cancelled on every run, a daily or monthly job whose run failed, or a job
 * switched off rang nothing. Over 26 hours (a daily job's run is always in
 * the window): a job whose last run failed and that failed at least half its
 * runs, or ran only once; and a job switched off after it ran (an old
 * deliberate switch-off has no runs in the window and is not news). A job
 * that fails now and then and recovers is not judged. And a job disarmed:
 * active, reading a vault secret that no longer exists (cron_disarmed_jobs),
 * which every run 'succeeds' at by posting nothing, so neither reader above
 * sees it. That second read is judged when it answers; until its migration
 * is applied the detail says it was not read.
 *
 * A job that starts failing every run (S14X-217). Half of 26 hours of a
 * ten-minute job is about 13 hours of failures before the rule above rings,
 * so the same reader is also asked for the last hour and the last 3 hours: a
 * job whose last run failed and whose 3 or more runs in either window all
 * failed rings, within the hour for a job every 20 minutes or oftener and
 * within 3 hours for an hourly one. No streak column: get_cron_health's shape
 * is shared with R9 and the verifier, and asking it twice more is cheap.
 */
async function cronJobsFailing(db: Db): Promise<Rule> {
  const read = async (hours: number) => {
    try { return await rows(db.rpc("get_cron_health", { p_hours: hours })); } catch { return null; }
  };
  const [health, lastHour, last3Hours] = await Promise.all([read(26), read(1), read(3)]);
  if (!health) return { id: "R10", state: "unknown", detail: "get_cron_health did not answer" };
  if (health.length === 0) return { id: "R10", state: "unknown", detail: "no scheduled job is visible" };
  let disarmedRows: Array<Record<string, unknown>> | null = null;
  try { disarmedRows = await rows(db.rpc("cron_disarmed_jobs", {})); } catch { disarmedRows = null; }
  const disarmed = (disarmedRows ?? []).map((d) => ({
    name: String(d.cd_jobname ?? "?"), text: `${String(d.cd_jobname ?? "?")} (vault secret ${String(d.cd_missing_secret ?? "?")} is missing)`,
  }));
  // Every run in the window failed, at least 3 of them: the newest window that says so.
  const streak = new Map<string, string>();
  for (const [list, hours] of [[lastHour, 1], [last3Hours, 3]] as const) {
    for (const j of list ?? []) {
      const name = String(j.ch_jobname ?? "?");
      const runs = Number(j.ch_runs ?? 0);
      const failed = Number(j.ch_failed ?? 0);
      if (!streak.has(name) && j.ch_last_status === "failed" && runs >= 3 && failed >= runs) {
        streak.set(name, `every one of its ${runs} run(s) in the last ${hours === 1 ? "hour" : `${hours} hours`} failed`);
      }
    }
  }
  const failing: string[] = [];
  const switchedOff: string[] = [];
  const members: Member[] = [];
  for (const j of health) {
    const name = String(j.ch_jobname ?? "?");
    const runs = Number(j.ch_runs ?? 0);
    const failed = Number(j.ch_failed ?? 0);
    const cancelled = Number(j.ch_timeouts ?? 0);
    if (j.ch_last_status === "failed" && runs >= 1 && (runs === 1 || failed * 2 >= runs)) {
      failing.push(`${name} (${failed} of ${runs} run(s) failed${cancelled ? `, ${cancelled} cancelled at its statement timeout` : ""})`);
      members.push({ key: `failing:${name}`, label: `${name} failing` });
    } else if (streak.has(name)) {
      failing.push(`${name} (${streak.get(name)})`);
      members.push({ key: `failing:${name}`, label: `${name} failing` });
    }
    if (j.ch_active === false && runs > 0) {
      switchedOff.push(name);
      members.push({ key: `off:${name}`, label: `${name} switched off` });
    }
  }
  for (const d of disarmed) members.push({ key: `disarmed:${d.name}`, label: `${d.name} disarmed` });
  const wrong = [
    ...(failing.length ? [`failing: ${failing.join(", ")}`] : []),
    ...(switchedOff.length ? [`switched off after running: ${switchedOff.join(", ")}`] : []),
    ...(disarmed.length ? [`disarmed, running and posting nothing: ${disarmed.map((d) => d.text).join(", ")}`] : []),
  ];
  const unread = (disarmedRows ? "" : "; cron_disarmed_jobs did not answer, so a disarmed job is not judged")
    + (lastHour || last3Hours ? "" : "; the 1- and 3-hour reads did not answer, so a job failing every run is judged only at half its 26 hours");
  return wrong.length
    ? { id: "R10", state: "alarm", detail: wrong.join("; ") + unread, members }
    : { id: "R10", state: "ok", detail: `${health.length} scheduled job(s); none failing, newly switched off or disarmed${unread}` };
}

/** The run stamps the scheduled mail functions write: job_board_meta mail_run:<class>. */
const MAIL_RUN_PREFIX = "mail_run:";
/** R11's memory of the last run it saw of each class, so two empty runs in a row can be told from one run read twice. */
const R11_MEMORY_KEY = "mail_watch_runs_seen";
/** How often each class runs, in hours, when its stamp does not say (everyHours). */
const MAIL_RUN_CADENCE_H: Record<string, number> = { search_digest: 24, agent_digest: 24, market_pulse: 24 };
/** A run is late past its cadence plus this many hours. */
const MAIL_RUN_SLACK_H = 2;

/**
 * R11 (NB-37): a scheduled mail class that stops trying. R1 counts the rows a
 * class writes, so a class that stops attempting writes none and rings
 * nothing. Each scheduled mail function stamps its run: job_board_meta
 * mail_run:<class> = { at, due, sent, givenBack, refused } (everyHours when
 * its cadence is not a day), where due is the mails it set out to send after
 * its own opt-outs and suppressions. A stamp older than its cadence plus 2
 * hours rings; so does mail due and none sent on two runs in a row (a run
 * read twice is one run, told by its time). No stamp at all is unknown: the
 * classes are watched once they write one. A class retired on purpose has its
 * stamp deleted with it.
 */
async function mailRunsStopped(db: Db): Promise<Rule> {
  const stamps = await rows(db.from("job_board_meta").select("k, v, updated_at").like("k", `${MAIL_RUN_PREFIX}%`).limit(50));
  if (!stamps) return { id: "R11", state: "unknown", detail: "the mail-run stamps could not be read" };
  if (stamps.length === 0) return { id: "R11", state: "unknown", detail: `no scheduled mail class stamps its runs yet (job_board_meta ${MAIL_RUN_PREFIX}<class>)` };
  const memoryRows = await rows(db.from("job_board_meta").select("v").eq("k", R11_MEMORY_KEY).limit(1));
  const memory = (memoryRows?.[0]?.v && typeof memoryRows[0].v === "object" ? memoryRows[0].v : {}) as Record<string, { at?: unknown; emptyRuns?: unknown }>;
  const seen: Record<string, { at: string; emptyRuns: number }> = {};
  const now = Date.now();
  const late: string[] = [];
  const empty: string[] = [];
  const members: Member[] = [];
  for (const s of stamps) {
    const cls = String(s.k ?? "").slice(MAIL_RUN_PREFIX.length) || "?";
    const v = (s.v && typeof s.v === "object" ? s.v : {}) as Record<string, unknown>;
    const at = Date.parse(String(v.at ?? s.updated_at ?? ""));
    const every = Number(v.everyHours);
    const cadence = Number.isFinite(every) && every > 0 ? every : MAIL_RUN_CADENCE_H[cls] ?? 24;
    if (!Number.isFinite(at)) {
      late.push(`${cls} (its stamp carries no time it ran)`);
      members.push({ key: `late:${cls}`, label: `${cls} not running` });
      continue;
    }
    const ageH = Math.floor((now - at) / HOUR);
    if (now - at > (cadence + MAIL_RUN_SLACK_H) * HOUR) {
      late.push(`${cls} has not run in ${ageH} h (it runs every ${cadence} h)`);
      members.push({ key: `late:${cls}`, label: `${cls} not running` });
    }
    const due = Number(v.due ?? 0);
    const sent = Number(v.sent ?? 0);
    const wasEmpty = due > 0 && sent === 0;
    const runAt = new Date(at).toISOString();
    const prev = memory[cls];
    const prevEmpty = Number(prev?.emptyRuns ?? 0);
    const emptyRuns = prev && prev.at === runAt ? (Number.isFinite(prevEmpty) ? prevEmpty : 0) : wasEmpty ? (Number.isFinite(prevEmpty) ? prevEmpty : 0) + 1 : 0;
    seen[cls] = { at: runAt, emptyRuns };
    if (emptyRuns >= 2) {
      empty.push(`${cls} (${due} due, none sent on its last ${emptyRuns} runs; ${Number(v.refused ?? 0)} refused, ${Number(v.givenBack ?? 0)} given back)`);
      members.push({ key: `empty:${cls}`, label: `${cls} sending nothing` });
    }
  }
  // Without its memory R11 cannot tell two runs from one: it judges lateness only and keeps what it had.
  let memoryNote = "";
  if (!memoryRows) memoryNote = "; its memory of earlier runs could not be read, so empty runs are not judged";
  else {
    try {
      await db.from("job_board_meta").upsert({ k: R11_MEMORY_KEY, v: seen, updated_at: new Date(now).toISOString() }, { onConflict: "k" });
    } catch {
      memoryNote = "; its memory of this run could not be written";
    }
  }
  const judgedEmpty = memoryRows ? empty : [];
  const wrong = [
    ...(late.length ? [`stopped: ${late.join(", ")}`] : []),
    ...(judgedEmpty.length ? [`sending nothing: ${judgedEmpty.join(", ")}`] : []),
  ];
  return wrong.length
    ? { id: "R11", state: "alarm", detail: wrong.join("; ") + memoryNote, members: memoryRows ? members : members.filter((m) => m.key.startsWith("late:")) }
    : { id: "R11", state: "ok", detail: `${stamps.length} mail class(es) stamped; each ran within its cadence and sent when mail was due${memoryNote}` };
}

const OWNER_ALERT_SENDERS = ["Resume Booster Alerts <alerts@resumebooster.work>", "Resume Booster Alerts <onboarding@resend.dev>"];
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c] as string));

/** The most members of one rule that get a door of their own each run; the rest are counted in the mail. */
const MAX_MEMBER_DOORS = 25;

/** The first 16 hex digits of a member key's SHA-256: a door bucket is at most 64 characters and never carries an id or an address. */
async function bucketOf(ruleId: string, key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return `${ruleId}:${[...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** What became of an alarm: mailed now, already told inside six hours, or reaching no sender. */
export type AlarmOutcome = "sent" | "held" | "unsent";

/**
 * One mail per failing member per six hours (S14X-242). A door per rule meant
 * a second order left unmailed an hour after the first waited up to six hours
 * behind the first one's mail. Each member (an order, a mail class, a job)
 * now takes its own door, rule id and a hash of its key; the mail goes when
 * any door opened, naming the new members and the total, and every door it
 * opened is given back when no sender accepted it. A rule with no members
 * keeps one door of its own. A door that could not be asked is an alarm that
 * reached nobody.
 */
async function alarmOwner(db: Db, rule: Rule, fetchImpl: typeof fetch): Promise<AlarmOutcome> {
  const door = "owner-alert:mail-watch";
  const members = rule.members ?? [];
  const tracked = members.slice(0, MAX_MEMBER_DOORS);
  const doors = members.length
    ? await Promise.all(tracked.map(async (m) => ({ label: m.label, bucket: await bucketOf(rule.id, m.key) })))
    : [{ label: "", bucket: rule.id }];
  const opened: typeof doors = [];
  let doorFailed = false;
  for (const d of doors) {
    try {
      const { data, error } = await db.rpc("mail_door_take", { p_door: door, p_bucket: d.bucket, p_max: 1, p_window_minutes: 360 });
      if (error) doorFailed = true;
      else if (data === true) opened.push(d);
    } catch {
      doorFailed = true;
    }
  }
  if (opened.length === 0) return doorFailed ? "unsent" : "held";
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const owner = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";
  const admin = Deno.env.get("ADMIN_EMAIL") ?? owner;
  const news = members.length
    ? `<p>New since this rule last mailed: ${esc(opened.map((d) => d.label).join(", "))} (${opened.length} new of ${members.length} failing${members.length > MAX_MEMBER_DOORS ? `; the first ${MAX_MEMBER_DOORS} are tracked one by one` : ""}).</p>`
    : "";
  const tag = members.length ? ` (${opened.length} new of ${members.length})` : "";
  let sent = false;
  if (apiKey) {
    for (const from of OWNER_ALERT_SENDERS) {
      try {
        const res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from, to: [from.includes("resend.dev") ? admin : owner],
            subject: `Mail watch ${rule.id}${tag}: ${rule.detail.slice(0, 90)}`,
            html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111"><p><b>${esc(rule.id)}</b>: ${esc(rule.detail)}</p>${news}<p>mail-watch checks every 15 minutes and mails once per failing order, mail class or job per six hours while it lasts.</p></div>`,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) { sent = true; break; }
      } catch { /* the next sender */ }
    }
  }
  if (!sent) {
    for (const d of opened) {
      try { await db.from("mail_door_counts").delete().eq("door", door).eq("bucket", d.bucket); } catch { /* the next run asks again */ }
    }
  }
  return sent ? "sent" : "unsent";
}

/**
 * healthchecks.io: a ping per completed run, its /fail only when an alarm
 * reached no sender (NB-9). The alarms themselves go by mail; pinging /fail on
 * every alarm meant a standing one (a DNS record waiting on the owner) held
 * the external check failed, so the day mail-watch itself stopped, nothing
 * changed. Never throws.
 */
async function pingHealthcheck(alarmUnmailed: boolean, fetchImpl: typeof fetch): Promise<boolean | null> {
  const url = Deno.env.get("HC_PING_URL") ?? "";
  if (!/^https:\/\/hc-ping\.com\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/.test(url)) return null;
  try {
    const r = await fetchImpl(alarmUnmailed ? `${url}/fail` : url, { method: "GET", signal: AbortSignal.timeout(5000) });
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
    canaries(db, fetchImpl, anon), deliveredUnmailed(db), deadMan(db), cronJobsFailing(db), mailRunsStopped(db),
  ]);
  const alarms = rules.filter((r) => r.state === "alarm");
  const alerted: string[] = [];
  const unmailed: string[] = [];
  for (const rule of alarms) {
    const outcome = await alarmOwner(db, rule, fetchImpl);
    if (outcome === "sent") alerted.push(rule.id);
    else if (outcome === "unsent") unmailed.push(rule.id);
  }
  const pinged = await pingHealthcheck(unmailed.length > 0, fetchImpl);
  // The members (order ids, job names) are for the owner's mail only.
  const said = rules.map(({ id, state, detail }) => ({ id, state, detail }));

  const at = new Date().toISOString();
  try {
    await db.from("job_board_meta").upsert({
      k: "mail_watch_run",
      v: { at, build: FN_BUILD, rules: rules.map((r) => ({ id: r.id, state: r.state })), alarms: alarms.length, alerted: alerted.length, unmailed: unmailed.length, pinged },
      updated_at: at,
    }, { onConflict: "k" });
  } catch { /* the stamp is how a missed run is noticed, never a reason to fail one */ }

  return json({ at, build: FN_BUILD, rules: said, alarms: alarms.map((r) => r.id), alerted, unmailed, pinged });
});
