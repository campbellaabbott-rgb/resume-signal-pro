// Rationale: docs/job-board-index-notes.md#n1358-export-interface-rekickinput

export interface RekickInput {
  /** Date.now() of the evaluation. */
  now: number;
  /** slice_stats.workAt — loop end (stampSliceWork). Null when no slice has ever stamped. */
  workAt: string | null | undefined;
  /** slice_stats.at — hop end, after the tail (recordSliceStats). */
  sliceAt?: string | null | undefined;
  /** slice_trace.updated_at — the per-board breadcrumb, the finest pulse a live loop has. */
  traceAt?: string | null | undefined;
  /** refresh_progress.updated_at — hop start (optimistic advance) and hop end. */
  progressAt?: string | null | undefined;
  /** slice_stats.coldEmaMs — the whole-slice cold EMA. Non-finite values read as 0. */
  coldEmaMs: unknown;
  /** chain_kick.outcome — 'continued' | 'kicked' | 'declined' | 'http_error' | 'threw' | 'paused' | null. */
  chainOutcome: unknown;
  /** chain_kick.updated_at — when that outcome was stamped. Needed to tell a finished chain from a superseded stamp. */
  chainAt?: string | null | undefined;
  /** chain_watchdog.updated_at — when this watchdog last kicked. Null if never. */
  watchdogAt: string | null | undefined;
  /** SLICE_LOCK_MS from index.ts, passed in so this module pins no throughput constant of its own. */
  sliceLockMs: number;
}

export type RekickDecision =
  /** Nothing has ever pulsed: nothing to judge, and the cron owns first light. */
  | "no_pulse"
  /** chain_kick.outcome === 'continued' and no pulse has landed since — never fires here, however old the pulse. */
  | "chain_alive"
  /** The freshest pulse is inside 2 x coldEmaMs + sliceLockMs — a slow board or a tail, not a death. */
  | "within_window"
  /** This watchdog kicked less than sliceLockMs ago; the child would decline a second one at its lock. */
  | "throttled"
  /** Past the window, not proven alive, not throttled: kick hop 0. */
  | "rekick";

export type PulseSource = "work" | "slice" | "trace" | "progress";

export interface RekickVerdict {
  decision: RekickDecision;
  /** ms since the freshest pulse, or null when there is none. */
  pulseAgeMs: number | null;
  /** Which row supplied the freshest pulse. */
  pulse: PulseSource | null;
  /** 2 x coldEmaMs + sliceLockMs, the silence that reads as death. */
  thresholdMs: number;
  /** The chain outcome the verdict was judged against. */
  chainOutcome: string | null;
  /** True when a 'continued' stamp was set aside because a pulse landed after it. */
  stampSuperseded: boolean;
}

const parse = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

/**
 * Decide whether the chain is dead enough to re-kick. Pure; the same inputs
 * give the same verdict. `decision === "rekick"` is the ONLY value on which
 * index.ts sends anything.
 */
export function decideRekick(input: RekickInput): RekickVerdict {
  const coldEma = Number(input.coldEmaMs);
  const thresholdMs = 2 * (Number.isFinite(coldEma) && coldEma > 0 ? coldEma : 0) + input.sliceLockMs;
  const chainOutcome = typeof input.chainOutcome === "string" ? input.chainOutcome : null;

  // The freshest pulse wins; an unparseable stamp is no pulse at all.
  let pulseMs = NaN;
  let pulse: PulseSource | null = null;
  const candidates: Array<[PulseSource, unknown]> = [
    ["work", input.workAt], ["slice", input.sliceAt], ["trace", input.traceAt], ["progress", input.progressAt],
  ];
  for (const [src, v] of candidates) {
    const ms = parse(v);
    if (Number.isFinite(ms) && !(pulseMs >= ms)) { pulseMs = ms; pulse = src; }
  }
  if (!Number.isFinite(pulseMs)) {
    return { decision: "no_pulse", pulseAgeMs: null, pulse: null, thresholdMs, chainOutcome, stampSuperseded: false };
  }
  const pulseAgeMs = input.now - pulseMs;

  // 'continued' proves the chain alive only while nothing has pulsed since it
  // was stamped. An unparseable stamp time is read conservatively, as "not
  // superseded": the never-fire holds when the row cannot say.
  let stampSuperseded = false;
  if (chainOutcome === "continued") {
    const chainMs = parse(input.chainAt);
    stampSuperseded = Number.isFinite(chainMs) && pulseMs > chainMs;
    if (!stampSuperseded) return { decision: "chain_alive", pulseAgeMs, pulse, thresholdMs, chainOutcome, stampSuperseded };
  }
  if (pulseAgeMs <= thresholdMs) return { decision: "within_window", pulseAgeMs, pulse, thresholdMs, chainOutcome, stampSuperseded };
  const wdMs = parse(input.watchdogAt);
  if (Number.isFinite(wdMs) && input.now - wdMs < input.sliceLockMs) {
    return { decision: "throttled", pulseAgeMs, pulse, thresholdMs, chainOutcome, stampSuperseded };
  }
  return { decision: "rekick", pulseAgeMs, pulse, thresholdMs, chainOutcome, stampSuperseded };
}
