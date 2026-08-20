import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE COUNTS DISAPPEARED AT EXACTLY THE MOMENT THEY MATTERED.
 *
 * The field dropdown renders "Sales (62,871)" — and MEASURED 2026-08-20, those
 * numbers vanish the instant any filter is applied: unfiltered returns 18
 * populated categories, country=US returns 0.
 *
 * That suppression was deliberate and CORRECT. The cached facet is board-wide,
 * so under a United States filter "Design (4,320)" would be a global number
 * wearing a filtered label. visibleCategories suppresses rather than lies.
 *
 * But narrowing is the entire job of a filter UI, and a visitor who has picked
 * United States cannot currently tell whether Design holds 4,000 US roles or
 * 4. So the fix is not to remove the guard — it is to compute the honest
 * number. Measured cost before building: 0.27-0.43s per filtered category
 * count (US+engineering, 24,713 rows, 0.30s).
 *
 * What this file pins is the SAFETY of that, because 18 counts is exactly the
 * amplification shape that took the board down on 2026-08-17.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

const FACET = (() => {
  const start = FN.indexOf("if (body.facetCounts === true) {");
  if (start < 0) return "";
  const end = FN.indexOf("  if (countOnly) {", start);
  return end > start ? FN.slice(start, end) : "";
})();

describe("filtered category counts are computed, not guessed or dropped", () => {
  it("reuses buildQuery so the counts cannot drift from the results", () => {
    // A hand-rolled facet query would diverge from the list the first time a
    // filter changed, and the counts would quietly stop matching what the
    // visitor actually gets. categoryOverride already exists for the
    // two-subset pager; this rides it.
    expect(FACET, "facetCounts branch not found").not.toBe("");
    expect(FACET).toMatch(/buildQuery\("effective_posted", true, c\)/);
  });

  it("is its own action — it never rides the list request", () => {
    // 18 grouped counts on every page view is the request amplification that
    // caused the 2026-08-17 outage.
    expect(FN).toMatch(/if \(body\.facetCounts === true\)/);
    expect(UI).toMatch(/action: "list", facetCounts: true/);
  });

  it("is bounded by BOTH chunked concurrency and a deadline", () => {
    expect(FACET).toMatch(/FACET_CHUNK = \d+/);
    expect(FACET).toMatch(/FACET_DEADLINE = Date\.now\(\) \+ \d+_?\d*/);
    expect(FACET).toMatch(/if \(Date\.now\(\) > FACET_DEADLINE\) break;/);
    const chunk = Number(/FACET_CHUNK = (\d+)/.exec(FACET)![1]);
    expect(chunk).toBeGreaterThan(0);
    expect(chunk, "a chunk this wide is the amplification shape again").toBeLessThanOrEqual(8);
  });

  it("omits a category it could not measure — never renders an unmeasured zero", () => {
    // Absent means "no count", which is the state the dropdown is already in.
    // A fabricated 0 would tell the visitor a field is empty when it is not.
    expect(FACET).toMatch(/if \(typeof n === "number"\) counts\[c\] = n;/);
    expect(FACET).toMatch(/r\.error \? null : \(r\.count \?\? 0\)/);
  });

  it("the client debounces and discards superseded responses", () => {
    // Without the sequence guard a slow response for the PREVIOUS filter set
    // paints over the current one — counts that disagree with the visible
    // results, which is worse than no counts at all.
    expect(UI).toMatch(/catFacetSeq/);
    expect(UI).toMatch(/if \(seq !== catFacetSeq\.current\) return;/);
    expect(UI).toMatch(/setTimeout\(async \(\) => \{[\s\S]{0,2000}?\}, 400\);/);
  });

  it("skips the request entirely when nothing is filtered", () => {
    // Unfiltered, the cached board-wide facet is already correct and free.
    expect(UI).toMatch(/if \(!activeFilters\) \{ setFilteredCats\(null\); return; \}/);
  });

  it("prefers the filter-aware count but still falls back to the board-wide one", () => {
    expect(UI).toMatch(/filteredCats\?\.\[c\] \?\? data\?\.categories\?\.\[c\]/);
  });
});
