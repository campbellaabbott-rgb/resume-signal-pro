export type RunTrigger = "cron" | "manual";
export type RunStamp = {
  at: string;
  trigger: RunTrigger;
  buildVersion: string;
  lastCronAt: string | null;
  senderOnline?: boolean;
  resumesBucket?: string;
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
  senderOnline?: boolean;
  wakeConfig?: { url: boolean; token: boolean; body: string };
  resumesBucket?: string;
  mandates: number;
  prepared: number;
  released: number;
  ms: number;
};
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
    lastCronAt: facts.trigger === "cron" ? facts.now : priorCronAt(prev),
    ...(facts.senderOnline === undefined ? {} : { senderOnline: facts.senderOnline }),
    ...(facts.resumesBucket === undefined ? {} : { resumesBucket: facts.resumesBucket }),
    ...(facts.wakeConfig === undefined ? {} : { wakeConfig: facts.wakeConfig }),
    mandates: facts.mandates,
    prepared: facts.prepared,
    released: facts.released,
    ms: facts.ms,
  };
}
export const SCHEDULE_PROVEN_WITHIN_MIN = 120;
export function scheduleProven(lastCronAt: string | null, now: number = Date.now()): boolean {
  if (!lastCronAt) return false;
  const t = new Date(lastCronAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t < SCHEDULE_PROVEN_WITHIN_MIN * 60_000;
}
