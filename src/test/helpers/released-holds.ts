/**
 * HOLDS THE LEDGER HAS RELEASED, KEPT AS THE FIXTURES THEY WERE.
 *
 * Several ledger tests proved how a hold is read (its conditions, RELEASABLE,
 * "Do NOT apply in this session") on the real docs/deploy-ledger.json, whose
 * only hold was wave 4's 30-day connector search prune. It was released on
 * 2026-11-08, after the upkeep deploy verified with job-board .101 and
 * agent-mcp 2026-11-03.1 serving and verify sections 82 and 86 passing in
 * full: holdUntilVerified is empty, and its job-board condition stays in
 * migrationOrder as an after-rule. Those cases describe the messages of the
 * days it was held, so they read the entry exactly as it stood until then.
 */
export const WAVE4_PRUNE_HOLD = {
  stamp: "20261011103000",
  releaseWhen: ["fn:job-board@2026-09-09.93", "fn:agent-mcp@2026-10-11.3"],
  until: "verify sections 82 and 86 pass with job-board 2026-09-09.93 or later (this deploy's .96) and agent-mcp 2026-10-11.3 or later (this deploy's .38) serving; it schedules the connector's 30-day search prune, which deletes rows for good",
};

/** The policy as it read while the prune was held: the real ledger with that one hold put back. */
export function withWave4PruneHeld<T extends Record<string, unknown>>(policy: T): T & { holdUntilVerified: typeof WAVE4_PRUNE_HOLD[] } {
  return { ...policy, holdUntilVerified: [WAVE4_PRUNE_HOLD] };
}
