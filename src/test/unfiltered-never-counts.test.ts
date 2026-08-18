import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE MOST COMMON REQUEST RAN THE MOST EXPENSIVE QUERY, BUT ONLY DURING OUTAGES.
 *
 * The unfiltered board view was designed to skip its exact count by serving the
 * cached facets total. The gate, though, was written as "skip the count WHEN the
 * cache is readable" — so when the facets RPC went down (PGRST002, 2026-08-18
 * 00:20Z), every unfiltered page view silently escalated to an exact count over
 * 584k rows. Measured that night: rows-only 200 in 0.75s; the same query with
 * count=exact 500 in 6.4s. The database logged 88,674 rolled-back transactions,
 * one per cancelled count. The failure amplified itself: the sicker the
 * database, the more expensive every page view became.
 *
 * The rule this file protects: unfiltered NEVER counts. A missing headline
 * number degrades the HEADLINE (total: null + countUnavailable, the client
 * renders its fallback), never the page.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("the unfiltered board view never runs an exact count", () => {
  it("gates the count on filters alone, not on cache readability", () => {
    expect(FN).toMatch(/const wantCount = !unfiltered;/);
    // The old, outage-amplifying shape must not come back.
    expect(FN).not.toMatch(/wantCount = !\(unfiltered && Number\.isFinite\(metaTotal\)/);
  });

  it("degrades a missing cached total to null, never NaN and never a count", () => {
    expect(FN).toMatch(/const safeMetaTotal = Number\.isFinite\(metaTotal\) && metaTotal > 0 \? metaTotal : null;/);
    // Both return sites serve the safe value; the raw NaN-able metaTotal must
    // not reach a response. (NaN JSON-serialises to null by accident — this
    // makes it deliberate and greppable.)
    const countOnly = FN.match(/if \(!wantCount\) return json\(\{ total: (\w+),/);
    expect(countOnly?.[1]).toBe("safeMetaTotal");
    expect(FN).toMatch(/wantCount \? \(count \?\? 0\) : safeMetaTotal/);
  });

  it("tells the client the total is unavailable so it renders a fallback, not a zero-state", () => {
    expect(FN).toMatch(/countUnavailable \|\| \(!wantCount && safeMetaTotal === null\) \? \{ countUnavailable: true \}/);
  });
});
