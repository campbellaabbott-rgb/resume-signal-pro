/**
 * THE SPANISH INDUSTRY PAGES PRINT THE ENGINE'S TERMS (S14X-214).
 *
 * /es/industrias/* picked Spanish strings out of the engine's merged keyword
 * lists with a guess (an accent, or a de/para/del/al word), and printed at
 * most 103 of the 222 Spanish terms and titles the scanner reads: legal showed
 * one term and one title, finance and education no title, and "litigios",
 * "juzgado" and "contador" were on no page (Googlebot, 2026-11-15). A Spanish
 * word with no accent, like "derecho", was printed under the English heading.
 * The pages now print the copy of the engine's own table, and this file holds
 * the copy to the block in all three engine files.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SPANISH_INDUSTRY_TERMS } from "@/data/es-industry-terms";
import { ES_INDUSTRIES, capitalizeFirst, esIndustryTerms, isSpanish } from "@/data/es-industries";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
type Terms = Record<string, { primary: string[]; titles: string[] }>;

/** The engine's SPANISH_INDUSTRY_TERMS block, read as code and evaluated as data. */
function engineBlock(rel: string): Terms {
  const src = codeOf(readFileSync(resolve(ROOT, rel), "utf8"));
  const head = "const SPANISH_INDUSTRY_TERMS: Record<string, { primary: string[]; titles: string[] }> = ";
  const a = src.indexOf(head);
  expect(a, `${rel}: the block moved`).toBeGreaterThan(-1);
  const b = src.indexOf("\n};", a);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(a + head.length, b + 2)}`)() as Terms;
}
const ENGINES = [
  "supabase/functions/free-keyword-scan/industry-detection.ts",
  "supabase/functions/free-keyword-scan-stream/industry-detection.ts",
  "supabase/functions/_shared/industry-detection.ts",
];

describe("the copy is the engine's table", () => {
  for (const rel of ENGINES) {
    it(`equals the block in ${rel}`, () => {
      expect(SPANISH_INDUSTRY_TERMS).toEqual(engineBlock(rel));
    });
  }
  it("covers every industry with a Spanish page", () => {
    expect(Object.keys(SPANISH_INDUSTRY_TERMS).sort()).toEqual(Object.keys(ES_INDUSTRIES).sort());
  });
});

describe("each Spanish page's model", () => {
  for (const slug of Object.keys(ES_INDUSTRIES)) {
    it(`${slug} prints every Spanish term and title the engine knows, and none under English`, () => {
      const m = esIndustryTerms(slug, INDUSTRY_KEYWORDS[slug]);
      const es = SPANISH_INDUSTRY_TERMS[slug];
      expect(new Set(m.esKeywords)).toEqual(new Set(es.primary));
      expect(new Set(m.esTitles)).toEqual(new Set(es.titles));
      for (const t of m.enKeywords) {
        expect(es.primary.includes(t) || es.titles.includes(t), `${slug}: "${t}" printed as English`).toBe(false);
      }
    });
  }

  it("the terms the guess dropped are printed (positive control: the guess prints none of them)", () => {
    const guess = (slug: string) => INDUSTRY_KEYWORDS[slug].primary.concat(INDUSTRY_KEYWORDS[slug].titles).filter(isSpanish);
    expect(guess("legal")).not.toContain("litigios");
    expect(guess("legal")).not.toContain("juzgado");
    expect(guess("finance")).not.toContain("contador");
    expect(esIndustryTerms("legal", INDUSTRY_KEYWORDS.legal).esKeywords).toEqual(expect.arrayContaining(["litigios", "juzgado"]));
    expect(esIndustryTerms("finance", INDUSTRY_KEYWORDS.finance).esTitles).toContain("contador");
  });
});

describe("the page and the bake read the model, not the guess", () => {
  const page = codeOf(readFileSync(resolve(ROOT, "src/pages/IndustryKeywordsEs.tsx"), "utf8"));
  const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
  it("both call esIndustryTerms and neither filters the merged lists with isSpanish", () => {
    expect(page).toContain("esIndustryTerms(slug, data)");
    expect(page).not.toMatch(/\.filter\(isSpanish\)/);
    const at = bake.indexOf("// ---- /es/industrias/:slug");
    const section = bake.slice(at, bake.indexOf("// ---- Tool landing pages", at));
    expect(section).toContain("D.esIndustryTerms(slug, data)");
    expect(section).not.toMatch(/filter\(D\.isSpanish\)/);
  });
  it("a description opens with a capital (SEO-F16)", () => {
    expect(capitalizeFirst("enfermería, paciente")).toBe("Enfermería, paciente");
    // The five are the list with no word twice (CONTENT-N6), still opened with a capital.
    expect(page).toContain("capitalizeFirst(descriptionKeywords(esKeywords, slug).slice(0, 5).join(\", \"))");
  });
});
