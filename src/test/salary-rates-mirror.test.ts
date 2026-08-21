import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE SECOND COPY IS THE ONE THAT GOES STALE.
 *
 * Ordering a ranked search by pay has to happen in the edge function, because
 * search_jobs returns salary_min_annual and salary_currency but NOT
 * salary_rank_usd — and adding a column to its RETURNS TABLE changes the
 * signature, which is exactly the overload that took ranked search down on
 * 2026-08-20. So the currency conversion exists twice: once as a GENERATED
 * column in SQL, once as SALARY_USD_RATES in TypeScript.
 *
 * This codebase normally refuses a second copy on exactly these grounds — the
 * SENDABLE_VENDORS comment says minting the fifth copy is how the list goes
 * stale. The copy is allowed here only because this test makes drift fail
 * loudly: it parses the CASE arms out of the migration and compares them
 * currency by currency.
 *
 * WHY DRIFT WOULD BE INVISIBLE WITHOUT IT. A missing or wrong rate does not
 * error. It silently mis-orders a page — GBP 87,500 (~$111k) sorting below
 * USD 100,000 — and the page still looks like a plausible highest-paid-first
 * list. Nobody can spot that by reading it.
 */
const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/** The CASE arms of the salary_rank_usd generated column — the source of truth. */
const sqlRates = (() => {
  const file = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .find((f) => readFileSync(resolve(MIG_DIR, f), "utf8").includes("salary_rank_usd numeric"));
  expect(file, "no migration defines the salary_rank_usd generated column").toBeTruthy();
  const sql = readFileSync(resolve(MIG_DIR, file!), "utf8");
  // Slice to the generated expression so a rate mentioned in a comment
  // elsewhere in the file cannot be picked up as a real arm.
  const start = sql.indexOf("salary_rank_usd numeric");
  const end = sql.indexOf(") STORED", start);
  const body = sql.slice(start, end > start ? end : undefined);
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/WHEN\s+'([A-Z]{3})'\s+THEN\s+([0-9.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
})();

/** SALARY_USD_RATES as shipped in the edge function. */
const tsRates = (() => {
  const block = /const SALARY_USD_RATES: Record<string, number> = \{([\s\S]*?)\};/.exec(FN)?.[1];
  expect(block, "SALARY_USD_RATES not found in the edge function").toBeTruthy();
  const out: Record<string, number> = {};
  for (const m of block!.matchAll(/([A-Z]{3}):\s*([0-9.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
})();

describe("the TypeScript salary rates mirror the generated column", () => {
  it("parsed both sides, and neither is empty", () => {
    // A parser that silently matches nothing would make every assertion below
    // pass vacuously — the failure mode that has bitten this repo repeatedly.
    expect(Object.keys(sqlRates).length, "no rates parsed out of the migration").toBeGreaterThan(10);
    expect(Object.keys(tsRates).length, "no rates parsed out of the edge function").toBeGreaterThan(10);
  });

  it("covers exactly the same currencies", () => {
    const inSqlOnly = Object.keys(sqlRates).filter((c) => !(c in tsRates)).sort();
    const inTsOnly = Object.keys(tsRates).filter((c) => !(c in sqlRates)).sort();
    expect(
      inSqlOnly,
      `these currencies convert in SQL but not in the edge function, so a ranked salary sort ` +
        `treats them as unpriced and buries them: ${inSqlOnly.join(", ")}`,
    ).toEqual([]);
    expect(
      inTsOnly,
      `these convert in the edge function but not in SQL, so the two sorts disagree: ${inTsOnly.join(", ")}`,
    ).toEqual([]);
  });

  it("agrees on every rate", () => {
    const drift = Object.keys(sqlRates)
      .filter((c) => sqlRates[c] !== tsRates[c])
      .map((c) => `${c}: sql=${sqlRates[c]} ts=${tsRates[c]}`);
    expect(drift, `rates disagree — the browse sort and the ranked sort would order differently:\n${drift.join("\n")}`).toEqual([]);
  });

  it("treats an unpriced or unknown-currency row as last, never first", () => {
    const fn = /function usdRank\(r: Record<string, unknown>\): number \{([\s\S]*?)\n\}/.exec(FN)?.[1] ?? "";
    expect(fn, "usdRank not found").not.toBe("");
    // -Infinity, not 0: a genuine zero salary should still outrank "we have no
    // idea", and an unpriced row must never lead a highest-paid-first page.
    // Two sinks: no usable figure, and a currency with no rate. Counted as
    // occurrences of the sentinel rather than as statements, because the second
    // is a ternary — an assertion shaped around one spelling of the code would
    // fail on a correct refactor and teach the next person to delete it.
    expect(
      (fn.match(/-Infinity/g) ?? []).length,
      "both an unpriced row and an unknown currency must sink to the bottom",
    ).toBe(2);
    // An unknown currency must NOT fall back to 1.0 — that would rank an
    // unconverted foreign figure as though it were dollars.
    expect(/rate === undefined \? -Infinity/.test(fn), "an unknown currency must not default to a rate").toBe(true);
  });

  it("the ranked path sorts by USD, and does so only when salary was asked for", () => {
    expect(/if \(sortSalaryRanked\) \{\s*\n\s*rankedRows\.sort\(\(a, b\) => usdRank\(b\) - usdRank\(a\)\);/.test(FN)).toBe(true);
    expect(/const sortSalaryRanked = body\.sort === "salary";/.test(FN)).toBe(true);
  });
});
