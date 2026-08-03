/**
 * THE FRONT DOOR WAS BILLED FOR THE WHOLE HOUSE.
 *
 * MEASURED 2026-08-03, one IP, inside a single minute:
 *
 *   job-board       200   writes a rate_limits row, does NOT enforce the budget
 *   parse-pdf       429
 *   parse-docx      429   its own 20/hr bucket untouched -> the GLOBAL gate fired
 *   create-checkout 429
 *
 * `check_global_rate_limit` summed `request_count` over EVERY row for an IP.
 * Rows are written by anything calling `check_rate_limit` — 36 functions,
 * including job-board-fit (120/day), nl-search and application-fit. Only SIX
 * functions enforced the 100/hr ceiling, and those six are the front door:
 * résumé upload, the free scanner, and CHECKOUT.
 *
 * So an hour of ordinary job-board browsing could leave a candidate unable to
 * upload a CV or pay, while the board that spent their budget kept answering
 * perfectly. It reached me as "a lot of PDF parse failures" — and not one byte
 * of those PDFs ever reached the parser.
 *
 * THE INVARIANT, and why it is two-sided:
 *
 *   counted ⊆ enforcers   — you may only be charged by a call that can refuse
 *                           you. This is the half that was broken.
 *   enforcers ∩ writers ⊆ counted
 *                         — an enforcer that writes its own row must be counted,
 *                           or it escapes the budget it imposes on everyone else.
 *
 * Both sets are DERIVED FROM SOURCE here rather than restated, because a list I
 * type by hand is a test of my memory. Adding a seventh enforcer, or teaching an
 * existing one to write a row, fails this until the SQL array is updated.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FN_DIR = resolve(__dirname, "../../supabase/functions");
const MIGRATION = resolve(
  __dirname,
  "../../supabase/migrations/20260803170000_rate_budget_counts_only_what_it_gates.sql",
);

const fnNames = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .filter((n) => existsSync(resolve(FN_DIR, n, "index.ts")));

const src = (fn: string) => readFileSync(resolve(FN_DIR, fn, "index.ts"), "utf8");

/** Functions that call check_global_rate_limit — i.e. that can refuse on the budget. */
const enforcers = fnNames.filter((f) => src(f).includes("check_global_rate_limit"));

/**
 * Literal p_function values each enforcer writes. Template literals
 * (`alert:${alertType}`) are deliberately skipped: those are email-send buckets,
 * a different concern from the request budget, and they are not counted.
 */
const writesOf = (fn: string): string[] => {
  const out: string[] = [];
  const body = src(fn);
  const re = /p_function:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
};

/** The ARRAY[...] the SQL actually sums over. Parsed, not assumed. */
const countedInSql = (): string[] => {
  const sql = readFileSync(MIGRATION, "utf8");
  const marker = "v_budgeted TEXT[] := ARRAY[";
  const start = sql.indexOf(marker);
  expect(start, "the budgeted-set array was renamed or removed").toBeGreaterThan(-1);
  // Scan from AFTER the opening bracket: `TEXT[]` contains a `]` of its own, and
  // closing on the first one found returned an empty set — which made the
  // subset assertions pass vacuously in one direction.
  const from = start + marker.length;
  const end = sql.indexOf("]", from);
  expect(end, "the budgeted-set array is unterminated").toBeGreaterThan(from);
  const names = [...sql.slice(from, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(names.length, "parsed an empty budgeted set — the assertions below would be vacuous")
    .toBeGreaterThan(0);
  return names;
};

describe("the request budget counts only what it gates", () => {
  it("finds the enforcers in source (the derivation itself must work)", () => {
    // If this ever returns [] the two assertions below pass vacuously and the
    // suite would go green on a file it never read.
    expect(enforcers.length).toBeGreaterThanOrEqual(6);
    expect(enforcers).toContain("parse-pdf");
    expect(enforcers).toContain("create-checkout");
  });

  it("counted ⊆ enforcers — nothing is charged for a gate it cannot trip", () => {
    const counted = countedInSql();
    expect(counted.length).toBeGreaterThan(0);
    const strays = counted.filter((c) => !enforcers.includes(c));
    expect(strays, `counted but does not enforce the budget: ${strays.join(", ")}`).toEqual([]);
  });

  it("every enforcer that writes a row is counted — none escapes its own budget", () => {
    const counted = countedInSql();
    const escaped = enforcers.flatMap(writesOf).filter((w) => !counted.includes(w));
    expect(escaped, `enforces the budget but is not counted by it: ${escaped.join(", ")}`).toEqual([]);
  });

  it("the board is NOT counted — the regression, named", () => {
    // job-board writes `job-board-fit` at 120/day and enforces nothing. It is
    // the specific row that exhausted résumé upload and checkout.
    const counted = countedInSql();
    expect(counted).not.toContain("job-board-fit");
    expect(counted).not.toContain("nl-search");
    expect(counted).not.toContain("application-fit");
  });

  it("the SQL still filters on function_name — scoping it is the whole fix", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // Without this predicate the ARRAY is decorative and the bug is back.
    expect(sql, "the sum is unscoped again").toMatch(/function_name\s*=\s*ANY\(v_budgeted\)/);
  });

  it("keeps the boolean signature, so deploy order cannot break the callers", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    // The six callers ship independently of the migration; both orderings must
    // be safe, which requires the signature and return type to be unchanged.
    const decl = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.check_global_rate_limit"));
    expect(decl).toMatch(/p_ip text/);
    expect(decl).toMatch(/p_max_requests integer DEFAULT 100/);
    expect(decl).toMatch(/p_window_minutes integer DEFAULT 60/);
    expect(decl.slice(0, 400)).toMatch(/RETURNS boolean/);
  });
});

/**
 * A 429 THAT CANNOT SAY WHICH LIMIT FIRED IS NOT A MEASUREMENT.
 *
 * Both limits returned byte-identical text. Diagnosing this meant a differential
 * probe across two functions, because the response itself could not distinguish
 * "you personally uploaded too many PDFs" (fair, 20/hr) from "your budget was
 * spent by a surface you were not using" (the bug). Same answer, two very
 * different states.
 */
describe("a 429 says which limit fired", () => {
  for (const fn of ["parse-pdf", "parse-docx", "scrape-linkedin", "create-checkout"]) {
    it(`${fn} distinguishes the budget from its own ceiling`, () => {
      const body = src(fn);
      expect(body, "budget refusal is unlabelled").toContain("rate_limited_budget");
      expect(body, "per-function refusal is unlabelled").toContain("rate_limited_function");
    });
  }

  it("analyze-resume labels the budget refusal (it enforces but never writes)", () => {
    expect(src("analyze-resume")).toContain("rate_limited_budget");
  });

  it("free-keyword-scan labels the budget refusal", () => {
    expect(src("free-keyword-scan")).toContain("rate_limited_budget");
  });

  it("every enforcer sends Retry-After, so the caller is told when to come back", () => {
    for (const fn of enforcers) {
      expect(src(fn), `${fn} 429s without telling the caller when to retry`)
        .toMatch(/["']Retry-After["']:\s*["']\d+["']/);
    }
  });
});
