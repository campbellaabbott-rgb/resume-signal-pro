// THE LAYOFF-FILING BARS, MIRRORED FOR EVERY SURFACE THAT PRINTS ONE.
//
// A filing is a fact about an employer on one date, read from the source that
// holds it. Every number a surface prints beside one -- the window it may be
// shown in, the worker bar a state notice must state, the two gates the
// Ghost Job Index section adds to its day-30 chain, the cadence the copy
// names, the hours after which "read N minutes ago" becomes "last read at"
// -- is spelled ONCE here and interpolated into copy as a placeholder. The
// same numbers live in SQL and in Deno, where the reader and the writer
// enforce them; a cross-runtime test reads this file, the migrations that
// define the readers and the partition writer, the layoff-filings function
// and agent-mcp by regex and fails on drift (the pricing-truth shape). A
// sentence that types a bar is a sentence that goes false the day the bar
// moves in one runtime and not the other (project_claim_drift, the "no
// subscriptions" incident).
//
// Kept a pure module -- no React, no supabase -- so a data-only bundle can
// read it the way scripts/prerender-seo.mjs reads free-key-limits.ts.
//
// Where each mirror lives:
//   supabase/migrations/*_two_arms_side_by_side_never_a_ratio.sql
//     (refresh_layoff_partition, the k CTE: layoff_lookback_days,
//      layoff_warn_min_workers, min_arm_employers, max_employer_share)
//   supabase/migrations/*_a_row_is_an_answer_and_no_row_is_never_no_filing.sql
//   supabase/migrations/*_the_employer_page_lists_every_filing_in_the_window.sql
//     (both readers: layoff_display_max_age_days, layoff_warn_min_workers)
//   supabase/migrations/*_the_section_renders_its_reason_when_it_cannot_render_its_number.sql
//     (get_layoff_partition: layoff_stale_hours_warn, min_n_at_risk_30,
//      max_half_width_30, min_arm_employers, max_employer_share)
//   supabase/migrations/*_the_cadence_the_copy_names_is_the_schedule_in_this_file.sql
//     (the cron rows whose schedules the cadence words describe)
//   supabase/functions/layoff-filings/index.ts   (the poller's own copy)
//   supabase/functions/agent-mcp/index.ts        (LAYOFF_BARS, the basis sentence)

/** Days before a role's own posted_at in which a filing counts for the
 *  Ghost Index partition. Keys on event_date -- the WARN notice date or the
 *  8-K report date -- never on our read. */
export const LAYOFF_LOOKBACK_DAYS = 90;

/** Days after event_date for which a filing may still print on a card, the
 *  detail panel, the employer page and the MCP row. Older filings are held
 *  for the partition and the rollup and print nowhere. */
export const LAYOFF_DISPLAY_MAX_AGE_DAYS = 90;

/** The single-site bar a state WARN notice must state before it prints
 *  (29 U.S.C. 2101(a)(2)). A notice stating fewer workers, or none, is held
 *  and never shown -- NULL never prints as 0. SEC filings carry no worker
 *  bar; an 8-K names no site. */
export const LAYOFF_WARN_MIN_WORKERS = 50;

/** The filed arm of the Ghost Index partition needs at least this many
 *  distinct employers in its risk set before its sentence prints, so the arm
 *  is never one board wearing a market label. */
export const LAYOFF_MIN_ARM_EMPLOYERS = 10;

/** ...and no single employer may hold more than this share of that arm's
 *  risk set. Printed as a whole percentage. */
export const LAYOFF_MAX_EMPLOYER_SHARE = 0.40;

/** The day-30 gate both arms inherit from the category curve
 *  (migration 20260909217500): roles at risk at the cap, and the cloglog
 *  half-width in share points. Mirrored so the unavailable state can name
 *  the bar it did not clear. */
export const LAYOFF_PARTITION_MIN_N_AT_RISK_30 = 25;
export const LAYOFF_PARTITION_MAX_HALF_WIDTH_30 = 0.15;

/** A state feed whose newest public date sits more than this many days
 *  behind its own rhythm is marked stale in layoff_feed_health. Staleness
 *  hides nothing and enables nothing on screen -- a held filing is still a
 *  fact, and no surface ever prints "no filings". */
export const LAYOFF_FEED_STALE_DAYS = 21;

/** Hours since our last read of each source after which a surface prints
 *  "last read {{readAt}}" in place of a relative age. `warn` is also the bound
 *  the partition reader applies to computed_at before it answers 'stale'. */
export const LAYOFF_STALE_HOURS = { edgar: 6, warn: 48 } as const;

/** The cadence words the copy renders, and the two cron schedules they
 *  describe (the scheduling migration's rows for the EDGAR Atom read and the
 *  state-notice read). The words say nothing faster than the schedules do. */
export const LAYOFF_READ_CADENCE = { edgar: "hourly", warn: "nightly" } as const;
export const LAYOFF_CRON_SCHEDULES = { edgar: "17 * * * *", warn: "40 3 * * *" } as const;

/** What the reader can answer with, and how the client must refuse anything
 *  else. The reader joins through layoff_matches, whose only admitted values
 *  are these two; a row carrying any other value, or flagged ambiguous, is
 *  refused on the client too, so a future column cannot leak a filing the
 *  matcher did not admit. */
export const LAYOFF_MATCHED_VIA = ["exact_multitoken", "alias"] as const;
export const LAYOFF_SOURCES = ["sec_8k_205", "state_warn"] as const;
export const LAYOFF_RELATIONS = ["filer", "subsidiary_site"] as const;

/** The partition reader's reason vocabulary, in the order the section tries
 *  them. 'arithmetic' is the should-never-happen branch (R+X+S off by more
 *  than the writer tolerates); 'stale' is decided by the reader from
 *  computed_at against LAYOFF_STALE_HOURS.warn, and also covers an arm the
 *  writer has not written yet. */
export const LAYOFF_INSUFFICIENT_REASONS = ["n", "width", "arithmetic", "employers", "share", "stale"] as const;
export type LayoffInsufficientReason = (typeof LAYOFF_INSUFFICIENT_REASONS)[number];
