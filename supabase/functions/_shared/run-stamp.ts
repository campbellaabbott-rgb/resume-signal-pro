// The apply-agent run stamp: what ... docs/shared-notes.md#s96

export type RunTrigger = "cron" | "manual";

export type RunStamp = {
  at: string;
  trigger: RunTrigger;
  buildVersion: string;
  /** Only ever set by a real cron firing. Carried forward otherwise. */
  lastCronAt: string | null;
  /** Absent on jobs that have no sender — see RunFacts. Never defaulted. */
  senderOnline?: boolean;
  resumesBucket?: string;
  // Whether a wake is configured. ... docs/shared-notes.md#s97
  wakeConfig?: { url: boolean; token: boolean; body: string };
  mandates: number;
  prepared: number;
  released: number;
  ms: number;
};

export type RunFacts = {
  trigger: RunTrigger;
  now: string;
  buildVersion: string;
  // OPTIONAL BECAUSE NOT EVERY STAMPED ... docs/shared-notes.md#s98
  senderOnline?: boolean;
  wakeConfig?: { url: boolean; token: boolean; body: string };
  resumesBucket?: string;
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
    // OMITTED, NOT DEFAULTED. `senderOnline: f ... docs/shared-notes.md#s99
    ...(facts.senderOnline === undefined ? {} : { senderOnline: facts.senderOnline }),
    ...(facts.resumesBucket === undefined ? {} : { resumesBucket: facts.resumesBucket }),
    // SHIPPED BROKEN 2026-08-06, CAUGHT THE ... docs/shared-notes.md#s100
    ...(facts.wakeConfig === undefined ? {} : { wakeConfig: facts.wakeConfig }),
    mandates: facts.mandates,
    prepared: facts.prepared,
    released: facts.released,
    ms: facts.ms,
  };
}

// Is the SCHEDULE proven to ... docs/shared-notes.md#s101
export const SCHEDULE_PROVEN_WITHIN_MIN = 120;

export function scheduleProven(lastCronAt: string | null, now: number = Date.now()): boolean {
  if (!lastCronAt) return false;
  const t = new Date(lastCronAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < SCHEDULE_PROVEN_WITHIN_MIN * 60_000;
}
