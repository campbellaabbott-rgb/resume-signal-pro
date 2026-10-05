/**
 * WHEN AN IDLE WORKER MAY LEAVE, AND WHEN IT MUST WAIT.
 *
 * THE DEFECT (agents-api review of L9-22, 2026-10-05). The hosted worker is an
 * ephemeral GitHub Actions job: it starts on a wake (or the six-hourly
 * backstop), drains what is claimable and exits a minute after an empty claim.
 * A packet released at :23 is not claimable until its cancel window ends,
 * fifteen minutes later by default — so a worker woken for it found nothing,
 * left, and the packet waited for the next run, hours away. The broker now
 * says, on an empty claim, how many seconds until the first cancel window
 * ends (`nextClaimableInSeconds`, only when that is inside twenty minutes —
 * agent_work_pending's `soon` horizon), and the worker waits for it instead of
 * leaving.
 *
 * Pure, and outside index.ts on purpose: index.ts starts the worker when it is
 * imported, and the test suite must be able to run these.
 */

/**
 * How far ahead a started worker waits for a packet to become claimable. The
 * broker sends a hint only inside agent_work_pending's twenty-minute horizon;
 * a hint past this is not waited for.
 */
export const WAIT_HORIZON_SECONDS = 20 * 60;

/** Slack after the window ends, so the claim lands after the clock, not on it. */
const WAIT_SLACK_MS = 5_000;

/**
 * How long to wait for a packet the broker says becomes claimable soon, in
 * milliseconds — or null for "nothing is coming, leaving is right".
 */
export function waitForNextClaimMs(hintSeconds: unknown, horizonSeconds: number = WAIT_HORIZON_SECONDS): number | null {
  const n = typeof hintSeconds === "number" ? hintSeconds : Number(hintSeconds);
  if (hintSeconds === null || hintSeconds === undefined || hintSeconds === "") return null;
  if (!Number.isFinite(n) || n <= 0 || n > horizonSeconds) return null;
  return Math.ceil(n) * 1000 + WAIT_SLACK_MS;
}

/**
 * May an idle worker stop now? Only when configured to (idleExitMs > 0), only
 * past its idle allowance since the last real work, and never while it is
 * waiting for a packet the broker said is about to open.
 */
export function mayLeaveIdle(nowMs: number, lastWorkAtMs: number, idleExitMs: number, waitUntilMs: number | null): boolean {
  if (!(idleExitMs > 0)) return false;
  if (waitUntilMs !== null && nowMs < waitUntilMs) return false;
  return nowMs - lastWorkAtMs > idleExitMs;
}
