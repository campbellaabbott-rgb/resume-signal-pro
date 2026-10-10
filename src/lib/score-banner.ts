/**
 * The one line under a below-75 score on the free report (register L4-06).
 *
 * It said "Most ATS require 60+ to pass" to everyone under 60 — about half of
 * all users, against a corpus median of 58 — and "75+ increases callback
 * rate" to the rest, which the site's own guides call a myth. It now places
 * the score in the scanned distribution for the user's industry when there is
 * one large enough to read (20 or more scans), and otherwise says plainly that
 * the score is no pass mark.
 */
export type RealBenchmark = { n: number; median: number; p25: number; p75: number; industry: string };
export const BANNER_MIN_SAMPLE = 20;

export function scoreBannerLine(score: number, bench: RealBenchmark | null | undefined): { key: string; vars: Record<string, string | number> } {
  if (bench && bench.n >= BANNER_MIN_SAMPLE) {
    const vars = {
      median: Math.round(bench.median),
      p75: Math.round(bench.p75),
      n: bench.n.toLocaleString(),
      industry: bench.industry.replace(/_/g, " "),
    };
    if (score < bench.median) return { key: "freeResults.atsBanner.belowMedian", vars };
    if (score < bench.p75) return { key: "freeResults.atsBanner.belowTopQuarter", vars };
  }
  return { key: "freeResults.atsBanner.noPassMark", vars: {} };
}
