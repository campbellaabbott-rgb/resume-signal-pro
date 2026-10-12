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
 * A WHITELIST, NOT A BLACKLIST (ghost spec Track 1, A1, 2026-10-11). The lap
 * term above refused only lap_proven, so every other bucket passed: on the
 * 1,506-board sample of 2026-10-11, eleven lap_pending boards (Oracle tenants,
 * Driven Brands, Leidos) printed a fourteen-day share they cannot measure,
 * because a board we have not proven we read to the end cannot see most of
 * its takedowns. Now the share, the median and the thirty-day share print only
 * on a board read in full (observability_bucket 'full_read') that has a watch
 * floor (watched_from); lap_proven keeps its reason 'lap' and every other
 * bucket, an absent one and any word this file does not know refuse with
 * 'unproven read'.
 *
 * THE NINETY-DAY COUNTS, IN THIS ORDER (owner decision GD5(a), which
 * supersedes profiles D16(a) for lap boards): the zero-relist control; then
 * every board read in laps (lap_proven, lap_pending, unprovable), because the
 * re-post test there sees only the window of one visit and files re-posts as
 * takedowns, with the same reason 'relist detection unproven' (verify
 * section 91 reads it); then a board we cannot say we read at all ('unproven
 * read'); then THE RELIST TEST THAT READS OTHER SITES: the test asks only
 * whether the same title was live elsewhere on the board, so on a board that
 * lists one title at many locations a real takedown reads as a re-post
 * (Centria Autism: 2,967 "came back" against 43 down, 97% of its postings
 * sharing a title with another location). Where multi_site_title_share is at
 * least 0.20 and the roles that "came back" reach max(10, a quarter of those
 * down), the counts refuse with 'relist test reads other sites', and the
 * "up to" ceiling is read from every takedown (1 - still_open_14), because a
 * fill filed as a re-post is no longer under the fill share. A row without the
 * multi-site column refuses the counts as 'unread': an absent column is our
 * deploy, never a pass.
 *
 * NEGATIVE CLAIMS ARE BASED ON S. The slow-board clause (fewer than half of
 * the roles down inside 30 days) was printed from the fill median being
 * censored, which ignores every takedown the re-post test filed as a relist;
 * the same reply said more than half came down by day 30 on 8 of 118 eligible
 * boards (Databricks still_open_30 0.44). neverHalf now needs a stated
 * thirty-day share whose lower bound is above one half, beside a censored
 * fill median.
 *
 * A SHARE OUTSIDE ITS OWN INTERVAL IS NOT PRINTED. The interval is carried
 * across from S by an approximation, and 7 of 1,319 boards on 2026-10-11
 * published a share outside it; the reissued reader (20261012121000) clamps
 * it, and until it is live the page refuses such a row as 'interval'.
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
/** The one bucket whose takedowns we see as they happen: a board read to its end. */
export const FULL_READ_BUCKET = "full_read";
/** Boards read a window at a time, whose re-post test sees only that window (GD5). */
export const LAP_MODE_BUCKETS: readonly string[] = ["lap_proven", "lap_pending", "unprovable"];
/** multi_site_title_share at or above this: one title is live at many locations on the board. */
export const MULTI_SITE_TITLE_SHARE_MIN = 0.2;
/** And the roles that "came back" must reach at least this many ... */
export const OTHER_SITES_MIN_RELISTED = 10;
/** ... and at least this share of the roles taken down, before the re-post test is called unreliable. */
export const OTHER_SITES_MIN_RELIST_RATIO = 0.25;
/** "Never half": the thirty-day share's lower bound must be above this. */
export const NEVER_HALF_MIN_STILL_OPEN_LO = 0.5;
/** Rounding slack when a share is compared with its own interval (the reader rounds to 4 places). */
export const INTERVAL_SLACK = 0.0001;

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
  /** The last day this board's takedowns were not yet observable; null means no floor. */
  watched_from?: string | null;
  /** Share of live rows whose title is live at another location on the board (20261012121000). */
  multi_site_title_share?: number | string | null;
  fill_rate_14?: number | string | null;
  fill_rate_14_lo?: number | string | null;
  fill_rate_14_hi?: number | string | null;
  still_open_14?: number | string | null;
  still_open_30_lo?: number | string | null;
}

/** The terms the RPC's insufficient_reason_30 can name, in the order it reads them. */
export const DAY_30_REASONS = [
  "unobservable", "lap", "watch", "n", "events", "fills", "relists", "width", "precision", "arithmetic",
] as const;
export type Day30Reason = (typeof DAY_30_REASONS)[number];

export type HiringRecordRefusal =
  | "no row"
  | "lap"
  | "unproven read"
  | "insufficient"
  | "coverage"
  | "tracking"
  | "interval"
  | "relist detection unproven"
  | "relist test reads other sites"
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
  /** The median day, when the fill incidence reached one half inside 30 days. */
  median: GateDecision;
  /** The share still up at day 30. */
  share30: GateDecision;
  /** The bound "fewer than half came down inside 30 days", read from S (every takedown). */
  neverHalf: GateDecision;
  /** The ninety-day counts: roles taken down and not re-listed, and roles that came back. */
  counts90: GateDecision;
  /** The depth floor the ninety-day counts were judged against (21, or 28 on a lap board). */
  countsMinTrackingDays: number;
  /** The re-post test files real takedowns as re-posts on this board; null when the row cannot say. */
  relistTestUnreliable: boolean | null;
  /** The "up to" share within 14 days, as a 0..1 figure, or null when share14 refuses. */
  ceiling14: number | null;
  /** What ceiling14 counts: roles taken down and not re-posted, or every takedown. */
  ceilingBasis: "fills" | "every takedown" | null;
  /** The sentence that explains a refused share14 (HIRING_RECORD_GATE_COPY key), or null. */
  paceCopy: HiringRecordGateCopyKey | null;
  /** The sentence that explains refused ninety-day counts, or null. */
  countsCopy: HiringRecordGateCopyKey | null;
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
 * The re-post test reads other sites on this board: one title is live at
 * many locations (multi_site_title_share at or above 0.20) AND the roles that
 * "came back" reach max(10, a quarter of the roles taken down). Null when the
 * row does not carry the columns: unknown, which every caller refuses on.
 */
export function relistTestUnreliable(row: HiringRecordRow | null | undefined): boolean | null {
  if (!row) return null;
  const share = num(row.multi_site_title_share);
  const filled = num(row.filled_roles_90d);
  const relisted = num(row.relisted_roles_90d);
  if (!Number.isFinite(share) || !Number.isFinite(filled) || !Number.isFinite(relisted)) return null;
  return share >= MULTI_SITE_TITLE_SHARE_MIN
    && relisted >= Math.max(OTHER_SITES_MIN_RELISTED, OTHER_SITES_MIN_RELIST_RATIO * filled);
}

/**
 * THE FEED-READ STAMP SAYS WHAT IT STAMPS (Track 1, A3). A posting's
 * "feed read {{ago}}" is the moment we last read its employer's feed, and a
 * read sees every role only on a board read to its end (full_read). On a
 * board read a window at a time, a board whose read we have not proven, and a
 * posting whose employer record has not answered yet, the stamp is omitted
 * rather than shown as a check of the posting. Where the reply names the
 * newest complete read's state (feed_state), it must be ok or empty.
 */
export function feedReadStatable(row: { observability_bucket?: string | null; feed_state?: string | null } | null | undefined): boolean {
  if (!row || row.observability_bucket !== FULL_READ_BUCKET) return false;
  const st = row.feed_state;
  return st === null || st === undefined || st === "ok" || st === "empty";
}

/**
 * Every figure of the hiring record, judged once. Read in this order for the
 * fourteen-day share: the board's read (the whitelist: lap, then unproven
 * read), then the RPC's sufficiency, the coverage band and the observed
 * depth, which are canStateFillRate's terms in canStateFillRate's order, and
 * last the share against its own interval.
 */
export function hiringRecordGate(row: HiringRecordRow | null | undefined): HiringRecordGate {
  if (!row) {
    return {
      share14: no("no row"), median: no("no row"), share30: no("no row"), neverHalf: no("no row"), counts90: no("no row"),
      countsMinTrackingDays: ROLE_COUNT_MIN_TRACKING_DAYS, relistTestUnreliable: null, ceiling14: null, ceilingBasis: null,
      paceCopy: null, countsCopy: null,
    };
  }
  const bucket = typeof row.observability_bucket === "string" ? row.observability_bucket : null;
  const lap = bucket === LAP_BUCKET;
  const lapMode = bucket !== null && LAP_MODE_BUCKETS.includes(bucket);
  const fullRead = bucket === FULL_READ_BUCKET;
  const watched = typeof row.watched_from === "string" && row.watched_from.trim() !== "";
  // The whitelist: a board read to its end, with a floor that dates when we
  // began to read it so. Everything else is a read we have not proven.
  const readProven = fullRead && watched;
  const tracking = num(row.tracking_days);
  const coverage = num(row.dated_coverage);
  const rate14 = num(row.fill_rate_14);
  const lo14 = num(row.fill_rate_14_lo);
  const hi14 = num(row.fill_rate_14_hi);
  const outsideInterval = Number.isFinite(rate14) && Number.isFinite(lo14) && Number.isFinite(hi14)
    && (rate14 < lo14 - INTERVAL_SLACK || rate14 > hi14 + INTERVAL_SLACK);

  let share14: GateDecision;
  if (lap) share14 = no("lap");
  else if (!readProven) share14 = no("unproven read");
  else if (row.sufficient !== true) share14 = no("insufficient");
  else if (coverageBand(coverage) === "none") share14 = no("coverage");
  else if (!(tracking >= FILL_RATE_MIN_TRACKING_DAYS)) share14 = no("tracking");
  else if (outsideInterval) share14 = no("interval");
  else share14 = OK;

  let median: GateDecision = share14;
  if (share14.ok && row.median_censored !== true && !Number.isFinite(num(row.median_days_to_fill))) median = no("unread");

  let share30: GateDecision;
  if (lap) share30 = no("lap");
  else if (!readProven) share30 = no("unproven read");
  else if (row.sufficient_30 === true) share30 = OK;
  else if (row.sufficient_30 === undefined) share30 = no("unread");
  else {
    const r = row.insufficient_reason_30;
    share30 = no((DAY_30_REASONS as readonly string[]).includes(r ?? "") ? (r as Day30Reason) : "insufficient");
  }

  // THE BOUND IS READ FROM S. Fewer than half down inside 30 days is said
  // only where the thirty-day share is stated and its lower bound is above
  // one half; a censored fill median alone is not evidence of it.
  const so30lo = num(row.still_open_30_lo);
  let neverHalf: GateDecision;
  if (!share14.ok) neverHalf = share14;
  else if (!share30.ok) neverHalf = share30;
  else if (row.median_censored !== true) neverHalf = no("insufficient");
  else if (!Number.isFinite(so30lo)) neverHalf = no("unread");
  else if (!(so30lo > NEVER_HALF_MIN_STILL_OPEN_LO)) neverHalf = no("insufficient");
  else neverHalf = OK;

  const unreliable = relistTestUnreliable(row);
  const countsMinTrackingDays = lap ? ROLE_COUNT_MIN_TRACKING_DAYS_LAP : ROLE_COUNT_MIN_TRACKING_DAYS;
  const filled = num(row.filled_roles_90d);
  const relisted = num(row.relisted_roles_90d);
  let counts90: GateDecision;
  let countsCopy: HiringRecordGateCopyKey | null = null;
  if (!Number.isFinite(filled) || !Number.isFinite(relisted)) { counts90 = no("unread"); countsCopy = "unread"; }
  else if (filled >= RELIST_CONTROL_MIN_ROLES && relisted === 0) { counts90 = no("relist detection unproven"); countsCopy = "relist"; }
  else if (lapMode) { counts90 = no("relist detection unproven"); countsCopy = "relistLap"; }
  else if (!fullRead) { counts90 = no("unproven read"); countsCopy = "unprovenReadCounts"; }
  else if (unreliable === null) { counts90 = no("unread"); countsCopy = "unread"; }
  else if (unreliable) { counts90 = no("relist test reads other sites"); countsCopy = "otherSites"; }
  else if (!(tracking >= countsMinTrackingDays)) { counts90 = no("tracking"); countsCopy = lap ? "countsTrackingLap" : "countsTracking"; }
  else counts90 = OK;

  let paceCopy: HiringRecordGateCopyKey | null = null;
  if (share14.reason === "lap") paceCopy = "lap";
  else if (share14.reason === "unproven read") paceCopy = "unprovenRead";
  else if (share14.reason === "coverage") paceCopy = "coverage";
  else if (share14.reason === "tracking") paceCopy = "paceTracking";
  else if (share14.reason === "interval") paceCopy = "interval";

  // THE "UP TO" CEILING. The fill share is a ceiling only while fills are
  // filed as fills; where the re-post test reads other sites it files them as
  // re-posts, so the ceiling is every takedown (1 - S14). An unknown test
  // reads the same way: the larger figure is the one that stays a ceiling.
  let ceiling14: number | null = null;
  let ceilingBasis: HiringRecordGate["ceilingBasis"] = null;
  if (share14.ok) {
    const s14 = num(row.still_open_14);
    if (unreliable === false && Number.isFinite(rate14)) { ceiling14 = rate14; ceilingBasis = "fills"; }
    else if (Number.isFinite(s14)) { ceiling14 = Math.max(0, Math.min(1, 1 - s14)); ceilingBasis = "every takedown"; }
  }

  return { share14, median, share30, neverHalf, counts90, countsMinTrackingDays, relistTestUnreliable: unreliable, ceiling14, ceilingBasis, paceCopy, countsCopy };
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
  unprovenRead: "We do not state how fast this employer's roles come down. We have not yet proven that we read this board to its end, so a role taken down where we could not see it would read as one still open, and a share or a typical time would come out wrong. This is a limit of how we read the board, not a fact about the employer.",
  unprovenReadCounts: "We do not print how many of this employer's roles came down and stayed down. We have not read this board to its end recently enough to tell which roles came down. This is a limit of how we read the board, not a fact about the employer.",
  relistLap: "We do not print how many of this employer's roles came down and stayed down. We read this board a part at a time, and our re-post test sees only the part read on one visit, so a role that came back elsewhere on the board can read as one that stayed down. This is a gap in our record, not a fact about the employer.",
  otherSites: "We do not print how many of this employer's roles came down and stayed down. On this board one job title is listed at many locations at once, and our re-post test cannot yet tell a new location from a re-post. This is a gap in our record, not a fact about the employer.",
  interval: "We do not state how fast this employer's roles come down: the share we computed fell outside its own error range, so our arithmetic needs fixing before it can be printed. This is a fault on our side, not a fact about the employer.",
  unread: "We do not print this employer's closure record right now: the reader that supplies it answered without a figure the page needs to check it. This is a gap on our side, not a fact about the employer.",
} as const;
export type HiringRecordGateCopyKey = keyof typeof HIRING_RECORD_GATE_COPY;

/** {{name}} placeholders filled from vars; an unknown placeholder is left as written. */
export function fillGateCopy(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
