/**
 * THE BOARD'S TWO ROW SHAPES, IN A MODULE ANY COMPONENT MAY IMPORT.
 *
 * BoardJob (one posting as the job-board function serves it) and FillCurve
 * (one row of get_company_fill_curve) were declared inside src/pages/Jobs.tsx,
 * which no component may import (it would be circular, and it would pull the
 * whole board into the importer's chunk). The job card, the detail pane and the
 * company page are built as components of their own, so the shapes moved here
 * unchanged, comments and all; Jobs.tsx imports them back.
 *
 * Types only: nothing here runs.
 */

export interface BoardJob {
  id: string;
  // SEARCH ATTRIBUTION, stamped per row rather than read off the response.
  // "Load more" accumulates jobs while `data` holds only the LATEST page, so a
  // single response-level id would attribute a click on a page-one row to
  // whatever search fetched page three. Carrying it on the row keeps a click
  // tied to the search that actually produced it.
  searchId?: string;
  // 1-based ABSOLUTE rank (offset + index + 1). Position on the page would make
  // page two's first result look like a first-place click.
  rank?: number;
  /**
   * WHICH HIRING SYSTEM THIS POSTING WAS READ FROM — greenhouse | workday | …
   *
   * rowToJob has emitted `source: r.source` on every serving path since the
   * board shipped (the browse SELECT names the column, and search_jobs returns
   * it in its RETURNS TABLE), and no client type declared it. So the trust
   * badge could say "Verified direct from Acme" and never the one thing that
   * makes that checkable — the system Acme publishes on. Rendered through
   * sourceLabel, which returns the vendor's own name or nothing.
   */
  source?: string | null;
  token?: string; // company_token — used to look up the company's open-role count
  company: string;
  title: string;
  location: string;
  remote: boolean;
  department: string | null;
  postedAt: string | null;
  applyUrl: string;
  salary?: string | null;
  /** Definitive employer-stated work mode; null = the posting doesn't say (no tag shown). */
  workMode?: "remote" | "hybrid" | "onsite" | null;
  /**
   * Employer-stated employment type — full_time | part_time | contract |
   * temporary | internship — null when the posting states none.
   *
   * rowToJob has emitted this since the filter shipped, but no client type
   * declared it and no surface rendered it: the board let you FILTER by
   * employment type while never telling you which type any given posting was.
   * Shown under the same rule as workMode above: employer-stated or nothing,
   * never an inferred "Full-time".
   */
  employmentType?: string | null;
  /** The board is a tagged staffing agency (2026-08-31 charter: carried and
   *  DISCLOSED — a badge, never a hidden trait). Absent on ranked-RPC rows
   *  whose shape predates the column; the badge renders only on true. */
  agency?: boolean;
  /** ISO-2 country when the feed or location text states one (serveList sends it). */
  country?: string | null;
  salaryMinAnnual?: number | null;
  salaryMaxAnnual?: number | null;
  salaryPeriod?: string | null;
  salaryCurrency?: string | null;
  experienceBand?: string | null;
  minYears?: number | null;
  /** Board category slug (serveList returns it; drives detail-panel "similar openings"). */
  category?: string | null;
  /** Last re-verification against the company's own feed (serveList last_seen). */
  /** INSERT-time only; semantically first_seen. Never render as freshness. */
  lastSeen?: string | null;
  /** job_board_verifications.verified_at — when this board's feed was last read. */
  recheckedAt?: string | null;
  /** Set once the employer's feed stopped listing this posting. */
  missingSince?: string | null;
  /** >1 when the server folded the same role posted in several locations into
   *  this row. The siblings are real, separately-applyable postings — they are
   *  collapsed for readability, never dropped. */
  /** DISTINCT places this fold covers — no longer the sibling-row count,
   *  which it silently was: 2.4% of served cards claimed locations that do
   *  not exist, the worst a single-location Kyiv role posted 85 times and
   *  captioned "84 more locations". */
  locationCount?: number;
  /** How many requisitions folded into this card. */
  postingCount?: number;
  /** A few of the other locations this role is open in (server-capped). */
  otherLocations?: string[];
  /** Tier-2 ranked search only: ts_headline fragment showing where a description-matched result matched ([[term]] delimiters). */
  snippet?: string;
  /** True on rows the trigram tier APPENDED to a thin exact-match page — the
   *  card labels these "close match"; they are never passed off as exact. */
  closeMatch?: boolean;
  /** Appended by the vector tier on a thin page: about the same thing, not
   *  the same words. A weaker claim than closeMatch, so it is labelled
   *  differently rather than folded in with it. */
  semanticMatch?: boolean;
  /** Which segment this row came from — a title hit, or description-only. */
  matchScope?: "title" | "description";
}

/** One row of get_company_fill_curve. Field names are the RPC's own, so there
 *  is exactly one spelling of each fact between the database and the screen. */
export interface FillCurve {
  company_token: string;
  /** Roles still under observation at day 14 — the risk set n_j at that day,
   *  NOT the sample the rates were estimated over. It excludes every role that
   *  already filled, relisted or was censored before day 14, so it shrinks as
   *  the fill rate rises and can be smaller than fills_le_14. It is a gate
   *  input (the RPC's own `sufficient`), never a number to print beside a rate:
   *  printing it as "measured over N roles" is the closed_90d-next-to-a-null-
   *  median defect written out as a sentence. Print dated_n instead. */
  n_at_risk_14: number;
  /** Roles observed taken down for good (not relisted) by day 14. */
  fills_le_14: number;
  /** R(14), 0..1: the share of this employer's roles that come down within 14 days. */
  fill_rate_14: number;
  fill_rate_14_lo: number;
  fill_rate_14_hi: number;
  /** X(14): the share relisted instead. A FLOOR — the collector logs a relisted
   *  title once a day per company, so the true rate can only be higher. */
  relist_rate_14: number;
  /** S(14): still open at day 14. fill + relist + still-open = 1 at every day. */
  still_open_14: number;
  fill_rate_7: number;
  fill_rate_30: number;
  /** min{t ≤ 30 : R(t) ≥ 0.5} — the median of the FILL cumulative incidence,
   *  and NOT min{t : S(t) ≤ 0.5}. S falls on relists too, so the S-form would
   *  publish a fill median set by re-listings beside a near-zero fill rate;
   *  both migrations depart from the frozen contract on exactly that point
   *  (20260906091000:490, 20260906092000:377) so the column's name is true.
   *
   *  WHICH MEANS THE COPY MUST SAY "FILLED". "Half are off the board by day N"
   *  is a different and weaker claim — it is the sentence for 1 − S(14), the
   *  figure rendered beside this one — and shipping it here published the
   *  S-form reading of a number computed the other way, in nine locales.
   *  20260906091000:138 states the rule: every renderer of this column says
   *  half the roles are FILLED by day N, and any API field mirroring it moves
   *  with it.
   *
   *  NULL whenever the curve never reaches half inside the 30 days we can
   *  observe. Then median_censored is true and the honest rendering is
   *  "more than 30 days", never a number. */
  median_days_to_fill: number | null;
  median_censored: boolean;
  /** Share of this employer's roles that carry a posting date from the company
   *  itself, 0..1. Durations are computed over those and no others; the rest
   *  contribute to counts. Disclosed, never folded into the estimate. */
  dated_coverage: number;
  /** The dated cohort itself: the roles a duration was actually computed from.
   *  This is the sample every rate on this page is stated over. */
  dated_n: number;
  undated_n: number;
  open_roles: number;
  /** Closure EVENTS in the trailing 90 days that were not re-listings. NOT a
   *  count of roles: a posting that closed twice is two of them, and one that
   *  closed and is serving again today is one. Never printed as "roles". */
  fills_90d: number;
  /** Same-title re-listing EVENTS in the trailing 90 days. A FLOOR, for the
   *  reason above; printed only as "re-listed the same title N times". */
  relists_90d: number;
  /** ROLES taken down in the trailing 90 days and not brought back: closed
   *  exactly once, not superseded, not serving again today (20261008110000).
   *  A CEILING -- a re-list under a new id is invisible to us. Null on a row
   *  from a deploy that predates the column. This is the number every
   *  "come off the board and stay off" sentence prints. */
  filled_roles_90d: number | null;
  /** ROLES that came back in the same window: closed more than once, superseded,
   *  or serving again today. A FLOOR. Null on a row that predates the column. */
  relisted_roles_90d: number | null;
  ageouts_90d: number;
  fill_through: number;
  /** Relisting share of all takedowns, 0..1. A FLOOR. */
  churn: number;
  absorption: number;
  /** Days of lifecycle observation behind the counts (capped at 90). */
  tracking_days: number;
  /** The RPC's own answer to "is there enough here to say anything": a risk set
   *  of 25+, 5+ observed fills, and an interval no wider than ±15 points. The
   *  client no longer re-derives this from whatever count it happened to have. */
  sufficient: boolean;
  /** How the board is read (full_read, lap_proven, lap_pending, unprovable),
   *  passed through untouched. The employer page's record goes through
   *  hiringRecordGate, which refuses the fourteen-day share and the median on
   *  a lap_proven board. Absent on a row from an older deploy. */
  observability_bucket?: string | null;
  sufficient_30?: boolean | null;
  insufficient_reason_30?: string | null;
}
