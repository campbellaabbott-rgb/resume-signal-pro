/**
 * ONE READING OF get_board_vendor_counts, FOR THE BROWSER AND THE BAKE.
 *
 * The homepage and the pricing page print one open-postings figure (owner
 * decision D1): openTotal from the cached facets row, with the moment it was
 * counted (as_of). React reads it through useBoardVendorCounts; the crawler
 * bake (scripts/prerender-seo.mjs) reads the same RPC at build time. Both
 * parse it here, so the baked "/" and the page React renders cannot disagree
 * about what counts as a measurement.
 *
 * ABSENCE IS NOT ZERO: a vendor with no live postings is omitted from
 * sourcesFacet, and a cold cache returns {} and a null total. Neither is a
 * measurement, so neither yields a reading. Pure: no React, no client.
 */
export interface VendorCountsReading {
  /** Per-source open counts. Missing key = not measured OR none, never 0. */
  counts: Record<string, number>;
  /** Sum over all sources under the same serving rule, or null when the row has none. */
  openTotal: number | null;
  /** The row's as_of, as an ISO string, or null when it cannot be read. */
  asOf: string | null;
}

export function parseVendorCounts(data: unknown): VendorCountsReading | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = data as { sourcesFacet?: unknown; openTotal?: unknown; as_of?: unknown };
  const raw = payload.sourcesFacet;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Only finite positive numbers count: Number(null) is 0, and a 0 here is
    // the false claim this reading exists to prevent.
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) counts[k] = Math.round(n);
  }
  if (Object.keys(counts).length === 0) return null;
  const totalRaw = payload.openTotal;
  const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
  const asOfMs = Date.parse(String(payload.as_of ?? ""));
  return {
    counts,
    openTotal: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
  };
}
