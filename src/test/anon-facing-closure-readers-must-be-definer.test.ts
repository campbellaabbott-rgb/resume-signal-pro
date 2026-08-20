import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A LOCK MIGRATION CLAIMED "WHAT BREAKS: nothing" AND BROKE TWO PAGES.
 *
 * 20260818110000 dropped the public SELECT policy on job_board_closures —
 * right call, the raw lifecycle log should never have been anon-readable. Its
 * comment then asserted that every public surface reading closure data was a
 * SECURITY DEFINER aggregate. That was checked by READING, not by running, and
 * it was false for two functions.
 *
 * get_hiring_trends and get_trending_categories were SECURITY INVOKER, granted
 * to anon, and read job_board_closures. Under the new policy they saw zero
 * rows — and neither errored. Measured live: get_hiring_trends returned ONE
 * week with closed:0, so /hiring-trends published "no roles filled or closed"
 * as a fact about the labour market for two days. The control that proves it:
 * get_employer_benchmarks, SECURITY DEFINER, same table, same minute, reported
 * observed_days 37.
 *
 * A permission failure arriving as an empty AGGREGATE is indistinguishable
 * from "the data says zero". Nothing went red. I checked those RPCs after the
 * lockdown, saw HTTP 200, and moved on — the 200 was the trap.
 *
 * So this encodes the assertion the migration only made in prose: any function
 * exposed to anon that reads a locked table must be DEFINER, or it silently
 * publishes emptiness.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
// job_board_company_snapshots joined this list 2026-08-20. The closure log had
// been locked since the 18th while the per-company daily series sat fully
// anon-readable at 733,665 rows — an anonymous caller could page it and
// reconstruct every company's hiring curve for the last month, which is the
// same asset the closure lock was protecting, in a more convenient shape.
// Adding it here is what makes the DEFINER check cover its readers too.
const LOCKED_TABLES = [
  "job_board_closures",
  "job_board_exits",
  "job_board_pool_samples",
  "job_board_company_snapshots",
];

/** Latest CREATE of each function — Lovable re-stamps migrations, so filename
 *  order is the only ordering available and later files supersede.
 *
 *  CAVEAT THIS TEST CANNOT FIX, recorded so nobody trusts it too far: the
 *  last-sorting definition is not always the DEPLOYED one, because a re-stamped
 *  hash-named file can sort earlier while carrying newer SQL. That bit during
 *  this very fix — the last-sorting get_ghost_job_index_stats predates the
 *  stats-rollup rewrite. This test is therefore a check on the REPO's intent,
 *  not proof about production; the live probe is what proves production. */
function latestDefinitions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(DIR).sort()) {
    const sql = readFileSync(resolve(DIR, f), "utf8");
    for (const m of sql.matchAll(
      /CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\$\$;/g,
    )) {
      out.set(m[1], m[0]);
    }
  }
  return out;
}

/** Functions later ALTERed to SECURITY DEFINER.
 *
 *  The mode can be set two ways and a guard that knows only one of them is
 *  worse than none — it would fail on a correctly-fixed function and push the
 *  next person toward CREATE OR REPLACE, which is exactly the operation that
 *  risks reverting a body to an older revision. */
function alteredToDefiner(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(DIR).sort()) {
    const sql = readFileSync(resolve(DIR, f), "utf8");
    for (const m of sql.matchAll(
      /ALTER FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s+SECURITY DEFINER\s*;/g,
    )) {
      out.add(m[1]);
    }
  }
  return out;
}

describe("no anon-facing function reads a locked table as INVOKER", () => {
  const defs = latestDefinitions();
  const altered = alteredToDefiner();
  const isDefiner = (name: string, def: string) =>
    /SECURITY DEFINER/.test(def) || altered.has(name);

  it("found the functions it is checking (guards the guard)", () => {
    expect(defs.has("get_hiring_trends")).toBe(true);
    expect(defs.has("get_trending_categories")).toBe(true);
    expect(defs.size).toBeGreaterThan(20);
  });

  it("every closure-reading function granted to anon is SECURITY DEFINER", () => {
    const offenders: string[] = [];
    for (const [name, def] of defs) {
      const readsLocked = LOCKED_TABLES.some((t) => def.includes(t));
      if (!readsLocked) continue;
      // Is it exposed to anon anywhere in the migrations?
      const grantedToAnon = readdirSync(DIR).some((f) => {
        const sql = readFileSync(resolve(DIR, f), "utf8");
        return new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO[^;]*anon`).test(sql);
      });
      if (!grantedToAnon) continue;
      if (!isDefiner(name, def)) offenders.push(name);
    }
    expect(
      offenders,
      `these read a locked table, are granted to anon, and are SECURITY INVOKER — ` +
        `they will silently return EMPTY rather than error: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("all four that broke are specifically fixed", () => {
    for (const name of [
      "get_hiring_trends", "get_trending_categories",
      "get_takedowns_today", "get_ghost_job_index_stats",
    ]) {
      expect(isDefiner(name, defs.get(name) ?? ""), `${name} must be DEFINER`).toBe(true);
    }
  });

  it("every DEFINER-by-ALTER also has its search_path pinned", () => {
    // A definer function without a pinned search_path is its own
    // vulnerability, and ALTER ... SECURITY DEFINER does not add one.
    const all = readdirSync(DIR).map((f) => readFileSync(resolve(DIR, f), "utf8")).join("\n");
    for (const name of altered) {
      expect(
        new RegExp(`ALTER FUNCTION\\s+public\\.${name}\\s*\\([^)]*\\)\\s+SET search_path`).test(all)
          || /SET search_path = public/.test(defs.get(name) ?? ""),
        `${name} is DEFINER but its search_path is not pinned`,
      ).toBe(true);
    }
  });

  it("still aggregates — a DEFINER that returns raw rows would leak the log", () => {
    // The justification for DEFINER here is that these return counts, never a
    // closure row. If one ever selects * from the log, the exemption is void.
    for (const name of ["get_hiring_trends", "get_trending_categories"]) {
      const def = defs.get(name)!;
      expect(def).not.toMatch(/SELECT \*\s+FROM public\.job_board_closures/);
      expect(def).toMatch(/count\(\*\)|min\(closed_at\)/);
    }
  });
});
