import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { sanitizeTerm } from "../../supabase/functions/_shared/location-terms";
import { normalizeFilters, salaryFromQueryText, salaryTokenInQuery } from "../../supabase/functions/job-board/filters.ts";

/**
 * A YEAR, A 401K OR A FORM NUMBER IS NOT A PAY FLOOR (L8-17, old 1.39), AND THE
 * WORD REMOVED IS THE ONE THE FLOOR CAME FROM (L8-03).
 *
 * salaryFromQueryText took any token from 1,000 to 2,000,000: q="new grad
 * 2026" became a $2,026 floor (total 76 against a related 1,648), "401k" a
 * $401,000 floor with a spine surgeon on top, "1099 sales" a $1,099 floor.
 * And queryTerms stripped the FIRST bare number it saw rather than the money
 * token: "python 3 120k" searched titles for "python" AND "120k" under a $120k
 * floor, the "3" silently gone (5-7 junk rows; "python 120k" gives 72).
 *
 * The shipped queryTerms is extracted from index.ts and run.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const queryTerms = (() => {
  const pick = (re: RegExp) => re.exec(RAW)?.[0] ?? "";
  const src = [
    pick(/const QUERY_FILLER = new Set\(\[[\s\S]*?\]\);/),
    pick(/function queryTerms\([\s\S]*?\n\}/),
    "return queryTerms;",
  ].join("\n");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("sanitizeTerm", "salaryTokenInQuery", js)(sanitizeTerm, salaryTokenInQuery) as (raw: unknown) => { terms: string[]; dropped: string[]; liftedSalary: boolean };
})();

describe("only a figure that cannot be anything else is money", () => {
  it("a year, 401k, a 1099, a GPU model or a zip code is a word, not a floor", () => {
    for (const q of ["new grad 2026", "401k", "401k plan administrator", "1099 sales", "rtx 4090 driver engineer", "nurse 94105"]) {
      expect(salaryFromQueryText(q), q).toBeNull();
      expect(normalizeFilters({ q }, 64).applied.salaryFloor, q).toBeNull();
    }
  });

  it("a $, a comma, a k or a trailing + still lifts, and so does a bare six-figure number", () => {
    const cases: Array<[string, number, string]> = [
      ["100k engineer", 100_000, "100k"],
      ["$80,000 analyst", 80_000, "$80,000"],
      ["nurse 95k+", 95_000, "95k+"],
      ["120000", 120_000, "120000"],
      ["$401k", 401_000, "$401k"],
      ["accountant 75000+", 75_000, "75000+"],
    ];
    for (const [q, floor, token] of cases) expect(salaryTokenInQuery(q), q).toEqual({ floor, token });
  });
});

describe("the token removed from the search is the one the floor came from", () => {
  it("python 3 120k keeps python and 3, and searches neither 120k nor drops the 3", () => {
    const r = queryTerms("python 3 120k");
    expect(r.terms).toEqual(["python", "3"]);
    expect(r.liftedSalary).toBe(true);
  });

  it("level 2 60k is a Level 2 search under a $60k floor", () => {
    expect(queryTerms("level 2 60k").terms).toEqual(["level", "2"]);
  });

  it("new grad 2026 searches all three words and lifts nothing", () => {
    const r = queryTerms("new grad 2026");
    expect(r.terms).toEqual(["new", "grad", "2026"]);
    expect(r.liftedSalary).toBe(false);
  });

  it("a money-only query still yields no terms", () => {
    expect(queryTerms("120k")).toEqual({ terms: [], dropped: [], liftedSalary: true });
  });
});
