import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { getAddOnProducts, oneTimePriceRangeUsd, PRODUCTS } from "@/config/products";
import { COMPETITORS } from "@/data/competitors";

/**
 * WHAT WAS WRONG (S8-012, measured 2026-10-08; L4-08): every completed free
 * report's final buy button read "Get Full Analysis — $25" (en-GB "£20") while
 * the line under it said $5 and checkout charged $5. The $25 lived in a locale
 * string, freeScan.cta.price, in all nine files, beside four more typed $25s
 * (hero.price, hero.roi, finalCta.roi, comparison.cta) and a "$5 – $25" range;
 * the /vs pages said "$3–29" while /pricing said "$2–$59".
 *
 * The rule now: a locale string never types one of OUR prices. A price is
 * interpolated from the products mirror at render time; the only currency
 * literals left in a locale file are salaries, competitors' prices and sample
 * text, each listed below with its reason, plus one of ours that is checked
 * against the products it describes.
 */

const ROOT = resolve(__dirname, "../..");
const LOCALES = resolve(ROOT, "src/i18n/locales");
const MONEY = /(?<![\w{])[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:€|US\$|USD)\b/g;

/** Keys allowed a currency literal, and why it is not one of our prices. */
const NOT_OUR_PRICE: Record<string, string> = {
  "valueComparison.rows.cost.them": "a career coach's typical fee, the competitor column",
  "valueComparison.rows.jobTailoring.them": "the competitor column",
  "analysisPreviewSample.bulletImproved": "a sample résumé bullet's own figure",
  "jobsPage.presetSalary": "a salary filter",
  "jobsPage.paSalary": "a salary filter",
  "jobsPage.chip100k": "a salary filter",
  "jobsPage.nlPlaceholder": "a salary in an example search",
  "explore.chipsCoveragePayFloor": "a pay floor filter",
  "explore.chip.pay80k": "a pay floor filter",
  "applyProfile.salaryPh": "a salary placeholder",
};
/** One of our prices that stays typed, checked against the products it names. */
const OURS_CHECKED: Record<string, number[]> = {
  "addOnsShowcase.fiveDollarsEach": getAddOnProducts().map((p) => p.priceUsd),
};

function leaves(o: unknown, pre = ""): Array<[string, string]> {
  if (typeof o === "string") return [[pre, o]];
  if (o && typeof o === "object") return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, pre ? `${pre}.${k}` : k));
  return [];
}

describe("no locale string types one of our prices", () => {
  const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
  it("reads all nine locale files", () => expect(files.length).toBe(9));

  for (const file of files) {
    it(`${file}: every currency figure is a salary, a competitor's or sample text`, () => {
      const stray: string[] = [];
      for (const [key, value] of leaves(JSON.parse(readFileSync(resolve(LOCALES, file), "utf8")))) {
        const found = value.match(MONEY);
        if (!found) continue;
        if (key in NOT_OUR_PRICE) continue;
        if (key in OURS_CHECKED) {
          const amounts = found.map((m) => Number(m.replace(/[^\d.]/g, "")));
          for (const a of amounts) expect(OURS_CHECKED[key], `${file} ${key} quotes ${a}`).toContain(a);
          for (const p of OURS_CHECKED[key]) expect(p, `${key}: every product it names costs what it says`).toBe(OURS_CHECKED[key][0]);
          continue;
        }
        stray.push(`${key}: ${found.join(", ")}`);
      }
      expect(stray, "a typed price for one of our products — interpolate it from src/config/products.ts").toEqual([]);
    });
  }
});

describe("the surfaces that quoted a price now read it", () => {
  it("the free report's final button renders the Full Analysis price the checkout charges", () => {
    const c = codeOf(readFileSync(resolve(ROOT, "src/components/FreeKeywordResults.tsx"), "utf8"));
    expect(c).toMatch(/\{getFinalCtaText\(\)\} — \{priceDisplay\}/);
    expect(c).toMatch(/const priceDisplay = isLocalCurrency \? `\$\$\{fullAnalysisPrice\}/);
  });

  it("the range sentence is the catalogue's range, on /vs and in the comparison table", () => {
    const { min, max } = oneTimePriceRangeUsd();
    expect(min).toBeLessThanOrEqual(PRODUCTS.fullAnalysis.priceUsd);
    expect(max).toBeGreaterThanOrEqual(PRODUCTS.fullAnalysis.priceUsd);
    for (const c of Object.values(COMPETITORS)) {
      const text = JSON.stringify(c);
      expect(text, c.slug).not.toMatch(/\$3–29/);
      for (const m of text.match(/paid tools \$\d+–\d+/g) ?? []) expect(m, c.slug).toBe(`paid tools $${min}–${max}`);
    }
  });
});
