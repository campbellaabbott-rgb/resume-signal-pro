/**
 * WHAT A SHORTLIST REFUSAL SAYS (S14X-197).
 *
 * supabase-js answers a non-2xx function call with data null and an error
 * whose context is the Response; the page used to read data.error, found
 * nothing, and showed one generic line for a rate limit, a scorer outage, a
 * full account and an expired session alike. This reads the server's own
 * sentence and code from the Response, turns Retry-After (or the body's
 * retryAfterSeconds) into "about N minutes" for a refusal that clears with
 * time, offers no retry where retrying cannot help, and asks for a sign-in on
 * a 401.
 */

export type ShortlistRefusal = { message: string; signIn: boolean };

/** Refusals that clear with time: a rate limit, the limiter or the scorer being down. */
const TIMED = new Set(["rate_limited_function", "rate_limited_global", "rate_limited_network", "rate_limited_session", "limiter_unavailable", "scoring_unavailable"]);
/** Refusals no retry changes. */
const FINAL = new Set(["candidate_cap", "attestation_required", "scoring_not_configured"]);

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

export async function readShortlistRefusal(data: unknown, error: unknown, fallback: string): Promise<ShortlistRefusal> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).status === "number" && typeof (ctx as Response).headers?.get === "function") {
    const res = ctx as Response;
    let body: { error?: unknown; code?: unknown; retryAfterSeconds?: unknown } = {};
    try {
      body = await (typeof res.clone === "function" ? res.clone() : res).json();
    } catch { /* not JSON: the status decides */ }
    const code = typeof body.code === "string" ? body.code : "";
    const said = typeof body.error === "string" && body.error.trim() ? body.error.trim() : "";
    if (res.status === 401) return { message: said || "Your session has ended. Sign in again to evaluate.", signIn: true };
    const header = Number(res.headers.get("retry-after"));
    const seconds = Number.isFinite(header) && header > 0 ? header : typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : NaN;
    let message = said || fallback;
    if (!FINAL.has(code) && (TIMED.has(code) || res.status === 429 || res.status === 503)) {
      message += Number.isFinite(seconds) && seconds > 0 ? ` Try again in about ${minutes(seconds)} minute${minutes(seconds) === 1 ? "" : "s"}.` : " Try again in a few minutes.";
    }
    return { message, signIn: false };
  }
  const said = (data as { error?: unknown } | null)?.error;
  if (typeof said === "string" && said.trim()) return { message: said.trim(), signIn: false };
  if (error) return { message: "Shortlist could not be reached. Check your connection and try again.", signIn: false };
  return { message: fallback, signIn: false };
}
