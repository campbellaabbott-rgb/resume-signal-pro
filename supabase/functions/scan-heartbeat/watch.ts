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
