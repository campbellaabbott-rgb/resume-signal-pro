/**
 * Ask whatever hosts the apply worker to start one.
 *
 * HOST-AGNOSTIC ON PURPOSE. This POSTs to whatever URL is in the
 * `WORKER_START_URL` secret and does not care what is on the other end — a Fly
 * Machines start call, a GitHub Actions workflow_dispatch, a Cloud Run job, a
 * webhook on a home machine. Picking the host is a decision that has not been
 * made, and hard-coding one provider here would make that decision by accident.
 *
 * WITH THE SECRET UNSET THIS IS A NO-OP, which is the state today: no worker
 * exists, so there is nothing to wake, and every caller carries on unaffected.
 *
 * FAILURE IS ALWAYS SILENT TO THE CALLER. Waking a sender is an optimisation on
 * top of a system that already works without it — packets sit as `ready` and
 * drain whenever a worker next appears. A wake that throws must never fail the
 * release path that called it, because then a broken webhook would stop
 * applications being PREPARED, which is strictly worse than them being prepared
 * and waiting.
 */
const TIMEOUT_MS = 4_000;

/**
 * What to POST. `WORKER_START_BODY` verbatim when set, otherwise a readable
 * reason for hosts that do not care.
 *
 * Invalid JSON in the secret falls back to the default rather than throwing:
 * a typo in a wake payload must not take down the path that PREPARES
 * applications, which would turn a cosmetic misconfiguration into customers
 * getting nothing at all.
 */
function bodyFor(): string {
  const raw = (Deno.env.get("WORKER_START_BODY") ?? "").trim();
  if (raw) {
    try { JSON.parse(raw); return raw; } catch { /* fall through to default */ }
  }
  return JSON.stringify({ reason: "apply-agent: packets ready, no sender online" });
}

export type WakeResult =
  | { attempted: false; reason: "no-url" | "not-needed" }
  | { attempted: true; ok: boolean; status?: number; error?: string };

/**
 * @param needed  Whether there is actually paid work waiting. Passing false is
 *                not an error — it records that we deliberately did not wake,
 *                which is what makes "0 sent" readable later.
 */
export async function wakeSender(needed: boolean): Promise<WakeResult> {
  if (!needed) return { attempted: false, reason: "not-needed" };

  const url = (Deno.env.get("WORKER_START_URL") ?? "").trim();
  if (!url) return { attempted: false, reason: "no-url" };

  const token = (Deno.env.get("WORKER_START_TOKEN") ?? "").trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Most start APIs (Fly, GitHub) authenticate with a bearer token. Sent
        // only when one is configured, so a plain unauthenticated webhook works
        // too without receiving a stray Authorization header.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // The body the HOST needs, not the body we would like to send.
      //
      // GitHub's workflow_dispatch endpoint REQUIRES a `ref` and rejects
      // anything without one with 422 — so the human-readable reason below,
      // which is the useful default for a plain webhook, silently fails against
      // the host we actually use. Configurable rather than special-cased,
      // because hard-coding GitHub's shape here would undo the point of this
      // module being host-agnostic.
      body: bodyFor(),
      signal: ctrl.signal,
    });
    return { attempted: true, ok: resp.ok, status: resp.status };
  } catch (e) {
    return { attempted: true, ok: false, error: String(e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IS THE WAKE EVEN CONFIGURED — answerable without there being work to wake for.
 *
 * `wakeSender` short-circuits on `needed === false` and never reads
 * WORKER_START_URL, so with an empty queue the whole configuration is
 * unobservable. That is precisely backwards: the only moment it reports
 * "no-url" is the moment a paying customer's packets are already sitting
 * unsent, which is the silent-gate shape this codebase keeps having to fix.
 *
 * The distinction matters because the wake is what makes sending feel instant.
 * Without it the Actions cron is the only path, and that is a ~6 hour worst
 * case whenever the other host is asleep.
 *
 * BOOLEANS AND A SHAPE, NEVER THE VALUES. A URL would name the host and a token
 * is a credential; neither belongs in a response the board serves to anyone.
 * `body` is reported because of a documented trap rather than for completeness:
 * GitHub's dispatch endpoint rejects a payload without `ref` with a 422, and
 * wake-sender's default body is a human-readable reason GitHub will not accept.
 * So a GitHub host with `body: "default"` is misconfigured in a way that only
 * shows up as a failed wake.
 */
export type WakeConfig = {
  url: boolean;
  token: boolean;
  /** `default` = no secret set, `json` = valid JSON supplied, `invalid` = set but unparseable. */
  body: "default" | "json" | "invalid";
};

export function wakeConfig(): WakeConfig {
  const raw = (Deno.env.get("WORKER_START_BODY") ?? "").trim();
  let body: WakeConfig["body"] = "default";
  if (raw) {
    try { JSON.parse(raw); body = "json"; } catch { body = "invalid"; }
  }
  return {
    url: (Deno.env.get("WORKER_START_URL") ?? "").trim() !== "",
    token: (Deno.env.get("WORKER_START_TOKEN") ?? "").trim() !== "",
    body,
  };
}
