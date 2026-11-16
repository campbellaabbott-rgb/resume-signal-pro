// @vitest-environment node
/**
 * VF-BMS (board .102): a row's pay is parsed under the country the row had
 * when its salary was read. Bristol Myers Squibb's New Brunswick, NJ postings
 * were first placed in New Brunswick, Canada, so '$24.00 - $45.00' was read
 * as CAD. A later sweep moved the row to the United States from the vendor's
 * own detail and left the currency CAD. A sweep that moves the country now
 * re-reads the stored pay under the new country, in the same write, wherever
 * that write carries no other pay (the vendor's figure is written only to a row
 * with no salary, and a description's mined figure is parsed under the new
 * country already).
 *
 * Runs the shipped placeWrite and payUnderPlace, lifted from index.ts, with the
 * real normalize helpers and the real salary parser.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { detectRegion, isPlacelessLocation } from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const fnDecl = (head: string) => {
  const i = FN.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} moved in index.ts; re-point this test`);
  return FN.slice(i + 1, FN.indexOf("\n}\n", i) + 2);
};
type Row = { location: string | null; country: string | null; salary?: string | null; title?: string | null };
const { placeWrite, payUnderPlace } = new Function("detectRegion", "isPlacelessLocation", "parseSalaryStructured",
  ts.transpileModule(`${fnDecl("function placeWrite(")}\n${fnDecl("function payUnderPlace(")}\nreturn { placeWrite, payUnderPlace };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
)(detectRegion, isPlacelessLocation, parseSalaryStructured) as {
  placeWrite: (row: Row, c: string | null, l: string | null, n: number) => Record<string, unknown>;
  payUnderPlace: (row: Row, place: Record<string, unknown>) => Record<string, unknown>;
};
const sweep = (row: Row, vCountry: string | null, vLocation: string | null = null) => {
  const place = placeWrite(row, vCountry, vLocation, 0);
  return { ...place, ...payUnderPlace(row, place) };
};

describe("a sweep that moves the country re-reads the pay", () => {
  const BMS: Row = { location: "New Brunswick", country: "CA", salary: "$24.00 - $45.00", title: "Lab Technician" };

  it("{CA, '$24.00 - $45.00', CAD} moved to US writes USD in the same patch", () => {
    expect(parseSalaryStructured(BMS.salary, "CA")?.currency, "the row as stored reads CAD").toBe("CAD");
    const patch = sweep(BMS, "US");
    expect(patch.country).toBe("US");
    expect(patch.salary_currency).toBe("USD");
    expect(patch.salary_period).toBe(parseSalaryStructured(BMS.salary, "US")?.period);
    expect(patch.salary_min_annual).toBe(parseSalaryStructured(BMS.salary, "US")?.annualMin);
    expect(patch, "the salary text itself is the employer's and is not rewritten").not.toHaveProperty("salary");
  });

  it("a sweep that keeps the country, or a row with no pay, writes no pay field", () => {
    expect(sweep({ ...BMS, country: "US" }, "US")).not.toHaveProperty("salary_currency");
    expect(sweep({ ...BMS, salary: null }, "US")).not.toHaveProperty("salary_currency");
    expect(sweep(BMS, null, "Remote")).not.toHaveProperty("salary_currency");
  });

  it("a pay text that does not parse leaves the stored figures alone rather than blanking them", () => {
    expect(sweep({ ...BMS, salary: "Competitive" }, "US")).not.toHaveProperty("salary_currency");
  });

  it("all three sweep writes carry it, each where no other pay is written, and the structured sweep reads the pay it needs", () => {
    expect(FN).toMatch(/const salv: Record<string, unknown> = \{ \.\.\.placePatch, \.\.\.payUnderPlace\(row, placePatch\) \};/);
    expect(FN, "the vendor's figure is written only to a row with no salary, so the two never meet").toMatch(/if \(vendorPay && !row\.salary\) \{\n\s*const salvParse = /);
    expect(FN).toMatch(/salary_currency: statedParse\?\.currency \?\? null,\n\s*\} : payUnderPlace\(row, placePatch\)\),/);
    expect(FN).toMatch(/\.select\("id, company_token, apply_url, posted_at, work_mode, location, country, salary, title"\)/);
    expect(FN).toMatch(/const place = placeWrite\(row, vCountry, vLocation, additionalSites\);\n\s*Object\.assign\(patch, place, payUnderPlace\(row, place\)\);/);
  });
});
