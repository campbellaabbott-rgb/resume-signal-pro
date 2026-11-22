// @vitest-environment node
/**
 * A KEYWORD DESCRIPTION NAMES NO WORD TWICE (SEO audit 2026-11-18,
 * CONTENT-N6).
 *
 * The /industries and /roles descriptions open with the head of the field's
 * keyword table, which holds every spelling the scanner matches: healthcare
 * read "patient care, patient, patients", consulting "client, clients", and
 * /es/industrias/healthcare "paciente, pacientes". Beauty opened with
 * "clients beauty", a token that narrows a match and reads as a typo. A
 * description now names a keyword once and leaves the narrowing tokens out;
 * the page's own keyword lists are unchanged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { descriptionKeywords, industryKeywordsHead, roleKeywordsHead } from "@/lib/seo/keyword-pages";
import { ES_INDUSTRIES, esIndustryTerms } from "@/data/es-industries";
import { ROLE_PAGES } from "@/data/roles";

/** The keyword list of a description: what stands between the colon and ", plus". */
const listOf = (d: string) => (/: (.*?), plus /.exec(d)?.[1] ?? "").split(", ").filter(Boolean);
const fold = (k: string) => k.toLowerCase().replace(/[-\s]+/g, "").replace(/s$/, "");

describe("an /industries description", () => {
  it("healthcare names patient care and patient once, without patients", () => {
    const d = industryKeywordsHead("healthcare", INDUSTRY_KEYWORDS.healthcare.primary).description;
    expect(d).not.toMatch(/patient, patients/i);
    expect(listOf(d).map((k) => k.toLowerCase())).toEqual(expect.arrayContaining(["patient care", "patient"]));
  });

  it("beauty opens with a keyword a person would write, not a narrowing token", () => {
    const d = industryKeywordsHead("beauty", INDUSTRY_KEYWORDS.beauty.primary).description;
    expect(d).not.toMatch(/clients beauty/i);
    expect(d).toMatch(/look for: color services/i);
  });

  it("across all fields, never names two spellings of one keyword", () => {
    const twice: string[] = [];
    for (const [slug, data] of Object.entries(INDUSTRY_KEYWORDS)) {
      const ks = listOf(industryKeywordsHead(slug, data.primary).description).map(fold);
      if (new Set(ks).size !== ks.length) twice.push(slug);
    }
    expect(twice).toEqual([]);
  });
});

describe("a /roles description", () => {
  it("never names two spellings of one keyword", () => {
    const twice: string[] = [];
    for (const role of Object.values(ROLE_PAGES) as Array<{ title: string; industry: string }>) {
      const data = INDUSTRY_KEYWORDS[role.industry];
      if (!data) continue;
      const d = roleKeywordsHead(role.title, role.industry, data.primary).description;
      const ks = (/: (.*?), plus /.exec(d)?.[1] ?? "").split(", ").map(fold);
      if (new Set(ks).size !== ks.length) twice.push(`${role.title}: ${d}`);
    }
    expect(twice).toEqual([]);
  });
});

describe("a Spanish industry description", () => {
  it("names paciente once, in the bake and on the page alike", () => {
    const { esKeywords } = esIndustryTerms("healthcare", INDUSTRY_KEYWORDS.healthcare);
    const five = descriptionKeywords(esKeywords, "healthcare").slice(0, 5).map(fold);
    expect(new Set(five).size).toBe(five.length);
    for (const slug of Object.keys(ES_INDUSTRIES)) {
      const ks = descriptionKeywords(esIndustryTerms(slug, INDUSTRY_KEYWORDS[slug]).esKeywords, slug).slice(0, 5).map(fold);
      expect(new Set(ks).size, slug).toBe(ks.length);
    }
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/description: listDesc\(D\.descriptionKeywords\(esKeywords, slug\)\.slice\(0, 5\)/);
    const page = readFileSync(resolve(__dirname, "../../src/pages/IndustryKeywordsEs.tsx"), "utf8");
    expect(page).toMatch(/capitalizeFirst\(descriptionKeywords\(esKeywords, slug\)\.slice\(0, 5\)\.join\(", "\)\)/);
  });
});

describe("the rule", () => {
  it("keeps the first spelling, and keeps a field's own phrase such as deep learning or inbound sales", () => {
    expect(descriptionKeywords(["closed won", "closed-won", "api", "apis", "deep learning", "inbound sales"], "sales")).toEqual(["closed won", "api", "deep learning", "inbound sales"]);
    expect(descriptionKeywords(["patients dental", "x-rays dental", "cleanings"], "dental")).toEqual(["cleanings"]);
    expect(descriptionKeywords(["business", "class", "glass"], "x")).toEqual(["business", "class", "glass"]);
  });
});
