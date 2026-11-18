// What the heartbeat judges about the crons, its own end-to-end clock, and
// who watches the heartbeat itself (S12 sweep, ops: S12-157, S12-159,
// S12-065). Pure apart from pingDeadMan's fetch, so vitest and Deno read the
// same rules.

/** One answer row of cron_http_answers (20261011200000). */
export interface CronAnswers {
  available?: boolean;
  responses?: number;
  refused?: number;
  last_refused_status?: number | null;
  last_refused_sample?: string | null;
  error_window_responses?: number;
  server_errors?: number;
  timed_out?: number;
  not_found?: number;
  last_error_status?: number | null;
  last_error_sample?: string | null;
}

/** The window refusals are read over (minutes). One refused call is a key or a gate, never a blip. */
export const CRON_REFUSAL_WINDOW_MIN = 60;
/**
 * The window 5xx answers are read over, and how many fail the check. Three
 * hours, so an hourly job that errors on every run is seen three times
 * before pg_net's own six-hour retention drops its answers; three, so one
 * gateway blip on a job that runs every few minutes is not an alarm.
 */
export const CRON_ERROR_WINDOW_MIN = 180;
export const CRON_ERROR_ALARM = 3;

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clip = (s: unknown, len = 120) => String(s ?? "").slice(0, len);

/**
 * THE CRON ANSWERS CHECK (S12-157). It failed only on a 401/403, so a cron
 * whose function answered 500 on every run read green. Now: any refusal in
 * the last hour fails it; CRON_ERROR_ALARM or more 5xx answers in the last
 * three hours fail it, naming the newest; 404s and timeouts are counted in
 * its text, never failed on (a 404 is usually a job aimed at a removed
 * function, worth reading; a timeout is pg_net giving up after its default
 * five seconds while a long function runs on, so it is no verdict at all).
 * null when the reader answered nothing to judge: the caller records a skip.
 */
export function cronAnswersCheck(r: CronAnswers | null | undefined): { passed: boolean; error?: string; reason?: string } | null {
  if (!r || r.available !== true) return null;
  const refused = n(r.refused);
  const errors = n(r.server_errors);
  const tally = `in ${CRON_ERROR_WINDOW_MIN / 60} h of ${n(r.error_window_responses)} answers: 5xx ${errors}, 404 ${n(r.not_found)}, timeouts ${n(r.timed_out)} (pg_net's five-second wait, not a verdict)`;
  const parts: string[] = [];
  if (refused > 0) {
    parts.push(`${refused} of ${n(r.responses)} cron calls in the last hour were refused (latest HTTP ${r.last_refused_status ?? "?"}: ${clip(r.last_refused_sample)})`);
  }
  if (errors >= CRON_ERROR_ALARM) {
    parts.push(`${errors} cron calls answered a server error in the last ${CRON_ERROR_WINDOW_MIN / 60} hours (at least ${CRON_ERROR_ALARM} fails this check; newest HTTP ${r.last_error_status ?? "?"}: ${clip(r.last_error_sample)})`);
  }
  if (!parts.length) return { passed: true, reason: tally };
  return { passed: false, error: `${parts.join("; ")}; ${tally}` };
}

/**
 * THE END-TO-END SCAN'S CLOCK (S12-159). The heartbeat aborted its scan at
 * 75 s while free-keyword-scan's own model clock runs to 85 s before it
 * serves the rule-based report, so a slow gateway read as 'down' while every
 * visitor still got an answer. The heartbeat now waits past the scanner's
 * clock and its report assembly, and an abort on ITS clock is 'degraded'
 * (slow, not proven down); an error answer or a broken report is still down.
 */
export const SCANNER_AI_DEADLINE_MS = 85_000;
export const E2E_ABORT_MS = 100_000;

export function e2eAbortedText(elapsedMs: number): string {
  return `free-keyword-scan gave no answer within ${Math.round(E2E_ABORT_MS / 1000)} s (its own model clock is ${Math.round(SCANNER_AI_DEADLINE_MS / 1000)} s, then the rule-based report): slow, not proven down (${Math.round(elapsedMs / 1000)} s)`;
}

/**
 * THE RUN'S OWN CLOCK (S13-069). The isolate is cut at about 150 s, and the
 * run wrote its row and decided its alert only after every check, so a slow
 * gateway or database (the AI probe had no clock at all) could take the run
 * past the cut: no row, no alert, during exactly the incident they exist for.
 * Now the AI probe gives up at AI_PROBE_MS ('degraded': slow, not proven
 * down, as for the end-to-end scan), the end-to-end scan starts with the
 * checks instead of after them, and the checks get RUN_BUDGET_MS in all:
 * whatever has not finished then is not evaluated, a failed 'run_budget'
 * check says so, the run is degraded, and the row, the alert and the
 * dead-man ping still go out with time to spare.
 */
export const AI_PROBE_MS = 30_000;
export const RUN_BUDGET_MS = 115_000;

export function aiProbeAbortedText(elapsedMs: number): string {
  return `the AI gateway gave no answer to a 100-token probe within ${Math.round(AI_PROBE_MS / 1000)} s: slow, not proven down (${Math.round(elapsedMs / 1000)} s)`;
}

export function runBudgetText(finished: number): string {
  return `the checks had not finished within the run's ${Math.round(RUN_BUDGET_MS / 1000)} s budget (${finished} finished); the rest were not evaluated, so the row and the alert could still go out before the isolate is cut`;
}

/** True for the error an AbortController's abort() raises in fetch. */
export function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message));
}

/**
 * WHO WATCHES THE HEARTBEAT (S12-065). Its alerts, the refusal check and the
 * Stripe-key check all run inside it; if its cron stops (a vault re-key, a
 * revoked job), the inbox goes quiet and quiet reads as healthy. Each run
 * pings HC_HEARTBEAT_PING_URL, a healthchecks.io check outside Supabase and
 * Resend that mails the owner when the pings stop: a success ping for a run
 * that finished, /fail for one that found the product down. Its OWN check,
 * never mail-watch's HC_PING_URL: two senders on one check keep it quiet
 * while either is alive, so the death of the other would never be heard.
 * Unset or not https, nothing is sent and the run says so. Never throws; a
 * ping that fails must not fail the heartbeat.
 */
/** The secret the heartbeat pings: its own healthchecks.io check. */
export const HEARTBEAT_PING_ENV = "HC_HEARTBEAT_PING_URL";

/**
 * THE OTHER HALF OF THE DEAD-MAN PAIR. mail-watch (every 15 minutes) alarms
 * when the heartbeat's cron stops; the heartbeat alarms when mail-watch's run
 * stamp (job_board_meta mail_watch_run) is older than three of its runs. No
 * stamp at all is no verdict: mail-watch has not run here yet.
 */
export const MAIL_WATCH_STALE_MIN = 45;
export function mailWatchCheck(updatedAt: string | null | undefined, now = Date.now()): { passed: boolean; error?: string } | null {
  const at = Date.parse(String(updatedAt ?? ""));
  if (!Number.isFinite(at)) return null;
  const age = Math.max(0, Math.floor((now - at) / 60_000));
  return age <= MAIL_WATCH_STALE_MIN
    ? { passed: true }
    : { passed: false, error: `mail-watch last ran ${age} min ago (it runs every 15): the alarms on mail that stopped, bounced or never left are silent` };
}

/**
 * THE FREE SCANNER'S HOUR RAN OUT (S12-142's alarm). free-keyword-scan
 * serves a rule-based report past its strangers' hour and records the refusal
 * on the scan's metric (metadata.ceilingRefused); nothing read it, so a day of
 * visitors getting the thin report was invisible. More than
 * CEILING_REFUSALS_ALARM refused scans in the last hour fails the check.
 */
export const CEILING_REFUSALS_ALARM = 10;
export function ceilingRefusalCheck(count: number | null | undefined): { passed: boolean; error?: string } | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  return count <= CEILING_REFUSALS_ALARM
    ? { passed: true }
    : { passed: false, error: `${count} free scans in the last hour hit the scanner's hourly ceiling and got the rule-based report (alarm above ${CEILING_REFUSALS_ALARM})` };
}

export async function pingDeadMan(
  url: string | undefined | null,
  status: string,
  fetchFn: (u: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<"sent" | "unset" | "failed"> {
  const u = String(url ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+\/\S+$/.test(u)) return "unset";
  try {
    const r = await fetchFn(status === "down" ? `${u}/fail` : u, { method: "POST", body: status, signal: AbortSignal.timeout(5_000) });
    await r.body?.cancel().catch(() => {});
    return r.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * THE HOURLY TIER (cost audit 2026-11-08, Do first #1; owner decision
 * 2026-11-08). Every run was a full uncached scan (two model calls carrying
 * the whole scan prompt), four filtered board reads, the vendor canary and two
 * whole-table storage reads, 144 times a day: about 98% of the free scanner's
 * model calls were this monitor. The 10-minute cron stays, and so do the
 * healthchecks.io ping, job-board status and every cheap check; the costly
 * ones run on the first run of each UTC hour (minute 0-9: the ten-minute
 * cron's :00 run). A run the owner or our own service role starts by hand is
 * always a full run: someone asked for the whole answer.
 */
export const FULL_RUN_MINUTES = 10;
export function isFullRun(now: Date, byCron: boolean): boolean {
  return !byCron || now.getUTCMinutes() < FULL_RUN_MINUTES;
}
/** The reason every check the off-hour run leaves out is skipped with. */
export const HOURLY = "runs hourly";

/**
 * The facets row's age bound. Its cron ticks every 15 minutes but rebuilds
 * only a row older than 40 (20261109120000), so a healthy row reaches about
 * 55 minutes; 90 tolerates two missed rebuilds, where the old 60-minute bound
 * on an every-15-minutes rebuild tolerated three missed ticks.
 */
export const FACETS_STALE_MIN = 90;

/**
 * WHAT THE HOUR FOUND, KEPT FOR THE OFF-HOUR RUNS (review 2026-11-15). An
 * off-hour run skips the five hourly checks, and a skip never moves the
 * status, so while one of them was failing the next run read 'healthy',
 * mailed "Heartbeat recovered", stamped the alert state healthy (which reset
 * the four-hour cooldown, so the :00 run's alert was never sent again), and
 * flipped heartbeat_results and the healthchecks.io ping back to green five
 * runs in six. Now the full run stores its failed hourly checks with the
 * severity each gave the run, and an off-hour run that finds a verdict from
 * the last CARRY_MS reports them again as failed, marked carried, at that
 * severity: the alert state, the row and the ping read what the hour found
 * until the next full run looks again.
 */
export const HOURLY_CHECKS = ["e2e_scan", "job_board_storage", "job_board_verification_ceiling", "job_board_filter_contract", "job_board_vendors"] as const;
export const HOURLY_VERDICT_KEY = "heartbeat_hourly_verdict";
/** An hour between full runs, and the ten minutes a full run may start late. */
export const CARRY_MS = 70 * 60_000;
export type Severity = "degraded" | "unhealthy" | "down";
export type HourlyFailure = { name: string; error: string; severity: Severity };
export type HourlyVerdict = { at: string; failed: HourlyFailure[] };
const RANK: Record<string, number> = { healthy: 0, degraded: 1, unhealthy: 2, down: 3 };
/** The worse of two run statuses (healthy < degraded < unhealthy < down). */
export function worse(a: string, b: string): string {
  return (RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a;
}
/** The full run's verdict on the hourly checks: each failed one, with the severity it gave the run. */
export function hourlyVerdictOf(
  at: Date,
  checks: Array<{ name: string; passed: boolean; error?: string; severity?: Severity }>,
): HourlyVerdict {
  const hourly = new Set<string>(HOURLY_CHECKS);
  return {
    at: at.toISOString(),
    failed: checks
      .filter((c) => hourly.has(c.name) && !c.passed)
      .map((c) => ({ name: c.name, error: String(c.error ?? "failed"), severity: c.severity ?? (c.name === "job_board_filter_contract" ? "unhealthy" : "degraded") })),
  };
}
/** The failed checks an off-hour run carries from a stored verdict, or none when it is missing, malformed or older than CARRY_MS. */
export function carriedFailures(v: unknown, now: Date): { from: string; failed: HourlyFailure[] } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { at?: unknown; failed?: unknown };
  const at = typeof o.at === "string" ? Date.parse(o.at) : NaN;
  if (!Number.isFinite(at) || now.getTime() - at > CARRY_MS || at > now.getTime() + 60_000 || !Array.isArray(o.failed)) return null;
  const hourly = new Set<string>(HOURLY_CHECKS);
  const failed = o.failed.filter((f): f is HourlyFailure =>
    !!f && typeof f === "object" && hourly.has((f as HourlyFailure).name) && typeof (f as HourlyFailure).error === "string"
    && ["degraded", "unhealthy", "down"].includes((f as HourlyFailure).severity));
  if (!failed.length) return null;
  return { from: new Date(at).toISOString().slice(11, 16) + " UTC", failed };
}
/** The error a carried check is reported with. */
export function carriedText(from: string, error: string): string {
  return `carried from the ${from} full run (hourly check, not re-run): ${error}`;
}

/**
 * THE OWNER'S HEARTBEAT MAIL, DECIDED IN ONE PLACE (bug round 2026-11-08:
 * S14X-018, S14X-045). index.ts reads the stored state, asks this, sends the
 * mail it names, and writes back the state it returns: after Resend accepted
 * the mail when there is one (a refused mail stamps nothing, so the next run
 * tries again), at once when there is none.
 *
 * WHAT WAS WRONG.
 *   - A heartbeat that stayed down mailed once and then said nothing for a
 *     day: every failing check had been announced, escalation needs a status
 *     that was not down before, and the reminder waits 24 hours. Going from
 *     down to degraded was never said at all.
 *   - The recovery note stamped the time the four-hour cooldown counts from,
 *     so a new failure soon after a recovery (a refused Stripe key: every
 *     checkout failing) waited up to four hours; and a degraded state only
 *     ever written silently got a 'recovered' note when it cleared.
 *
 * THE RULES NOW.
 *   - A check is news when it has not been announced in REMIND_MS.
 *   - Degraded and unhealthy alerts share a cooldown of DEGRADED_COOLDOWN_MS
 *     from lastAlertAt: the last alert Resend accepted IN THIS INCIDENT. A
 *     healthy run ends the incident and clears it, so the cooldown ends with
 *     its incident.
 *   - Going down always mails. While it stays down, a reminder goes every
 *     DOWN_REMIND_MS saying how long (downSince). Leaving down for degraded
 *     or unhealthy mails one 'no longer down' note, past the cooldown.
 *   - The same degraded set is reminded once a day.
 *   - A healthy run mails 'recovered' only when this incident was announced
 *     (its checks carry a stamp); otherwise it clears the state silently.
 *     A check flapping in and out is still bounded by the two-an-hour
 *     backstop in index.ts: a recovery follows only an accepted alert.
 */
export const REMIND_MS = 24 * 60 * 60_000;
export const DOWN_REMIND_MS = 2 * 60 * 60_000;
export const DEGRADED_COOLDOWN_MS = 4 * 60 * 60_000;
export const ALERT_STATE_KEY = "heartbeat_alert_state";
/** What job_board_meta keeps between runs. lastSentAt is an older build's field: read, never written. */
export type AlertState = {
  fingerprint: string;
  lastAlertAt?: string;
  alerted?: Record<string, string>;
  downSince?: string;
};
export type HeartbeatMailKind = "alert" | "reminder" | "down-reminder" | "eased" | "recovered";
export type HeartbeatMailDecision = {
  /** The mail to send, or null for a silent run. */
  kind: HeartbeatMailKind | null;
  /** The state to keep, or null to leave the stored row as it is. */
  next: AlertState | null;
  /** The status the stored state held before this run. */
  prevStatus: string;
  /** While down: since when, and for how many minutes. */
  downSince?: string;
  downForMin?: number;
  reason: string;
};

const parseAt = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);

export function decideHeartbeatMail(stored: unknown, status: string, failedNames: string[], now: number): HeartbeatMailDecision {
  const prev = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const fp = typeof prev.fingerprint === "string" ? prev.fingerprint : "";
  const inIncident = fp !== "" && !fp.startsWith("healthy");
  const prevStatus = inIncident ? fp.split("|")[0] : "healthy";
  const alerted: Record<string, string> = {};
  if (prev.alerted && typeof prev.alerted === "object") {
    for (const [k, v] of Object.entries(prev.alerted as Record<string, unknown>)) if (Number.isFinite(parseAt(v))) alerted[k] = String(v);
  }
  const stamps = Object.values(alerted).map(parseAt);
  // Announced in this incident: a check carries a stamp (a healthy run clears
  // them). The cooldown's anchor is lastAlertAt; a row an older build wrote
  // has only lastSentAt, which is the last alert's time while stamps exist.
  const announced = inIncident && stamps.length > 0;
  const lastAlert = !announced ? NaN
    : Number.isFinite(parseAt(prev.lastAlertAt)) ? parseAt(prev.lastAlertAt)
    : Number.isFinite(parseAt(prev.lastSentAt)) ? parseAt(prev.lastSentAt)
    : Math.max(...stamps);
  const iso = (t: number) => new Date(t).toISOString();

  if (status === "healthy") {
    if (!inIncident) return { kind: null, next: null, prevStatus, reason: "healthy, as the stored state was" };
    const next: AlertState = { fingerprint: "healthy" };
    return announced
      ? { kind: "recovered", next, prevStatus, reason: `the announced state ${fp} cleared` }
      : { kind: null, next, prevStatus, reason: `cleared silently: ${fp} was never announced` };
  }

  const failed = [...new Set(failedNames)].sort();
  const fingerprint = `${status}|${failed.join(",")}`;
  const isDown = status === "down";
  const wasDown = prevStatus === "down";
  const news = failed.filter((c) => {
    const t = parseAt(alerted[c]);
    return !Number.isFinite(t) || now - t >= REMIND_MS;
  });
  const downSince = !isDown ? undefined
    : wasDown && Number.isFinite(parseAt(prev.downSince)) ? String(prev.downSince)
    : wasDown && Number.isFinite(lastAlert) ? iso(lastAlert)
    : iso(now);
  const cooled = !isDown && Number.isFinite(lastAlert) && now - lastAlert < DEGRADED_COOLDOWN_MS;

  let kind: HeartbeatMailKind | null = null;
  let reason = "no unannounced check, no escalation, no reminder due";
  if (isDown && !wasDown) { kind = "alert"; reason = "went down"; }
  else if (wasDown && !isDown && announced) { kind = "eased"; reason = `no longer down, still ${status}`; }
  else if (news.length && !cooled) { kind = "alert"; reason = `news: ${news.join(", ")}`; }
  else if (isDown && (!Number.isFinite(lastAlert) || now - lastAlert >= DOWN_REMIND_MS)) { kind = "down-reminder"; reason = "still down"; }
  else if (!isDown && fp === fingerprint && Number.isFinite(lastAlert) && now - lastAlert >= REMIND_MS) { kind = "reminder"; reason = "the same set, a day on"; }
  else if (news.length) reason = `news held by the cooldown: ${news.join(", ")}`;

  // A check is stamped announced only by a mail that went out; a silent run
  // keeps the stamps it had for checks still failing.
  const nextAlerted: Record<string, string> = {};
  for (const c of failed) {
    if (kind) nextAlerted[c] = iso(now);
    else if (alerted[c]) nextAlerted[c] = alerted[c];
  }
  const next: AlertState = {
    fingerprint,
    alerted: nextAlerted,
    ...(kind ? { lastAlertAt: iso(now) } : Number.isFinite(lastAlert) ? { lastAlertAt: iso(lastAlert) } : {}),
    ...(downSince ? { downSince } : {}),
  };
  return {
    kind, next, prevStatus, reason,
    ...(downSince ? { downSince, downForMin: Math.max(0, Math.round((now - Date.parse(downSince)) / 60_000)) } : {}),
  };
}

/** How a span of minutes reads in the owner's mail. */
export function spanText(min: number): string {
  if (min < 90) return `${min} min`;
  const h = min / 60;
  return h < 48 ? `about ${Math.round(h)} h` : `about ${Math.round(h / 24)} days`;
}

/** The subject and the opening line of each kind of heartbeat mail. */
export function heartbeatMailWords(d: HeartbeatMailDecision, status: string, failedNames: string[]): { subject: string; lead: string } {
  const set = [...new Set(failedNames)].map((c) => c.replace(/^job_board_/, "")).sort().join(", ").slice(0, 140) || "no failing checks";
  const emoji = status === "down" ? "🔴" : "🟡";
  const since = d.downSince ? ` since ${d.downSince.slice(11, 16)} UTC (${spanText(d.downForMin ?? 0)})` : "";
  switch (d.kind) {
    case "recovered":
      return { subject: "✅ Heartbeat recovered: all checks passing", lead: "Heartbeat recovered" };
    case "eased":
      return { subject: `🟡 Heartbeat no longer down (still ${status.toUpperCase()}: ${set})`, lead: `No longer down; still ${status} on: ${set}` };
    case "down-reminder":
      return { subject: `🔴 Heartbeat DOWN${since}: ${set}`, lead: `Still down${since}` };
    default:
      // The failing set in the subject: one incident threads as one conversation.
      return { subject: `${emoji} Heartbeat ${status.toUpperCase()}: ${set}`, lead: d.downSince ? `Down${since}` : "Free Scan Heartbeat Alert" };
  }
}

/**
 * THE AI PROBE'S VERDICT. It failed on a reply with no text, and its model
 * thinks before it answers: with a 100-token cap the thinking can spend the
 * whole budget and the reply comes back empty (finish_reason length), which
 * read as 'degraded' about a gateway and a model that had both answered. A
 * reply that holds a choice is an answer, whatever its text; one with no
 * choice at all is not.
 */
export function aiProbeCheck(reply: unknown): { passed: boolean; error?: string } {
  const choices = reply && typeof reply === "object" ? (reply as { choices?: unknown }).choices : undefined;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  return first && typeof first === "object"
    ? { passed: true }
    : { passed: false, error: "the AI gateway answered 200 with no choice in the reply" };
}

/**
 * THE OFF-HOUR SCAN (owner decision 2026-11-08: no scan model call on the
 * other five runs of the hour). The heartbeat still posts its résumé to
 * free-keyword-scan, with NO_MODEL_FIELD set and its secret, and the scanner
 * answers the rule-based report without calling a model. That proves the
 * function boots, reads the request and builds a report every ten minutes;
 * the model path itself is proved by the AI probe every run and by the full
 * scan every hour. Judged here: a refusal, an error, a cached or malformed
 * report, or a report that does not say the request was honoured (a scanner
 * that ran its model anyway: an older build, or a secret that differs between
 * the two functions) each fail scan_path.
 */
export const NO_MODEL_FIELD = "heartbeatNoModel";
export const SCAN_PATH_CHECK = "scan_path";
export function noModelScanCheck(
  status: number,
  report: unknown,
  errorText = "",
): { passed: boolean; error?: string; severity?: "down" | "degraded" } {
  if (status === 429) {
    return { passed: false, severity: "degraded", error: "rate-limited: the scan path was not exercised this run (is HEARTBEAT_SECRET set on both functions?)" };
  }
  if (status < 200 || status > 299) return { passed: false, severity: "down", error: `HTTP ${status}: ${clip(errorText, 200)}` };
  const r = report && typeof report === "object" ? (report as Record<string, unknown>) : {};
  if (r.cachedReport === true) return { passed: false, severity: "degraded", error: "served from the 7-day report cache: the scan path was not exercised" };
  const meta = r.reportMeta && typeof r.reportMeta === "object" ? (r.reportMeta as { reportId?: unknown }) : {};
  if (typeof r.atsScoreEstimate !== "number" || !meta.reportId) {
    return { passed: false, severity: "degraded", error: "the rule-based report is missing atsScoreEstimate/reportMeta" };
  }
  if (r[NO_MODEL_FIELD] !== true) {
    return { passed: false, severity: "degraded", error: "free-keyword-scan did not say it skipped its model, so it may have run a full scan off the hour (an older build, or HEARTBEAT_SECRET differs between the two functions)" };
  }
  return { passed: true };
}
