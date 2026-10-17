/**
 * THE SCANNER LANDING STATES THE COUNTS THE PRODUCT HAS (S12-047).
 *
 * The Hero's stats row on the scanner landings (/resume-checker and the
 * homepage hero variants) printed "59" industries over a detection table of
 * 58, and "10" languages over eight interface languages. The guard that was
 * meant to catch typed counts matched "59 industries" as one string, and the
 * Hero puts the number and its label in two nodes, so it could never see it.
 *
 * This test renders the stats row and reads the numbers a visitor sees, so a
 * typed number fails it whatever markup carries it; and it holds the one
 * written-down count (src/config/scan-coverage.ts) equal to the table itself.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/hooks/use-scan-totals", () => ({ useScanTotals: () => null }));

import { HeroStatsBar } from "@/components/Hero";
import { DETECTED_INDUSTRY_COUNT } from "@/config/scan-coverage";
import { LANGUAGE_COUNT, languages } from "@/i18n/languages";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const TABLE = Object.keys(INDUSTRY_KEYWORDS).length;

afterEach(cleanup);

describe("the written-down counts are the product's own", () => {
  it("the industry count is the detection table's size", () => {
    expect(TABLE).toBeGreaterThan(40);
    expect(DETECTED_INDUSTRY_COUNT).toBe(TABLE);
  });

  it("the language count is the distinct interface languages (regional variants counted once)", () => {
    expect(LANGUAGE_COUNT).toBe(new Set(languages.map((l) => l.code.split("-")[0])).size);
    expect(LANGUAGE_COUNT).toBeLessThan(languages.length);
  });

  it("the homepage's structured data states the same industry count (its own constant, or this one)", () => {
    const index = codeOf(read("src/pages/Index.tsx"));
    const local = /const DETECTED_INDUSTRY_COUNT = (\d+);/.exec(index);
    if (local) expect(Number(local[1])).toBe(TABLE);
    else expect(index).toMatch(/import \{[^}]*\bDETECTED_INDUSTRY_COUNT\b[^}]*\} from "@\/config\/scan-coverage"/);
  });
});

describe("the stats row, rendered", () => {
  it("prints the table's industry count and the interface language count", () => {
    const { container } = render(<HeroStatsBar />);
    expect(container.querySelector('[data-stat="industries"]')?.textContent).toBe(String(TABLE));
    expect(container.querySelector('[data-stat="languages"]')?.textContent).toBe(String(LANGUAGE_COUNT));
  });

  it("prints no other two-digit count beside those labels", () => {
    const { container } = render(<HeroStatsBar />);
    const numbers = [...container.querySelectorAll("p")].map((p) => p.textContent ?? "").filter((s) => /^\d+\+?$/.test(s.trim()));
    // The industry and language counts, and the checks-per-scan figure.
    expect(numbers.filter((n) => n !== String(TABLE) && n !== String(LANGUAGE_COUNT))).toEqual(["24+"]);
  });

  it("the Hero's markup carries the derived constants, not numbers typed into the stats", () => {
    const hero = codeOf(read("src/components/Hero.tsx"));
    expect(hero).toMatch(/data-stat="industries">\{DETECTED_INDUSTRY_COUNT\}</);
    expect(hero).toMatch(/data-stat="languages">\{LANGUAGE_COUNT\}</);
    expect(hero).not.toMatch(/>\s*(?:59|10)\s*</);
  });
});
