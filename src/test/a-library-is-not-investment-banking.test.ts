/**
 * A LIBRARY IS NOT INVESTMENT BANKING (register S13-010, review fix).
 *
 * The report's industry card looked the scanner's industry up by alias with
 * includes() both ways, so "it" inside "hospitality", "janitorial",
 * "fitness", "maritime" and "architecture" gave them the technology card,
 * "ib" inside "library" investment banking, "ai" inside "entertainment" data
 * science, "state" inside "real_estate" government, and "engineering" (civil,
 * mechanical) the software card. Retail got the sales card, manufacturing
 * and logistics the operations card, though each has its own.
 *
 * Every id the scanner answers with now has an entry in one table, a card or
 * none (the type check fails when a new id has no entry), and any other name
 * must be a card's key, name or alias as a whole. With no card the section
 * is not shown.
 *
 * Measured (~/.config/resumebooster/free-scan-wave-corpora/S13-010/
 * fix2-page-industry-card.json): the 59 scanner ids, main right on 37, the
 * fix on 59; weighted by how often the scanner returns each id on 3,693 real
 * postings, main 3,190 right, the fix 3,693. None worse than main.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INDUSTRY_KEYWORDS, findIndustryConfig } from "@/config/industry-keywords";
import { SCAN_INDUSTRY_IDS } from "@/config/scan-industries";
import { IndustryKeywordSuggestions } from "@/components/IndustryKeywordSuggestions";
import { codeOf } from "./helpers/strip-comments";

const cardOf = (industry: string) => {
  const config = findIndustryConfig(industry);
  return config ? Object.entries(INDUSTRY_KEYWORDS).find(([, v]) => v === config)?.[0] ?? "?" : null;
};

describe("the audit's ids", () => {
  const cases: Array<[string, string | null]> = [
    ["library", null],
    ["hospitality", "hospitality"],
    ["janitorial", null],
    ["fitness", null],
    ["maritime", null],
    ["architecture", null],
    ["entertainment", null],
    ["real_estate", "realEstate"],
    ["engineering", null],
    ["retail", "retail"],
    ["manufacturing", "manufacturing"],
    ["logistics", "logistics"],
    ["customer_success", "customerSuccess"],
    ["machine_learning", "machine_learning"],
    ["cybersecurity", "cybersecurity"],
    ["law_enforcement", null],
    ["culinary", "hospitality"],
    ["dental", "healthcare"],
  ];
  for (const [id, want] of cases) it(`${id} → ${want ?? "no card"}`, () => expect(cardOf(id)).toBe(want));
});

describe("every scanner id resolves to the card it is listed with", () => {
  const labels: Record<string, string | null> = {
    technology: "technology", healthcare: "healthcare", finance: "finance", legal: "legal", sales: "sales",
    marketing: "marketing", education: "education", engineering: null, creative: "design", hr: "humanResources",
    consulting: "consulting", retail: "retail", hospitality: "hospitality", manufacturing: "manufacturing",
    government: "government", product_management: "product_management", data_engineering: "data_engineering",
    data_science: "data_science", machine_learning: "machine_learning", cybersecurity: "cybersecurity",
    logistics: "logistics", real_estate: "realEstate", insurance: null, nonprofit: "nonprofit", biotech: null,
    aviation: null, energy: null, skilled_trades: null, customer_success: "customerSuccess", pharmacy: "healthcare",
    dental: "healthcare", veterinary: null, fitness: null, media: null, telecom: null, agriculture: null,
    sports_management: "sportsManagement", entertainment: null, academia: null, construction_management: null,
    architecture: null, social_work: null, childcare: null, beauty: null, culinary: "hospitality",
    law_enforcement: null, environmental: null, gaming: null, ecommerce: "retail", translation: null,
    event_planning: "eventManagement", administrative: null, library: null, clergy: null, mining: null,
    maritime: null, landscaping: null, janitorial: null, general: null,
  };
  it("the label table covers every id", () => expect(Object.keys(labels).sort()).toEqual([...SCAN_INDUSTRY_IDS].sort()));
  for (const id of SCAN_INDUSTRY_IDS) it(id, () => expect(cardOf(id)).toBe(labels[id]));
});

describe("other names are a card's key, name or alias as a whole", () => {
  const cases: Array<[string, string | null]> = [
    ["Information Technology", "technology"],
    ["human_resources", "humanResources"],
    ["digital_marketing", "marketing"],
    ["mechanical_engineering", null],
    ["civil_engineering", null],
    ["intellectual_property", "legal"],
    ["medtech", null],
    ["software_engineering", "technology"],
    ["", null],
  ];
  for (const [name, want] of cases) it(`${JSON.stringify(name)} → ${want ?? "no card"}`, () => expect(cardOf(name)).toBe(want));
  it("no alias is matched inside another word", () => {
    const src = codeOf(readFileSync(resolve(__dirname, "../config/industry-keywords.ts"), "utf8"));
    expect(src).not.toMatch(/normalized\.includes\(alias\)|alias\.includes\(normalized/);
  });
});

describe("with no card the section is not shown", () => {
  it("a librarian's report shows no industry keyword card", () => {
    const { container } = render(createElement(IndustryKeywordSuggestions, { industry: "library", resumeText: "Catalogued 4,000 titles." }));
    expect(container.innerHTML).toBe("");
  });
});
