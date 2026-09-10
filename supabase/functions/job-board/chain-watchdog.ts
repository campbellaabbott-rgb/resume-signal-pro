// The dead-chain watchdog's decision, pure.
//
// The refresh rotation is a self-kicking chain: each slice POSTs the next hop,
// and pg_cron exists only to start a fresh chain when the running one dies.
// Migration 20260909219000 put the two cron kicks five minutes apart; this is
// the other half its header describes — a re-kick from inside the function,
// judged on the chain's OWN pulse rather than on the wall clock.
//
// THE RULE (20260909219000's header, applied): the chain is presumed dead
// when its freshest pulse is older than 2 x coldEmaMs + SLICE_LOCK_MS and the
// chain_kick row does not prove it alive. Then kick hop 0 — a plain,
// non-forced {action:"refresh"}, the body pg_cron sends — and FALL THROUGH:
// the kick never consumes the exclusive maintenance ladder's stamp, mirroring
// the desc-sweep rule at the head of maybeKickMaintenance.
//
// WHAT A PULSE IS, and why there are four. The first cut judged only
// slice_stats.workAt, which stampSliceWork writes at LOOP END. A live hop is
// silent on that row for its whole loop (hot slices measured at 341s against
// a threshold of ~4 min at the live cold EMA) and again for its whole post-
// loop tail, so a live hot slice read as dead. index.ts already stamps more
// often than that, and every stamp is a heartbeat:
//
//   refresh_progress.updated_at  hop START (the optimistic cursor advance)
//                                and hop end
//   slice_trace.updated_at       every board fetched and every board stored
//                                (breadcrumb): inside a live loop the gap is
//                                bounded by one board's FETCH_TIMEOUT_MS
//   slice_stats.workAt           loop end (stampSliceWork)
//   slice_stats.at               hop end, after the tail (recordSliceStats)
//
// The freshest of the four is the pulse. That is what lets the threshold stay
// at the cold EMA in both phases: it no longer has to cover a whole slice,
// only the longest silence a live hop can show, which is one board's fetch
// or the post-loop tail. The pass-end tail is the residual — it stamps a
// coarse breadcrumb per block, so the silence it can show is one block, the
// same exposure the :x4/:x9 crons have always had at the three-minute lock.
//
// WHAT chain_kick CAN AND CANNOT PROVE. chainNextSlice stamps 'kicked' before
// it fetches the child and the real outcome after the child's ENTIRE response
// — and the child returns the moment it has scheduled its own kick. So when
// hop P kicks C, P's 'kicked' is overwritten by P's parent stamping
// 'continued' for P, and the row reads 'continued' while C runs: the stamp is
// one hop behind the chain. A 'continued' that predates a later pulse is
// therefore proof that the chain WAS alive when the pulse's hop started, not
// that it is alive now; only a 'continued' newer than every pulse — the last
// parent saw the last hop return, and nothing has started since — says the
// chain ended by design. That is the rule:
//
//   'continued' AND no pulse after it   -> chain_alive (ended or alive; the
//                                          cron owns the next first light)
//   'continued' AND a pulse after it    -> superseded: judge the pulse
//   anything else                       -> judge the pulse
//
// TWO THINGS IT MUST NEVER DO, and the guard asserts both on this function:
//   1. fire on a 'continued' stamp that nothing has superseded, however old
//      the pulse. That row means the last hop returned to a live parent and
//      no hop has started since — the chain finished, and a kick would only
//      start the next pass a few minutes before the cron does.
//   2. fire within the window of the freshest pulse. The window is
//      2 x coldEmaMs + SLICE_LOCK_MS: two average cold slices of silence past
//      the lock the child enforces. Inside it, a quiet pulse is a slow board
//      or a tail, not a death.
//
// A THIRD, decided in index.ts because it is about the caller: a hop that is
// evaluating this is itself the chain's pulse. maybeKickMaintenance runs
// inside a hop — at pass end AFTER a tail that can outlast the window — and
// a kick from there would start a second chain beside the one doing the
// evaluating. In-hop evaluation observes and logs; it never sends.
//
// WHY THIS IS A MODULE. dormancy.ts and rotation.ts follow the same split —
// pure functions here, DB I/O in index.ts — so the decision can be exercised
// from vitest with every input the runtime could hand it, and the guard can
// prove the never-fires as behaviour rather than as a spelling.
//
// WHERE IT RUNS (the load-bearing part, from the CHAIN lane's design): the
// status action, the one path monitors hit while nothing else runs. Its own
// throttle is SLICE_LOCK_MS on the chain_watchdog stamp, deliberately NOT the
// ten-minute maintenance floor, which would recreate the wait the migration
// removed — and index.ts enforces that throttle with a conditional write, so
// two status calls a few hundred milliseconds apart cannot both kick.

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
