// @vitest-environment node
/**
 * A FIELD LANDER LINKS THE RESUME-KEYWORD PAGES FOR ITS FIELD (SEO audit
 * 2026-11-18, CONTENT-N8, the other direction).
 *
 * The industry pages link up to their field's lander; the lander linked
 * nothing back, so /jobs/field/data_ai never reached /industries/
 * machine_learning. A lander now links the resume-keyword page of every
 * industry INDUSTRY_TO_CATEGORY maps to it. seo-bake-crawler-output reads the
 * served bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_TO_CATEGORY, BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";
import { codeOf } from "./helpers/strip-comments";

const code = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));

describe("a field lander", () => {
  it("collects the industries mapped to it", () => {
    expect(code).toMatch(/const fieldIndustries = Object\.keys\(D\.INDUSTRY_TO_CATEGORY\)\.filter\(\(ind\) => D\.INDUSTRY_TO_CATEGORY\[ind\] === slug && D\.INDUSTRY_KEYWORDS\[ind\]\)\.sort\(\);/);
  });

  it("links each one's resume-keyword page", () => {
    expect(code).toMatch(/Resume keywords for this field: \$\{fieldIndustries\.map\(\(ind\) => `<a href="\/industries\/\$\{ind\}">/);
  });

  it("most fields have at least one industry page to link", () => {
    const mapped = new Set(Object.values(INDUSTRY_TO_CATEGORY));
    expect(BOARD_CATEGORY_SLUGS.filter((s) => mapped.has(s)).length).toBeGreaterThanOrEqual(14);
  });
});

describe("the landers' names", () => {
  it("are the board's own labels, with no wording change", () => {
    expect(code).toMatch(/const CATEGORY_LANDERS = D\.BOARD_CATEGORY_SLUGS\.map\(\(s\) => \[s, D\.BOARD_CATEGORY_LABELS\[s\]\]\);/);
  });
});
