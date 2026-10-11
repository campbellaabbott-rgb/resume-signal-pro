import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";
import { BOARD_USD_FACTORS, SYSTEM_PROMPT, TOOL_PARAMETERS, validateParse } from "../../supabase/functions/nl-search/parse";

/**
 * S11-026: nl-search's salaryFloor prompt said "ANNUAL, no currency symbol"
 * and never said the board compares approximate US dollars
 * (salary_rank_usd). So "London jobs over £45,000" became a $45k floor that
 * admits £37,080 roles, and "Tokyo ¥8,000,000" or "Bangalore 20 lakh" were
 * clamped to a $2M floor that returned 0 jobs under a chip reading "¥8M+".
 * The model now names the currency it read, the figure is converted with the
 * board's own factors, and a figure the board cannot compare is dropped and
 * named instead of clamped.
 */
const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

describe("a pay request is compared in the board's currency (S11-026)", () => {
  it("London £45,000 is a floor of about $57k, not $45k", () => {
    const r = validateParse({ q: "analyst", salaryFloor: 45_000, salaryCurrency: "GBP" });
    expect(r.filters.salaryFloor, "a pound figure went to the board as dollars").toBe(57_150);
    expect(r.dropped).toEqual([]);
  });

  it("Tokyo ¥8,000,000 and Bangalore 20 lakh are floors the board can meet, not a $2M clamp", () => {
    expect(validateParse({ salaryFloor: 8_000_000, salaryCurrency: "JPY" }).filters.salaryFloor).toBe(52_800);
    expect(validateParse({ salaryFloor: 2_000_000, salaryCurrency: "INR" }).filters.salaryFloor).toBe(24_000);
  });

  it("a currency the board cannot rank is dropped and named, never read as dollars", () => {
    const r = validateParse({ q: "engineer", salaryFloor: 50_000_000, salaryCurrency: "KRW" });
    expect(r.filters.salaryFloor).toBeUndefined();
    expect(r.dropped).toEqual(["salaryFloor"]);
  });

  it("a figure past $2M is dropped and named, not clamped into a floor nobody asked for", () => {
    const r = validateParse({ salaryFloor: 9_000_000 });
    expect(r.filters).toEqual({});
    expect(r.dropped).toEqual(["salaryFloor"]);
  });

  it("no currency named is US dollars, and a ceiling converts with its floor", () => {
    expect(validateParse({ salaryFloor: 120_000 }).filters.salaryFloor).toBe(120_000);
    const band = validateParse({ salaryFloor: 40_000, salaryCeiling: 60_000, salaryCurrency: "eur" }).filters;
    expect(band).toEqual({ salaryFloor: 43_200, salaryCeiling: 64_800 });
  });

  it("the model is told the unit and asked for it", () => {
    expect(SYSTEM_PROMPT).toMatch(/approximate US dollars/);
    expect(SYSTEM_PROMPT).toMatch(/salaryCurrency/);
    expect(Object.keys(TOOL_PARAMETERS.properties)).toContain("salaryCurrency");
  });

  it("the factors are the board's own: every arm of the salary_rank_usd column, and nothing else", () => {
    const arms: Record<string, number> = {};
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      const sql = sqlCodeOf(readFileSync(resolve(MIGRATIONS, f), "utf8"));
      if (!/salary_rank_usd\s+numeric\s+GENERATED\s+ALWAYS/i.test(sql)) continue;
      const body = sql.slice(sql.search(/CASE\s+salary_currency/i));
      for (const m of body.matchAll(/WHEN\s+'([A-Z]{3})'\s+THEN\s+([0-9.]+)/gi)) arms[m[1].toUpperCase()] = Number(m[2]);
    }
    expect(Object.keys(arms).length, "the generated column's definition was not found").toBeGreaterThan(10);
    expect({ ...BOARD_USD_FACTORS }).toEqual(arms);
  });
});
