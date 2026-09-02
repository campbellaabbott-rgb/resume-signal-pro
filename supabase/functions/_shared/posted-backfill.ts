export const POSTED_BACKFILL_VERSION = 7;
export const POSTED_BACKFILL_REARM_MS = 7 * 86_400_000;
export const POSTED_BACKFILL_GROWTH_REARM = 5_000;
export const POSTED_BACKFILL_MIN_GAP_MS = 6 * 3_600_000;
export const POSTED_BACKFILL_VENDORS: readonly string[] = ["bamboohr", "rippling", "pinpoint", "greenhouse"];
export interface PostedBackfillState {
  version?: number;
  sweptAt?: string;
  backlogAtSweep?: number;
}
export interface CoverageRow {
  source?: unknown;
  total?: unknown;
  dated?: unknown;
}
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
