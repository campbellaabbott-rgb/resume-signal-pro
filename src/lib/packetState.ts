/**
 * What is REALLY going on with this packet — including the two terminal states
 * that render as healthy ones.
 *
 * THE GAP THIS CLOSES, measured 2026-08-02. `agent_claim_submission` stops
 * handing a packet to workers once `attempts >= 3`:
 *
 *     AND c.attempts < 3   -- "a form we cannot drive is a bug to fix, not a
 *                          --  thing to keep hammering at an employer"
 *
 * That cap is right. But nothing anywhere handles the state it creates. No edge
 * function reads `attempts`. ApplyQueuePanel never selected the column. So a
 * packet that has permanently stopped sits at status='ready', released_at set,
 * submitted_at null, release_refusal empty — and the queue renders it as
 * "Ready — nothing needs you", in green, forever.
 *
 * It is the worst version of the failure this codebase keeps producing: not
 * merely silence, but a positive claim that everything is fine about an
 * application that will never be sent.
 *
 * The same is true of `uncertain`. agent_mark_uncertain sets attempts = 99 so
 * the packet can never be retried — correct, because a submit whose outcome is
 * unknown must never be fired again — but that too was invisible.
 */

/**
 * MIRRORS THE SQL. `agent_claim_submission` hard-codes `attempts < 3`, and a
 * cross-runtime constant that drifts is how a UI starts describing a rule the
 * database no longer enforces. Pinned by a test that reads the migration.
 */
export const MAX_ATTEMPTS = 3;

/** agent_mark_uncertain parks a packet here so nothing can ever reclaim it. */
export const UNCERTAIN_ATTEMPTS = 99;

export type PacketPhase =
  | "sent"
  | "uncertain"      // submit pressed, outcome unknown — never retried
  | "exhausted"      // tried MAX_ATTEMPTS times and stopped
  | "in-flight"      // a worker holds the lease right now
  | "held"           // decideRelease refused it (see refusalCopy)
  | "ready"          // released and still eligible
  | "blocked"
  | "preparing";

export type PacketLike = {
  status?: string | null;
  attempts?: number | null;
  submitted_at?: string | null;
  released_at?: string | null;
  claimed_at?: string | null;
  release_refusal?: string | null;
  blockers?: Array<{ kind?: string; detail?: string }> | null;
};

export type PacketVerdict = {
  phase: PacketPhase;
  /** i18n key + English fallback, matching this codebase's t(key, fallback). */
  key: string;
  fallback: string;
  /** Offer a retry? Only where retrying is both possible and honest. */
  canRetry: boolean;
  attempts: number;
};

const V = (phase: PacketPhase, fallback: string, canRetry: boolean, attempts: number): PacketVerdict =>
  ({ phase, key: `packetState.${phase}`, fallback, canRetry, attempts });

export function packetState(p: PacketLike): PacketVerdict {
  const attempts = typeof p.attempts === "number" ? p.attempts : 0;

  // Sent is sent. Nothing below can override it, and nothing may retry it.
  if (p.submitted_at) return V("sent", "Sent.", false, attempts);

  // UNCERTAIN outranks exhausted. Both park the packet, but they mean very
  // different things and only one of them is safe to retry — this one never is,
  // because we may have already applied.
  const uncertain = (p.blockers ?? []).some((b) => b?.kind === "uncertain-submit");
  if (uncertain || attempts >= UNCERTAIN_ATTEMPTS) {
    return V("uncertain",
      "We pressed send but could not confirm it went through. We will not try again — retrying could apply you twice. Check the employer's site, then mark it sent if it arrived.",
      false, attempts);
  }

  // THE INVISIBLE ONE. Terminal, and it used to read as "Ready".
  if (attempts >= MAX_ATTEMPTS && !p.submitted_at) {
    return V("exhausted",
      `Stopped after ${MAX_ATTEMPTS} attempts — this employer's form did not go through, and we will not keep retrying it. Nothing was sent.`,
      true, attempts);
  }

  if (p.status === "submitted") return V("sent", "Sent.", false, attempts);
  if (p.status === "blocked") return V("blocked", "Something here needs you.", false, attempts);
  if (p.status === "preparing") return V("preparing", "Preparing…", false, attempts);

  // Claimed and inside the lease: a worker has it right now.
  if (p.claimed_at) {
    const held = Date.now() - Date.parse(p.claimed_at);
    if (Number.isFinite(held) && held < 10 * 60_000) {
      return V("in-flight", "Being sent right now…", false, attempts);
    }
  }

  // Refused by decideRelease — refusalCopy owns the wording for WHY.
  if (p.release_refusal) return V("held", "Prepared, not sent yet.", false, attempts);

  return V("ready", "Ready — nothing needs you.", false, attempts);
}

/**
 * Is this worth interrupting someone over? Only the two terminal states where
 * an application they expected to go out silently will not.
 */
export function needsAttention(v: PacketVerdict): boolean {
  return v.phase === "exhausted" || v.phase === "uncertain";
}
