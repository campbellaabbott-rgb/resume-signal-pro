import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * How recently the board's job boards were read, from get_freshness_stats:
 * the cached rollup of job_board_verifications over every board with a row on
 * the board. p50/p95 are minutes since each board's newest read, computed at
 * computed_at. A board read in parts counts its newest partial read, which is
 * why the rail says so beside the figure (review P3).
 *
 * Absent, malformed or zero-board answers are no answer: the rail prints no
 * figure rather than a figure without a date.
 */
export interface BoardFreshness {
  boards: number;
  p50Min: number;
  p95Min: number;
  computedAt: string;
}

export function parseFreshness(data: unknown): BoardFreshness | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const boards = Number(r.boards);
  const p50 = Number(r.p50_min);
  const p95 = Number(r.p95_min);
  const at = typeof r.computed_at === "string" ? r.computed_at : "";
  if (!Number.isFinite(boards) || boards <= 0) return null;
  if (!Number.isFinite(p50) || !Number.isFinite(p95) || p50 < 0 || p95 < p50) return null;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return { boards: Math.round(boards), p50Min: p50, p95Min: p95, computedAt: at };
}

/**
 * ONE READ FOR A VISIT THAT GOES FROM / TO /jobs (cost audit 2026-11-08,
 * dedupe-cached-row-reads). The homepage rail and the board's activity strip
 * both print get_freshness_stats, a rollup cached server-side; the board used
 * to ask again the moment the visitor clicked through. The homepage's answer
 * is kept here, as the RPC returned it, and the board uses it while it is
 * younger than FRESHNESS_HANDOFF_MS; older, absent or failed, the board asks
 * itself, exactly as before. The homepage always asks: only the board reads
 * what is kept.
 */
export const FRESHNESS_HANDOFF_MS = 60_000;
let handedOff: { at: number; data: unknown } | null = null;

/** The kept answer's data when it is young enough, else undefined (never a failed answer). */
export function keptFreshnessData(now = Date.now()): unknown {
  return handedOff && now - handedOff.at >= 0 && now - handedOff.at < FRESHNESS_HANDOFF_MS ? handedOff.data : undefined;
}

/** For tests that mount the homepage more than once. */
export function forgetKeptFreshness(): void {
  handedOff = null;
}

/**
 * The board strip's read: the homepage's answer when it is young enough,
 * otherwise get_freshness_stats asked now. Resolves to the RPC's data, or
 * null when the call failed (the strip then prints no figure, as before).
 */
export async function boardStripFreshnessData(): Promise<unknown> {
  const kept = keptFreshnessData();
  if (kept !== undefined) return kept;
  const sb = supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown } | undefined> };
  const res = await Promise.resolve(sb.rpc("get_freshness_stats"));
  return res && !res.error ? res.data : null;
}

export function useBoardFreshness(): BoardFreshness | null {
  const [state, setState] = useState<BoardFreshness | null>(null);
  useEffect(() => {
    let alive = true;
    const sb = supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };
    Promise.resolve(sb.rpc("get_freshness_stats"))
      .then(({ data, error }) => {
        // Kept for the board even when this page has gone: the visit that
        // clicked through to /jobs is the one the board would ask again for.
        if (!error && data != null) handedOff = { at: Date.now(), data };
        if (alive && !error) setState(parseFreshness(data));
      })
      .catch(() => { /* the rail prints no read figure */ });
    return () => { alive = false; };
  }, []);
  return state;
}
