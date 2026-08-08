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
 */
export const POSTED_BACKFILL_VERSION = 5;

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
 * PINPOINT IS ABSENT ON EVIDENCE. Its postings.json was inspected on
 * 2026-08-08 and carries no created/published field of any kind, so its 6,110
 * undated rows are honest and no sweep can fix them.
 */
export const POSTED_BACKFILL_VENDORS: readonly string[] = ["bamboohr", "rippling", "greenhouse"];

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
