/**
 * When the posted-date sweep should run, and how far behind it is.
 *
 * Lives in _shared rather than inside job-board/index.ts so the decision can be
 * tested directly. index.ts is a Deno bundle full of Deno globals; a test that
 * cannot import the real function ends up asserting against a COPY of the
 * logic, which passes forever while the deployed rule drifts. That is the exact
 * failure class this sweep already suffered — a version check that read as
 * "done" for weeks while 52,678 postings sat undated.
 *
 * Pure: no IO, no Deno, no clock of its own (`now` is a parameter).
 */

/**
 * Bumping this is the only way to force a full re-date of every row.
 *
 * v5 (2026-07-28): v4's guards stopped the replay bug recurring but could not
 * free the rows it had already stranded. The broken v4 chain walked to
 * completion and wrote {version: 4}, and the maintenance kick fires only on
 * `version !== POSTED_BACKFILL_VERSION` — so 4 === 4 meant the sweep was
 * permanently, silently "done" with bamboohr 43,687/43,687 and rippling
 * 8,991/8,991 undated.
 *
 * v6 (2026-08-08): NOT a bug fix — a deliberate re-arm, and the only mechanism
 * that can do it. The growth rule below measures against `backlogAtSweep`, and
 * the last completed sweep (08-05) predates that field, so it recorded no
 * floor: the rule was inert on arrival and the 45,466 undated rows measured
 * after deploy would have waited for the seven-day timer regardless. Bumping
 * the version runs the sweep now, dates them, and — because completion records
 * the floor — is what actually switches the growth rule on.
 *
 * v7 (2026-08-17): re-arm AND un-poison. The v6 sweep never ran a single
 * productive hop — its draw timed out on an unseeded cursor, the timeout was
 * read as "phase exhausted", and the terminal phase then wrote an
 * unconditional completion stamp recording backlogAtSweep 43,118. That number
 * is documented as the IRREDUCIBLE RESIDUE (rows proven undatable) but was in
 * fact 43,118 rows nothing had touched, and it became the floor the +5,000
 * growth rule measures against — a ratchet that made each re-arm harder than
 * the last. Bumping the version is the only mechanism that discards it.
 *
 * Ships WITH the three fixes that make the sweep actually work (cursor seeded
 * to the phase prefix, draw failures barred from stamping completion, and the
 * partial index on (source, id) WHERE posted_at IS NULL). Bumping without them
 * would just re-run the vacuous sweep and write a higher poisoned floor.
 */
export const POSTED_BACKFILL_VERSION = 7;

/**
 * The completion stamp EXPIRES. Without this the sweep is strictly one-shot: it
 * stamps {version} when the last phase drains and can never run again, while
 * BambooHR and Rippling keep ingesting undated postings every day, forever.
 *
 * A missing or unparseable sweptAt reads as DUE — the conservative direction
 * (one cheap extra sweep), and self-correcting, because completing writes a
 * fresh stamp.
 */
export const POSTED_BACKFILL_REARM_MS = 7 * 86_400_000;

/**
 * THE SEVEN-DAY TIMER ASSUMED A STEADY TRICKLE. The sweep's own note says so:
 * "after the first pass the population is one week's inflow, not 43,687 rows".
 * True while the catalog grew by hundreds of boards a week.
 *
 * Measured 2026-08-08, three days after a sweep that worked (41,113 rows dated
 * at 99.2%): bamboohr 34,211 undated of 44,684 (23% dated) and rippling 10,121
 * of 12,496 (19%). Nothing had broken. 2,395 boards were merged into the
 * catalog in one day and every posting they bootstrapped arrived undated, so
 * 44,882 postings were queued to wait a further four days for a date they
 * could have had in hours.
 *
 * So intake arms the sweep as well as the clock.
 */
export const POSTED_BACKFILL_GROWTH_REARM = 5_000;

/** Floor between growth-driven runs, so a heavy intake day cannot chain sweeps. */
export const POSTED_BACKFILL_MIN_GAP_MS = 6 * 3_600_000;

/**
 * The vendors this sweep can actually date — the phase chain and nothing else:
 * bamboohr → rippling → greenhouse (greenhouse is terminal).
 *
 * WORKDAY IS DELIBERATELY ABSENT even though it holds the largest undated
 * population (43,990 on 2026-08-08). Its phase was retired at version 5;
 * Workday rows are dated at ingest from the list's relative age, so what
 * remains undated is rows this sweep has no phase for. Counting them would put
 * a fixed ~44k floor into the growth measure and let a vendor the sweep cannot
 * help decide when it runs — spending BambooHR and Rippling detail requests
 * because Workday moved.
 *
 * PINPOINT WAS ABSENT ON EVIDENCE THAT INSPECTED ONE ENDPOINT, and the
 * conclusion drawn from it was wrong. The 2026-08-08 note read: "its
 * postings.json was inspected and carries no created/published field of any
 * kind, so its 6,110 undated rows are honest and no sweep can fix them."
 * The first half is true — postings.json genuinely has no date. The second
 * half does not follow: Pinpoint publishes an employer-stated `datePosted` in
 * the schema.org JSON-LD on every posting PAGE, and the list payload already
 * hands us that page's URL in `item.url`. So "no sweep can fix them" described
 * the endpoint we happened to look at, not the vendor.
 *
 * The cost of that inference: pinpoint sat at exactly 0% dated — 9,805 rows by
 * 2026-08-17, every one served with no stated age — BY CONSTRUCTION rather than
 * by backlog. A vendor at exactly 0.0% is never a backlog; a backlog produces a
 * partial percentage. That is the tell worth remembering.
 */
export const POSTED_BACKFILL_VENDORS: readonly string[] = ["bamboohr", "rippling", "pinpoint", "greenhouse"];

export interface PostedBackfillState {
  version?: number;
  sweptAt?: string;
  /** Undated rows left on POSTED_BACKFILL_VENDORS when the last sweep finished. */
  backlogAtSweep?: number;
}

/** One row of the precomputed date_coverage rollup. */
export interface CoverageRow {
  source?: unknown;
  total?: unknown;
  dated?: unknown;
}

/**
 * Undated rows on the backfillable vendors, from the precomputed rollup.
 *
 * NOT counted live anywhere: `count(*) WHERE posted_at IS NULL` over ~598k rows
 * is the shape behind two separate 57014 outages on this table, and the rollup
 * already holds these numbers on a cron.
 *
 * Returns null when nothing matched, and null means UNKNOWN. A zero would read
 * as "no backlog" and silently disable the re-arm this exists to provide.
 */
export function backlogFromCoverage(rows: unknown): number | null {
  if (!Array.isArray(rows)) return null;
  let undated = 0;
  let matched = 0;
  for (const raw of rows as CoverageRow[]) {
    if (!raw || typeof raw !== "object") continue;
    if (!POSTED_BACKFILL_VENDORS.includes(String(raw.source ?? ""))) continue;
    const total = Number(raw.total);
    const dated = Number(raw.dated);
    if (!Number.isFinite(total) || !Number.isFinite(dated)) continue;
    matched++;
    undated += Math.max(0, total - dated);
  }
  return matched > 0 ? undated : null;
}

/**
 * Should the sweep run now?
 *
 * `backlog` is the CURRENT undated count on the backfillable vendors, or null
 * when unknown. Growth is measured against `backlogAtSweep` — the residue the
 * last completed sweep left behind — never against the absolute number.
 *
 * WHY THE FLOOR MATTERS. Rows that carry no vendor date, or that the feed no
 * longer lists, stay NULL forever; the backlog never reaches zero. Re-arming on
 * absolute size would run this sweep continuously against rows it has already
 * proven it cannot date, spending vendor requests to achieve nothing. With no
 * recorded floor the growth rule is inert and the seven-day timer governs
 * alone, exactly as before it existed.
 */
export function postedBackfillDue(
  v: PostedBackfillState,
  backlog?: number | null,
  now: number = Date.now(),
): boolean {
  if (v.version !== POSTED_BACKFILL_VERSION) return true;
  const swept = v.sweptAt ? Date.parse(v.sweptAt) : NaN;
  if (!Number.isFinite(swept)) return true;
  const since = now - swept;
  if (since > POSTED_BACKFILL_REARM_MS) return true;
  return (
    typeof backlog === "number" &&
    Number.isFinite(backlog) &&
    typeof v.backlogAtSweep === "number" &&
    Number.isFinite(v.backlogAtSweep) &&
    since > POSTED_BACKFILL_MIN_GAP_MS &&
    backlog - v.backlogAtSweep >= POSTED_BACKFILL_GROWTH_REARM
  );
}
