// @vitest-environment node
/**
 * A MAPPED INDUSTRY PAGE LINKS ITS FIELD LANDER IN THE SERVED HTML (SEO audit
 * 2026-11-18, CONTENT-N8).
 *
 * React's /industries/<slug> and /es/industrias/<slug> link the board field
 * the industry maps to (INDUSTRY_TO_CATEGORY); the baked pages, the bytes a
 * crawler reads, did not, so /industries/technology never linked
 * /jobs/field/engineering for a crawler. The bake now prints the same link, in
 * the page's own language. seo-bake-crawler-output reads the served bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { INDUSTRY_TO_CATEGORY, isBoardCategory } from "@/lib/job-board-categories";
import { codeOf } from "./helpers/strip-comments";

const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("the industry-to-field map", () => {
  it("names only industries the scanner has and fields the board has", () => {
    for (const [ind, cat] of Object.entries(INDUSTRY_TO_CATEGORY)) {
      expect(INDUSTRY_KEYWORDS[ind], ind).toBeTruthy();
      expect(isBoardCategory(cat), cat).toBe(true);
    }
  });
});

describe("the baked industry pages", () => {
  it("the English page links the field lander with React's words", () => {
    expect(code).toMatch(/const fieldSlug = D\.INDUSTRY_TO_CATEGORY\[slug\] \?\? null;/);
    expect(code).toMatch(/\$\{fieldSlug \? `<p class="mb-8 -mt-4"><a href="\/jobs\/field\/\$\{fieldSlug\}" class="text-primary font-medium">See live \$\{esc\(lower\)\} openings on the job board →<\/a>/);
  });

  it("the Spanish page links it with the Spanish page's words", () => {
    expect(code).toMatch(/<a href="\/jobs\/field\/\$\{D\.INDUSTRY_TO_CATEGORY\[slug\]\}" class="text-primary font-medium">Ver empleos activos de este campo en el tablón →<\/a>/);
    const react = readFileSync(resolve(__dirname, "../../src/pages/IndustryKeywordsEs.tsx"), "utf8");
    expect(react).toContain("Ver empleos activos de este campo en el tablón →");
  });
});
