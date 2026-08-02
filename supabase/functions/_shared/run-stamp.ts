/**
 * The apply-agent run stamp: what gets written, and what must NOT be.
 *
 * This is four lines of logic that carry the entire weight of one question —
 * "does the hourly schedule actually fire?" — so it lives somewhere it can be
 * tested rather than inline in a 470-line edge function.
 *
 * THE PROPERTY THAT MATTERS. `lastCronAt` advances ONLY on a genuine cron
 * firing. A hand invocation records itself in `at`/`trigger` and leaves
 * `lastCronAt` exactly as it found it.
 *
 * That asymmetry is the whole design. apply-agent's cron is wrapped in
 * `WHERE EXISTS (... vault.decrypted_secrets WHERE name =
 * 'apply_agent_maintenance_key')`, so with no key it fires NOTHING — silently,
 * and correctly, because a cron collecting a 403 every hour looks healthy until
 * somebody reads the logs. The cost is that "armed" and "never armed" leave
 * identical traces: no packets, no errors, nothing.
 *
 * If a manual run could advance `lastCronAt`, the one field that separates
 * those two states would answer an easier question than the one being asked —
 * "was this function invoked" rather than "does the schedule work" — and would
 * report a healthy schedule on the strength of somebody curling it by hand.
 * That is worse than no field at all, because it would be believed.
 */

export type RunTrigger = "cron" | "manual";

export type RunStamp = {
  at: string;
  trigger: RunTrigger;
  buildVersion: string;
  /** Only ever set by a real cron firing. Carried forward otherwise. */
  lastCronAt: string | null;
  senderOnline: boolean;
  resumesBucket: string;
  mandates: number;
  prepared: number;
  released: number;
  ms: number;
};

export type RunFacts = {
  trigger: RunTrigger;
  now: string;
  buildVersion: string;
  senderOnline: boolean;
  resumesBucket: string;
  mandates: number;
  prepared: number;
  released: number;
  ms: number;
};

/** Read a previous stamp's cron timestamp defensively — the row is untyped JSON. */
export function priorCronAt(prev: unknown): string | null {
  if (!prev || typeof prev !== "object") return null;
  const v = (prev as Record<string, unknown>).lastCronAt;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function nextRunStamp(prev: unknown, facts: RunFacts): RunStamp {
  return {
    at: facts.now,
    trigger: facts.trigger,
    buildVersion: facts.buildVersion,
    // THE ASYMMETRY. Never `facts.now` on a manual run.
    lastCronAt: facts.trigger === "cron" ? facts.now : priorCronAt(prev),
    senderOnline: facts.senderOnline,
    resumesBucket: facts.resumesBucket,
    mandates: facts.mandates,
    prepared: facts.prepared,
    released: facts.released,
    ms: facts.ms,
  };
}

/**
 * Is the SCHEDULE proven to work? Two hours of slack on an hourly job absorbs
 * one missed tick without crying wolf, and is still far short of the gap a
 * genuinely dead cron produces (which is forever).
 */
export const SCHEDULE_PROVEN_WITHIN_MIN = 120;

export function scheduleProven(lastCronAt: string | null, now: number = Date.now()): boolean {
  if (!lastCronAt) return false;
  const t = new Date(lastCronAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < SCHEDULE_PROVEN_WITHIN_MIN * 60_000;
}
