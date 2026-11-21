// @vitest-environment node
/**
 * TWO BOARD TOTALS READ TOGETHER AGREE (SEO audit 2026-11-18, GEO-5).
 *
 * On 2026-11-18 /ghost-job-index printed 986,401 open roles (the stats cache)
 * and /about 1,005,326 (the facets snapshot), 1.9% apart: each stamped, each
 * true of its own moment, and two board sizes to an answer engine that reads
 * both. The bake now compares the two when they were read within 30 minutes
 * of each other and says so at the WARN tier above 1%. Two totals read hours
 * apart measure two moments, and their difference is the board moving.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as seo from "../../scripts/prerender-seo.mjs";
import { codeOf } from "./helpers/strip-comments";

const S = seo as unknown as {
  boardTotalsWarning?: (o: { ghostTotal: unknown; ghostAt: unknown; boardTotal: unknown; boardAt: unknown }) => string | null;
};
const AT = "2026-11-18T09:00:00Z";
const plus = (min: number) => new Date(Date.parse(AT) + min * 60_000).toISOString();

describe("the two totals", () => {
  it("read 10 minutes apart and 1.9% apart are named, with both figures and both stamps", () => {
    expect(typeof S.boardTotalsWarning).toBe("function");
    const w = S.boardTotalsWarning!({ ghostTotal: 986_401, ghostAt: AT, boardTotal: 1_005_326, boardAt: plus(10) });
    expect(w).toMatch(/10 min apart differ by 1\.9%/);
    expect(w).toContain("986,401");
    expect(w).toContain("1,005,326");
  });

  it("within 1% of each other, or read more than 30 minutes apart, say nothing", () => {
    expect(S.boardTotalsWarning!({ ghostTotal: 1_000_000, ghostAt: AT, boardTotal: 1_009_000, boardAt: plus(5) })).toBeNull();
    expect(S.boardTotalsWarning!({ ghostTotal: 986_401, ghostAt: AT, boardTotal: 1_005_326, boardAt: plus(31) })).toBeNull();
  });

  it("a missing figure or stamp is not a disagreement", () => {
    for (const o of [
      { ghostTotal: null, ghostAt: AT, boardTotal: 1_005_326, boardAt: AT },
      { ghostTotal: 986_401, ghostAt: null, boardTotal: 1_005_326, boardAt: AT },
      { ghostTotal: 986_401, ghostAt: AT, boardTotal: 0, boardAt: AT },
      { ghostTotal: 986_401, ghostAt: AT, boardTotal: 1_005_326, boardAt: "not a time" },
    ]) expect(S.boardTotalsWarning!(o)).toBeNull();
  });
});

describe("the bake", () => {
  const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  it("compares the Ghost Job Index total with the board total it prints elsewhere, stamped with when each was read", () => {
    expect(code).toMatch(/boardTotalsWarning\(\{ ghostTotal: g\?\.total_open, ghostAt: g\?\.computed_at, boardTotal: BOARD_TOTAL, boardAt: facetsAt \}\)/);
    expect(code).toMatch(/FACETS_READ_AT = Date\.now\(\)/);
  });
});
