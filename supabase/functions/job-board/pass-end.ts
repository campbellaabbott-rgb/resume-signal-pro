/**
 * THE PASS-END TAIL RUNS AS ITS OWN HOPS, ONE RECEIPT PER STEP (S11-001, .93).
 *
 * .92 answered the pass-end hop first and ran the tail in waitUntil. That tail
 * finished on the first pass after the deploy and never recorded a finish on
 * the second (started 2026-10-11 22:06:50Z): background work shares its
 * isolate's wall clock and dies with it, saying nothing, and the one receipt
 * could not say where. Each step is now its own maintenance request
 * ({action:"pass-end", step}) that does its work INSIDE that request, on its
 * own clock, writes its receipt and kicks the next. A step whose request died
 * leaves its receipt open; the hop-end maintenance check re-kicks it.
 *
 * pass_end (status.passEnd, scan-heartbeat job_board_pass_end) keeps
 * {startedAt, doneAt} and adds `steps`, `next` and `nextKickedAt`.
 *
 * Pure, so vitest walks it.
 */

/** In order. "sweep" may run again (PASS_END_SWEEP_HOPS) when its clock stopped it first. */
export const PASS_END_STEPS = ["serve", "kicks", "hygiene", "sweep", "capacity", "names"] as const;
export type PassEndStep = typeof PASS_END_STEPS[number];

/** Freshness-sweep hops a pass may take, each on its own clock and cap. */
export const PASS_END_SWEEP_HOPS = 3;
/** A step neither started nor finished this long after its kick is re-kicked. */
export const PASS_END_STALL_MS = 10 * 60_000;
/** Re-kicks per step per pass. */
export const PASS_END_RETRIES = 2;

export type StepReceipt = {
  startedAt?: string; doneAt?: string; ms?: number; ok?: boolean; detail?: string;
  tries?: number; hops?: number; dropped?: number;
};
export type PassEndRow = {
  startedAt?: string; doneAt?: string; next?: string | null; nextKickedAt?: string;
  steps?: Record<string, StepReceipt>; [k: string]: unknown;
};

export const isPassEndStep = (s: unknown): s is PassEndStep => (PASS_END_STEPS as readonly unknown[]).includes(s);

/** The step after `s`, or "sweep" again while its clock keeps stopping it and hops remain; null after the last. */
export function nextPassEndStep(s: PassEndStep, sweep?: { stop: string; hops: number }): PassEndStep | null {
  if (s === "sweep" && sweep && sweep.stop === "clock" && sweep.hops < PASS_END_SWEEP_HOPS) return "sweep";
  return PASS_END_STEPS[PASS_END_STEPS.indexOf(s) + 1] ?? null;
}

const ms = (iso: unknown) => (typeof iso === "string" ? Date.parse(iso) : NaN);

/** The tail is finished: a doneAt at or after its own start. */
export function passEndDone(v: PassEndRow | null | undefined): boolean {
  const d = ms(v?.doneAt);
  return Number.isFinite(d) && d >= ms(v?.startedAt);
}

/**
 * The step to re-kick, or null. Only the step the row names as next, only once
 * nothing has happened to it for PASS_END_STALL_MS (no start since its kick,
 * or a start with no finish), and only PASS_END_RETRIES times.
 */
export function stalledPassEndStep(v: PassEndRow | null | undefined, now: number): PassEndStep | null {
  if (!v || passEndDone(v) || !isPassEndStep(v.next)) return null;
  const r = v.steps?.[v.next] ?? {};
  if ((r.tries ?? 0) >= PASS_END_RETRIES) return null;
  const started = ms(r.startedAt);
  const kicked = ms(v.nextKickedAt);
  // A start after the kick that also finished is a step whose own next kick is the one to watch.
  if (Number.isFinite(started) && Number.isFinite(ms(r.doneAt)) && ms(r.doneAt) >= started && !(kicked > started)) return null;
  const last = Math.max(Number.isFinite(started) ? started : -Infinity, Number.isFinite(kicked) ? kicked : -Infinity);
  if (!Number.isFinite(last) || now - last < PASS_END_STALL_MS) return null;
  return v.next;
}

/** The row with one step's receipt merged in (and any top-level fields). */
export function withStepReceipt(v: PassEndRow, step: PassEndStep, patch: StepReceipt, top: Record<string, unknown> = {}): PassEndRow {
  return { ...v, ...top, steps: { ...(v.steps ?? {}), [step]: { ...(v.steps?.[step] ?? {}), ...patch } } };
}
