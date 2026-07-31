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
      body: JSON.stringify({ reason: "apply-agent: packets ready, no sender online" }),
      signal: ctrl.signal,
    });
    return { attempted: true, ok: resp.ok, status: resp.status };
  } catch (e) {
    return { attempted: true, ok: false, error: String(e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
