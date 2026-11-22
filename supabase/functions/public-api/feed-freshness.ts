// HOW FRESH THE DATA IS, IN ONE FIELD ON EVERY SEARCH ANSWER
// (lane fix/1121-connector-errors, item 9; the benchmark of 2026-11-11 printed
// "the provider's pages don't say", while the figure existed only in /v1/stats
// and on site pages).
//
// ONE FILE, TWO COPIES. agent-mcp/feed-freshness.ts and
// public-api/feed-freshness.ts are byte-identical (a test holds them so).
//
// WHAT IT MEASURES: minutes since the employer feeds behind live postings were
// last re-read, as the stats rollup computes it (job_board_stats_rollup row
// k = 'freshness', 20260909221000). It is our re-check cadence, never a
// posting's age.
//
// NEVER A FIGURE WITHOUT ITS TIME. The field exists only when the row passes
// the site's own rule (src/lib/home/use-board-freshness.ts parseFreshness):
// boards above 0, p50 a number of 0 or more, p95 not below p50, computed_at a
// date.
//
// ONE READ, REMEMBERED: a single-row primary-key read, kept per isolate for
// five minutes with one shared in-flight read, started beside the board read
// and given until the page is ready plus 250 ms. It never holds an answer.

/** The rollup row as read: its value object and when it was computed. */
export type FreshnessRow = { v: unknown; computed_at?: unknown } | null;

export type FeedFreshness = { p50Minutes: number; p95Minutes: number; asOf: string; basis: string };

export const FEED_FRESHNESS_BASIS =
  "Minutes since the employer feeds behind live postings were last re-read: half within p50Minutes, 95% within p95Minutes, measured at asOf. Our re-check cadence, not a posting's age.";

/** The search answers' field, or null when the row fails the site's rule. */
export function feedFreshnessOf(row: FreshnessRow): FeedFreshness | null {
  if (!row || !row.v || typeof row.v !== "object") return null;
  const v = row.v as Record<string, unknown>;
  const boards = Number(v.boards);
  const p50 = Number(v.p50_min);
  const p95 = Number(v.p95_min);
  const at = typeof row.computed_at === "string" ? row.computed_at : "";
  if (v.boards === null || v.boards === undefined || !Number.isFinite(boards) || boards <= 0) return null;
  if (v.p50_min === null || v.p95_min === null || !Number.isFinite(p50) || !Number.isFinite(p95) || p50 < 0 || p95 < p50) return null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { p50Minutes: p50, p95Minutes: p95, asOf: at, basis: FEED_FRESHNESS_BASIS };
}

/** /v1/stats' feedFreshness, exactly as it has answered it: built here so the two cannot drift. */
export function statsFeedFreshness(row: FreshnessRow): Record<string, unknown> | null {
  const v = (row?.v ?? null) as { boards?: unknown; p50_min?: unknown; p95_min?: unknown; max_min?: unknown } | null;
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return v && typeof v.p95_min === "number"
    ? {
        boards: num(v.boards),
        p50Minutes: num(v.p50_min),
        p95Minutes: num(v.p95_min),
        maxMinutes: num(v.max_min),
        asOf: row?.computed_at ?? null,
        basis: "minutes since each employer feed behind a live posting was last re-verified against the employer's own system. This measures our re-check cadence, NOT how long ago a role was posted.",
      }
    : null;
}

/** How long one isolate keeps the row. */
export const FRESHNESS_TTL_MS = 5 * 60_000;
/** How long past the page an answer waits for a read still in flight. */
export const FRESHNESS_GRACE_MS = 250;

/**
 * The per-isolate memory: `get()` starts (or shares) one read and resolves to
 * the row, or null on any failure; a row read inside FRESHNESS_TTL_MS is
 * answered without a read.
 */
export function freshnessCache(readRow: () => Promise<FreshnessRow>, now: () => number = () => Date.now()) {
  let held: { at: number; row: FreshnessRow } | null = null;
  let inFlight: Promise<FreshnessRow> | null = null;
  return {
    get(): Promise<FreshnessRow> {
      if (held && now() - held.at < FRESHNESS_TTL_MS) return Promise.resolve(held.row);
      if (inFlight) return inFlight;
      inFlight = readRow()
        .then((row) => {
          held = { at: now(), row };
          return row;
        })
        .catch(() => null)
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

/** The field for an answer whose page is ready now: the read's row if it lands within the grace, else null. */
export async function freshnessWithin(p: Promise<FreshnessRow>, graceMs: number = FRESHNESS_GRACE_MS): Promise<FeedFreshness | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), graceMs); });
  try {
    const row = await Promise.race([p.catch(() => null), late]);
    return row ? feedFreshnessOf(row) : null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
