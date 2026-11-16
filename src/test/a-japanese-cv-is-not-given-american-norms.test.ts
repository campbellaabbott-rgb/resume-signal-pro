/**
 * A JAPANESE CV IS NOT GIVEN AMERICAN NORMS (bug round S14X-003, M-S14-003).
 *
 * getMarketInsight fell back to the US entry for any country without one of
 * its own, so a Japanese, Chinese, Korean or French technology CV was told
 * the US norm "Do NOT include photo, age, nationality, or marital status"
 * (in Japan the rirekisho carries a photo), and Singapore's own entry said
 * "Photo optional but common" while the same report's country standard said
 * never. Now a country with no entry of its own gets norms built from its
 * COUNTRY_STANDARDS entry, Singapore's entry agrees with its standard, and
 * every market is named from COUNTRY_STANDARDS.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getMarketInsight } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";

const FN = resolve(__dirname, "../../supabase/functions");

describe("a market's norms are its own", () => {
  it("Japan's technology CV carries Japan's photo note, not the American rule", () => {
    const norms = getMarketInsight("JP", "technology").cvNorms.join("\n");
    expect(norms).not.toContain("Do NOT include photo");
    expect(norms).toContain(COUNTRY_STANDARDS.JP.photoNote);
  });

  it("no country without an entry of its own is given the US norms", () => {
    const usNorms = getMarketInsight("US", "technology").cvNorms;
    for (const code of ["JP", "CN", "KR", "FR"]) {
      if (!COUNTRY_STANDARDS[code]) continue;
      const norms = getMarketInsight(code, "technology").cvNorms;
      expect(norms, code).not.toEqual(usNorms);
      expect(norms.join("\n"), code).not.toContain("Do NOT include photo");
    }
  });

  it("Singapore's technology entry no longer calls a photo optional", () => {
    const norms = getMarketInsight("SG", "technology").cvNorms.join("\n");
    expect(norms).not.toMatch(/photo optional/i);
  });

  it("Poland is named Poland", () => {
    expect(getMarketInsight("PL", "technology").countryName).toBe("Poland");
    expect(getMarketInsight("PL", "technology").countryName).toBe(COUNTRY_STANDARDS.PL.name);
  });

  it("the two copies of market-intelligence.ts are byte-identical", () => {
    const a = readFileSync(resolve(FN, "free-keyword-scan/market-intelligence.ts"), "utf8");
    const b = readFileSync(resolve(FN, "free-keyword-scan-stream/market-intelligence.ts"), "utf8");
    expect(a === b).toBe(true);
  });
});
