/**
 * WHEN A PACKET THE WORKER COULD NOT SEND MAY BE TRIED AGAIN.
 *
 * Import-free on purpose: apply-broker (Deno) uses it and the test suite
 * (Node) proves it, and neither runtime can import the other's dependencies.
 *
 * A TRANSIENT REFUSAL (review of the 2026-10-05 agents-api branch). The worker
 * hands a packet back as `ready` when the refusal was about the moment — a
 * driver timeout, a form that did not load — and the claim's three-attempt
 * ceiling bounds the retries. With nothing between the attempts, the packet
 * (the oldest released one) was claimed again after the worker's 20-second
 * gap, and all three attempts were spent inside about a minute: an employer's
 * site down for two minutes ended the packet "blocked". The broker now moves
 * claimable_at forward on such a hand-back: ten minutes after the first
 * attempt, thirty after the second.
 *
 * A HAND-BACK THE BROKER MAKES ITSELF (the owner is unfunded or switched off
 * at the moment of the claim) gives the attempt back and steps the packet
 * aside for HANDBACK_HOLD_MINUTES, so the broker's next claim in the same call
 * reaches the next account's packet instead of the same one again.
 */

/** Minutes a packet waits before its next claim after a transient refusal. */
export function retryBackoffMinutes(attemptsSoFar: number): number {
  const n = Number.isFinite(attemptsSoFar) ? Math.max(0, Math.floor(attemptsSoFar)) : 0;
  return n <= 1 ? 10 : 30;
}

/** How long a packet the broker hands back unworked steps aside. */
export const HANDBACK_HOLD_MINUTES = 10;

/** The claimable_at a transient refusal's hand-back writes, as an ISO string. */
export function retryClaimableAt(attemptsSoFar: number, now: number = Date.now()): string {
  return new Date(now + retryBackoffMinutes(attemptsSoFar) * 60_000).toISOString();
}
