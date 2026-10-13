// RE-TIER ON THE DEVICE, FROM THE FACETS THE SERVER RETURNED.
//
// An edit that does not change what is searched (years, licences, work
// authorisation, an answer to a "? Yes / No / Skip" line) never goes back to
// the server: the device re-applies the same gates and tiers (one shared
// implementation, _shared/match-tiers.ts) to the facets each row carries.
// Work authorisation and answers therefore never need to leave the device.
// Rows the edit sets aside are counted under their reason, never hidden.

import {
  compareRows, freshnessBucket, type Gate, gateFor, type Lane, REDATING_SOURCES, type RowFacets, setAsideCounts,
  type SetAsideCount, type SetAsideReason, type Tier, tierFor, type TierReader,
} from "../../../supabase/functions/_shared/match-tiers";

export interface ServerRow {
  id: string;
  lane: Lane;
  tier: Tier;
  gaps: string[];
  openings: number;
  postedAt: string | null;
  facets: RowFacets;
  source?: string | null;
}

export interface Retiered<R extends ServerRow> {
  rows: Array<R & { tier: Tier; gaps: string[] }>;
  setAside: Array<{ row: R; gate: Gate }>;
  counts: Partial<Record<SetAsideReason, SetAsideCount>>;
}

/**
 * The rows re-gated and re-tiered for `reader`, in the shared order. `overlap`
 * (keyword overlap per id, computed on the device) is the last tie-break.
 * Basis counts use the server's own found/read totals.
 */
export function retier<R extends ServerRow>(
  rows: readonly R[],
  reader: TierReader,
  opts: { nowMs: number; found: number; read: number; overlap?: ReadonlyMap<string, number> },
): Retiered<R> {
  const kept: Array<{ r: R; tier: Tier; gaps: string[]; order: number }> = [];
  const setAside: Array<{ row: R; gate: Gate }> = [];
  rows.forEach((r, order) => {
    const gate = gateFor(r.facets, reader);
    if (gate) { setAside.push({ row: r, gate }); return; }
    const t = tierFor(r.facets, reader);
    kept.push({ r, tier: t.tier, gaps: t.gaps, order });
  });
  kept.sort((a, b) => compareRows(
    { tier: a.tier, lane: a.r.lane, freshness: freshnessBucket(a.r.postedAt, opts.nowMs, REDATING_SOURCES.has(String(a.r.source ?? ""))), openings: a.r.openings, overlap: opts.overlap?.get(a.r.id) ?? null, serverOrder: a.order },
    { tier: b.tier, lane: b.r.lane, freshness: freshnessBucket(b.r.postedAt, opts.nowMs, REDATING_SOURCES.has(String(b.r.source ?? ""))), openings: b.r.openings, overlap: opts.overlap?.get(b.r.id) ?? null, serverOrder: b.order },
  ));
  return {
    rows: kept.map((k) => ({ ...k.r, tier: k.tier, gaps: k.gaps })),
    setAside,
    counts: setAsideCounts(setAside.map((s) => s.gate), { found: opts.found, read: opts.read }),
  };
}
