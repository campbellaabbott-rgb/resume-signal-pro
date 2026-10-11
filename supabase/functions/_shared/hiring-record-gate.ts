/**
 * THE HIRING-RECORD GATE: what a surface may say from one row of
 * get_company_fill_curve, and, when it may not, the reason in plain words.
 *
 * ONE MODULE, TWO RUNTIMES. This file is byte-identical in
 * src/lib/hiring-record-gate.ts (the page) and
 * supabase/functions/_shared/hiring-record-gate.ts (the edge functions that
 * will print the same record: the profile bake, MCP and /v1). A test holds
 * the two copies equal, so a rule moved in one runtime alone fails it. It
 * imports nothing, so it runs unchanged under Vite and under Deno.
 *
 * WHAT IT ADDS TO canStateFillRate. canStateFillRate (copied here unchanged,
 * and held equal to the page's own by a parity test) asks three things of a
 * fourteen-day share: the RPC's `sufficient`, enough employer-stated posting
 * dates, and at least 21 days of watching. Two things it never asked:
 *
 *   1. HOW THE BOARD IS READ. On a lap_proven board (one we confirm only by
 *      re-reading the whole board) a takedown is certified one to three laps
 *      late. The RPC already refuses the thirty-day share on those boards for
 *      exactly that reason (insufficient_reason_30 = 'lap'); the same lag
 *      biases the fourteen-day share and the median, and nothing refused them.
 *      Live 2026-10-11: dominos, lap_proven, 10 tracking days, sufficient,
 *      0.53% within 14 days. So the share and the median are refused on a
 *      lap_proven board with reason 'lap', until a lap-latency term exists.
 *
 *   2. WHETHER RELIST DETECTION WORKS ON THE BOARD. The ninety-day counts are
 *      roles taken down and not brought back (a ceiling) against roles that
 *      came back (a floor). Six large SmartRecruiters boards report hundreds to
 *      thousands taken down and not one back (Eurofins 1,293 over 87 days;
 *      the median ratio on that vendor's other big boards is 0.567). Zero
 *      against hundreds is our detector failing, not an employer whose roles
 *      never return, so the counts are refused when filled_roles_90d is at
 *      least RELIST_CONTROL_MIN_ROLES and relisted_roles_90d is zero, with
 *      reason 'relist detection unproven'.
 *
 * And the ninety-day counts get a depth floor of their own: 21 days of
 * watching, 28 on a lap_proven board, because a role taken down more recently
 * than that may still come back. The thirty-day share stays exactly where the
 * RPC put it: behind sufficient_30, which carries its own positive control.
 *
 * NONE OF THIS DECIDES A VERDICT. It decides which numbers may be printed. A
 * surface that refuses a number prints the reason; an unknown is never shown
 * as a no.
 */

/** Days of watching before a fourteen-day share may be stated (the page's floor). */
export const FILL_RATE_MIN_TRACKING_DAYS = 21;
/** dated_coverage at or above this: the share is said plainly. */
export const FILL_COVERAGE_PLAIN = 0.6;
/** dated_coverage below this: no duration claim at all. */
export const FILL_COVERAGE_MIN = 0.3;
/** Days of watching before the ninety-day role counts may be printed. */
export const ROLE_COUNT_MIN_TRACKING_DAYS = 21;
/** The same floor on a lap_proven board, where a takedown is certified late. */
export const ROLE_COUNT_MIN_TRACKING_DAYS_LAP = 28;
/** Roles taken down, with none back, at which zero re-listings stops being believable. */
export const RELIST_CONTROL_MIN_ROLES = 200;
/** The window the ninety-day counts cover (get_company_fill_curve's interval). */
export const ROLE_COUNT_WINDOW_DAYS = 90;
/** The observability bucket of a board confirmed only by re-reading it in full. */
export const LAP_BUCKET = "lap_proven";

export type CoverageBand = "plain" | "qualified" | "none";

/** How the share may be said, from the share of roles carrying the company's own date. */
export function coverageBand(dated: number | null | undefined): CoverageBand {
  const v = typeof dated === "number" && Number.isFinite(dated) ? dated : 0;
  if (v >= FILL_COVERAGE_PLAIN) return "plain";
  if (v >= FILL_COVERAGE_MIN) return "qualified";
  return "none";
}

/** The two columns canStateFillRate reads. */
export interface FillRateGateInput {
  sufficient?: boolean | null;
  dated_coverage?: number | null;
}

/**
 * The page's predicate, unchanged: the RPC's own sufficiency, enough
 * employer-dated roles, and an observed depth the caller must hand over.
 * An unknown depth is a refusal, not a pass.
 */
export function canStateFillRate(
  c: FillRateGateInput | null | undefined,
  observedDays: number | null | undefined,
): boolean {
  if (!c || !c.sufficient) return false;
  if (coverageBand(c.dated_coverage) === "none") return false;
  return typeof observedDays === "number" && Number.isFinite(observedDays)
    && observedDays >= FILL_RATE_MIN_TRACKING_DAYS;
}

/** One row of get_company_fill_curve, as any surface receives it (numbers may arrive as strings). */
export interface HiringRecordRow {
  sufficient?: boolean | null;
  dated_coverage?: number | string | null;
  tracking_days?: number | string | null;
  observability_bucket?: string | null;
  median_censored?: boolean | null;
  median_days_to_fill?: number | string | null;
  filled_roles_90d?: number | string | null;
  relisted_roles_90d?: number | string | null;
  sufficient_30?: boolean | null;
  insufficient_reason_30?: string | null;
}

/** The terms the RPC's insufficient_reason_30 can name, in the order it reads them. */
export const DAY_30_REASONS = [
  "unobservable", "lap", "watch", "n", "events", "fills", "relists", "width", "precision", "arithmetic",
] as const;
export type Day30Reason = (typeof DAY_30_REASONS)[number];

export type HiringRecordRefusal =
  | "no row"
  | "lap"
  | "insufficient"
  | "coverage"
  | "tracking"
  | "relist detection unproven"
  | "unread"
  | Day30Reason;

/** One figure's verdict: printable (reason null), or refused with the term that refused it. */
export interface GateDecision {
  ok: boolean;
  reason: HiringRecordRefusal | null;
}

export interface HiringRecordGate {
  /** The share of roles down within 14 days, with its interval. */
  share14: GateDecision;
  /** The median (a day number, or the bound "not half inside 30 days"). */
  median: GateDecision;
  /** The share still up at day 30. */
  share30: GateDecision;
  /** The ninety-day counts: roles taken down and not re-listed, and roles that came back. */
  counts90: GateDecision;
  /** The depth floor the ninety-day counts were judged against (21, or 28 on a lap board). */
  countsMinTrackingDays: number;
}

const OK: GateDecision = { ok: true, reason: null };
const no = (reason: HiringRecordRefusal): GateDecision => ({ ok: false, reason });

/** A number, or NaN: an absent column never reads as zero. */
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
};

/**
 * Every figure of the hiring record, judged once. Read in this order for the
 * fourteen-day share: the board's read (lap), then the RPC's sufficiency, the
 * coverage band and the observed depth, which are canStateFillRate's terms in
 * canStateFillRate's order.
 */
export function hiringRecordGate(row: HiringRecordRow | null | undefined): HiringRecordGate {
  if (!row) {
    return { share14: no("no row"), median: no("no row"), share30: no("no row"), counts90: no("no row"), countsMinTrackingDays: ROLE_COUNT_MIN_TRACKING_DAYS };
  }
  const lap = row.observability_bucket === LAP_BUCKET;
  const tracking = num(row.tracking_days);
  const coverage = num(row.dated_coverage);

  let share14: GateDecision;
  if (lap) share14 = no("lap");
  else if (row.sufficient !== true) share14 = no("insufficient");
  else if (coverageBand(coverage) === "none") share14 = no("coverage");
  else if (!(tracking >= FILL_RATE_MIN_TRACKING_DAYS)) share14 = no("tracking");
  else share14 = OK;

  let median: GateDecision = share14;
  if (share14.ok && row.median_censored !== true && !Number.isFinite(num(row.median_days_to_fill))) median = no("unread");

  let share30: GateDecision;
  if (lap) share30 = no("lap");
  else if (row.sufficient_30 === true) share30 = OK;
  else if (row.sufficient_30 === undefined) share30 = no("unread");
  else {
    const r = row.insufficient_reason_30;
    share30 = no((DAY_30_REASONS as readonly string[]).includes(r ?? "") ? (r as Day30Reason) : "insufficient");
  }

  const countsMinTrackingDays = lap ? ROLE_COUNT_MIN_TRACKING_DAYS_LAP : ROLE_COUNT_MIN_TRACKING_DAYS;
  const filled = num(row.filled_roles_90d);
  const relisted = num(row.relisted_roles_90d);
  let counts90: GateDecision;
  if (!Number.isFinite(filled) || !Number.isFinite(relisted)) counts90 = no("unread");
  else if (filled >= RELIST_CONTROL_MIN_ROLES && relisted === 0) counts90 = no("relist detection unproven");
  else if (!(tracking >= countsMinTrackingDays)) counts90 = no("tracking");
  else counts90 = OK;

  return { share14, median, share30, counts90, countsMinTrackingDays };
}

/**
 * THE REFUSALS IN PLAIN WORDS, for every surface that has no translation
 * layer (the bake, MCP, /v1). The page renders the same sentences through
 * jobsPage.hhGate.<key>; a test holds the English locale equal to these.
 * Placeholders are {{name}} and are filled by fillGateCopy.
 */
export const HIRING_RECORD_GATE_COPY = {
  lap: "We do not state how fast this employer's roles come down. We confirm a takedown on this board only by re-reading the whole board, which can confirm it one to three reads late, so a share within 14 days and a typical time would both come out wrong. This is a limit of how we read the board, not a fact about the employer.",
  coverage: "We do not state how fast this employer's roles come down: only {{pct}}% of its roles carry a posting date from the company itself, too few to measure from.",
  paceTracking: "We have watched this board for {{d}} days. A share of roles down within 14 days needs at least {{min}} days of watching, so we do not state one yet.",
  countsTracking: "We have watched this board for {{d}} days. We count roles taken down and not re-listed only after {{min}} days of watching, because a role taken down more recently may still come back.",
  countsTrackingLap: "We have watched this board for {{d}} days. We count roles taken down and not re-listed only after {{min}} days of watching here: on this board a takedown is confirmed only by re-reading the whole board, and a role taken down more recently may still come back.",
  relist: "We do not print how many of this employer's roles came down and stayed down. We logged {{n}} roles taken down on this board over {{d}} days of watching and not one that came back, which on a board this size means our re-list detection is not working here, not that nothing was re-listed. This is a gap in our record, not a fact about the employer.",
  withheldBadge: "Closure record withheld",
} as const;
export type HiringRecordGateCopyKey = keyof typeof HIRING_RECORD_GATE_COPY;

/** {{name}} placeholders filled from vars; an unknown placeholder is left as written. */
export function fillGateCopy(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
