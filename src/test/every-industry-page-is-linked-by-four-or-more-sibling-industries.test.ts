// @vitest-environment node
/**
 * EVERY INDUSTRY PAGE IS LINKED BY FOUR OR MORE SIBLING INDUSTRIES (SEO audit
 * 2026-11-18, CONTENT-N1).
 *
 * Both renderers linked the first 8 industries in alphabetical order from
 * every /industries page: on 2026-11-18, 8 pages received 57 sibling links
 * each and 49 of the 58 received none, so most industry pages were reachable
 * only from the /industries index. One helper, shared by the React page and
 * the bake, now links the closest industries first (same board field, then
 * keyword and title overlap) and fills the rest in alphabetical order after
 * the page, so every page is linked by at least 4 and at most 16 siblings.
 * seo-bake-crawler-output counts the same links in the served bytes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { INDUSTRY_TO_CATEGORY } from "@/lib/job-board-categories";
import { relatedIndustries } from "@/lib/seo/related-industries";

const ALL = Object.keys(INDUSTRY_KEYWORDS);
const src = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const rel = (s: string) => relatedIndustries(s, INDUSTRY_KEYWORDS, INDUSTRY_TO_CATEGORY);

describe("the sibling links across all industry pages", () => {
  const incoming = new Map(ALL.map((s) => [s, 0]));
  for (const s of ALL) for (const r of rel(s)) incoming.set(r, (incoming.get(r) ?? 0) + 1);

  it("every page receives at least 4 and at most 16", () => {
    expect([...incoming].filter(([, n]) => n < 4)).toEqual([]);
    expect([...incoming].filter(([, n]) => n > 16)).toEqual([]);
  });

  it("each page links 8 others, never itself and never one twice", () => {
    for (const s of ALL) {
      const r = rel(s);
      expect(r.length, s).toBe(8);
      expect(r, s).not.toContain(s);
      expect(new Set(r).size, s).toBe(8);
    }
  });

  it("the closest industries come first: the same field, then the most shared keywords", () => {
    expect(rel("machine_learning").slice(0, 2).sort()).toEqual(["data_engineering", "data_science"]);
    expect(rel("healthcare").slice(0, 3)).toEqual(expect.arrayContaining(["pharmacy", "dental"]));
    expect(rel("technology")).toContain("data_engineering");
    expect(rel("technology")).toContain("cybersecurity");
  });

  it("is not the alphabetical head any more", () => {
    const head = [...ALL].sort().slice(0, 9);
    const sameAsBefore = ALL.filter((s) => rel(s).join() === head.filter((x) => x !== s).slice(0, 8).join());
    expect(sameAsBefore.length).toBeLessThan(5);
  });

  it("an industry it does not know links nothing", () => {
    expect(rel("no_such_industry")).toEqual([]);
  });
});

describe("both renderers", () => {
  it("call the one helper with the scanner's own tables", () => {
    expect(src("scripts/prerender-seo.mjs")).toMatch(/const related = D\.relatedIndustries\(slug, D\.INDUSTRY_KEYWORDS, D\.INDUSTRY_TO_CATEGORY\);/);
    expect(src("src/pages/IndustryKeywords.tsx")).toMatch(/\{relatedIndustries\(slug \?\? "", INDUSTRY_KEYWORDS, INDUSTRY_TO_CATEGORY\)\.map\(/);
    expect(src("src/pages/IndustryKeywords.tsx")).not.toMatch(/\.sort\(\)\.slice\(0, 8\)/);
  });
});
