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

export function useBoardFreshness(): BoardFreshness | null {
  const [state, setState] = useState<BoardFreshness | null>(null);
  useEffect(() => {
    let alive = true;
    const sb = supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };
    Promise.resolve(sb.rpc("get_freshness_stats"))
      .then(({ data, error }) => {
        if (alive && !error) setState(parseFreshness(data));
      })
      .catch(() => { /* the rail prints no read figure */ });
    return () => { alive = false; };
  }, []);
  return state;
}
