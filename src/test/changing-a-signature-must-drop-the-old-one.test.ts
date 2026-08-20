import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ADDING A PARAMETER DOES NOT REPLACE A FUNCTION. IT OVERLOADS IT.
 *
 * On 2026-08-20 ranked search broke in production for hours. search_jobs and
 * count_jobs_capped each had two definitions — a fourteen-parameter one and a
 * fifteen-parameter one — and PostgREST answered PGRST203, "Could not choose
 * the best candidate function", to every call. The board went on serving rows
 * from the recency fallback, so it LOOKED fine; what was gone was the ranking,
 * and the fuzzy and semantic rescue tiers that sit on that path. "acountant"
 * and "nures" returned nothing at all.
 *
 * The August 7 migration that introduced p_sources had already worked this out
 * and written it in its own header:
 *
 *     "DROP + CREATE, not CREATE OR REPLACE: adding a parameter would
 *      otherwise create an OVERLOAD, and a PostgREST call that omits every
 *      optional param then matches both signatures and 400s as ambiguous."
 *
 * It dropped the old signature deliberately. A later migration re-issued the
 * OLD parameter list under CREATE OR REPLACE and put the overload back.
 *
 * WHY A REVIEWER WOULD NOT CATCH IT. The mistake is invisible at the diff:
 * "CREATE OR REPLACE FUNCTION" is the normal, correct way to edit a function,
 * and it stays correct right up until the parameter list differs from the
 * deployed one by a single argument. Nothing about the statement announces
 * that it is creating a second function rather than editing the first.
 *
 * SO THE RULE IS MECHANICAL: if a migration defines one of these functions
 * with a DIFFERENT NUMBER OF PARAMETERS than the definition before it, that
 * same migration must drop the previous signature. Matching arity is an edit;
 * changing arity is a new function, and a new function obligates a drop.
 */

const DIR = resolve(__dirname, "../../supabase/migrations");

/**
 * Matches BOTH spellings. The outage happened because a search for only
 * "CREATE OR REPLACE FUNCTION public.search_jobs" silently skipped the one
 * migration that declares the live shape — it uses the plain "CREATE FUNCTION"
 * spelling, precisely because it is adding a signature rather than editing one.
 * A guard written with the same blind spot as the bug would pass and prove
 * nothing, so "OR REPLACE" is optional here and must stay optional.
 */
const defRe = (fn: string) =>
  new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");

function paramCount(sql: string, fn: string): number | null {
  const m = defRe(fn).exec(sql);
  if (!m) return null;
  // Walk to the matching close paren rather than using the first ")" — a
  // default like "DEFAULT (now() - interval '1 day')" contains parens, and
  // stopping at the first one would undercount. This repo has already been
  // bitten by regexes that stop at an inner paren.
  const open = m.index + m[0].length - 1;
  let depth = 0, close = -1;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close < 0) return null;
  const sig = sql.slice(open + 1, close);
  // Count only TOP-LEVEL parameter names: a name at depth zero within the
  // signature. Nested parens belong to default expressions.
  let d = 0, count = 0, atStart = true;
  for (let i = 0; i < sig.length; i++) {
    const c = sig[i];
    if (c === "(") d++;
    else if (c === ")") d--;
    else if (c === "," && d === 0) { atStart = true; continue; }
    if (d === 0 && atStart && /\S/.test(c)) { count++; atStart = false; }
  }
  return count;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

describe("changing a function's signature must drop the old one", () => {
  for (const fn of ["search_jobs", "count_jobs_capped"]) {
    it(`${fn}: every arity change in repo history drops the signature it replaces`, () => {
      let prev: { file: string; n: number } | null = null;
      const violations: string[] = [];

      for (const f of files) {
        const sql = readFileSync(resolve(DIR, f), "utf8");
        const n = paramCount(sql, fn);
        if (n === null) continue;

        if (prev && n !== prev.n) {
          const dropsIt = new RegExp(`DROP\\s+FUNCTION[^;]*\\bpublic\\.${fn}\\s*\\(`, "i").test(sql);
          if (!dropsIt) {
            violations.push(
              `${f} defines public.${fn} with ${n} params (previous: ${prev.n}, from ${prev.file}) ` +
                `but contains no DROP FUNCTION public.${fn}(...). That creates an OVERLOAD, not a ` +
                `replacement, and PostgREST answers PGRST203 to every call.`,
            );
          }
        }
        prev = { file: f, n };
      }

      expect(violations, violations.join("\n")).toEqual([]);
    });

    it(`${fn}: the newest definition in the repo is the one with p_sources`, () => {
      // The live shape. If a migration ever lands that defines these without
      // p_sources, the repo's "latest definition" is stale again and the next
      // person to edit from it recreates the outage.
      let newest: { file: string; sql: string } | null = null;
      for (const f of files) {
        const sql = readFileSync(resolve(DIR, f), "utf8");
        if (paramCount(sql, fn) !== null) newest = { file: f, sql };
      }
      expect(newest, `no migration defines public.${fn}`).not.toBeNull();
      expect(
        /p_sources\s+text\[\]/i.test(newest!.sql),
        `The newest migration defining public.${fn} is ${newest!.file}, and it does not declare ` +
          `p_sources. The deployed function has it (DEFAULT NULL, added 20260807064219). Editing ` +
          `${fn} from that file reintroduces the PGRST203 overload.`,
      ).toBe(true);
    });
  }

  it("the parameter counter is not fooled by parens inside a DEFAULT", () => {
    // Break-test of the counter itself, because an undercount here would make
    // every assertion above pass vacuously on the exact files it must judge.
    const sql = `CREATE FUNCTION public.search_jobs(
      p_q text,
      p_cutoff timestamptz DEFAULT (now() - interval '30 days'),
      p_limit integer DEFAULT 60
    ) RETURNS void AS $$ $$ LANGUAGE sql;`;
    expect(paramCount(sql, "search_jobs")).toBe(3);
  });

  it("the counter reads both CREATE spellings, which is the bug it exists for", () => {
    const plain = `CREATE FUNCTION public.search_jobs(p_q text, p_sources text[] DEFAULT NULL) RETURNS void AS $$ $$ LANGUAGE sql;`;
    const replace = `CREATE OR REPLACE FUNCTION public.search_jobs(p_q text) RETURNS void AS $$ $$ LANGUAGE sql;`;
    expect(paramCount(plain, "search_jobs")).toBe(2);
    expect(paramCount(replace, "search_jobs")).toBe(1);
  });
});
