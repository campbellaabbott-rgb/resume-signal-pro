import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE DEPLOY RUNNER READ A TABLE ANYONE COULD WRITE.
 *
 * Measured 2026-09-15 with the public anon key: public._mig_stage -- the
 * table the deploy runner stages migration text in and executes from through
 * the SECURITY DEFINER public._mig_exec(text) -- answered 200 with rows to a
 * SELECT and 204 to an UPDATE and a DELETE, and an INSERT with a NULL key
 * reached the NOT NULL constraint. The function itself was revoked from anon
 * and authenticated (42501); the table it reads was not. A visitor could
 * rewrite staged SQL and have the runner execute it as the definer.
 *
 * 20260915090000 closes it. This guard states the properties of that file,
 * over its COMMENT-STRIPPED code, and keeps later migrations from reopening
 * the hole:
 *   * the REVOKE names anon AND authenticated, not PUBLIC alone
 *     (revoking-from-public-does-not-revoke-from-anon);
 *   * ROW LEVEL SECURITY is enabled and pre-existing policies are dropped;
 *   * the only policy the file creates is for the runner's role;
 *   * everything is guarded by to_regclass / to_regprocedure so a database
 *     without the runner's objects applies it as a no-op;
 *   * no migration stamped after it grants either table to a client role or
 *     creates a policy for one.
 *
 * And one lesson, for the reader who comes to widen the sweep: the eight
 * September tables that answered 200 [] to the same probes are RLS-locked in
 * their creating migrations. A 200 [] under RLS is NOT exposure. Only a probe
 * that returns rows or moves one is a finding -- which is why this file pins
 * the measured evidence (rows came back) in its header and not a status code.
 */

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const LOCK = files.find((f) => f.startsWith("20260915090000_"));

/** Code only: no line comments, no block comments, no string literals. */
export function codeOnly(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
}

/** The properties of the lock, as a list of violations (empty = holds). */
export function lockViolations(sql: string): string[] {
  const code = codeOnly(sql);
  const v: string[] = [];
  // format('%I') hides the table name from a naive scan; the table list is a
  // literal array the DO block loops over, so pin the list, then the shape.
  if (!/ARRAY\s*\[\s*''\s*,\s*''\s*\]/.test(code) || !/'_mig_stage'\s*,\s*'_mig_probe'/.test(sql)) v.push("the table list must be exactly _mig_stage and _mig_probe");
  if (!/REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/.test(sql)) v.push("the REVOKE must name PUBLIC, anon AND authenticated");
  if (!/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/.test(sql)) v.push("RLS must be enabled");
  if (!/FROM pg_policies WHERE schemaname = ''\s*AND tablename = t/.test(code) || !/DROP POLICY IF EXISTS %I ON public\.%I/.test(sql)) v.push("every pre-existing policy must be dropped");
  if (!/GRANT ALL ON TABLE public\.%I TO service_role/.test(sql)) v.push("service_role keeps ALL");
  if (!/CREATE POLICY %I ON public\.%I FOR ALL TO sandbox_exec USING \(true\) WITH CHECK \(true\)/.test(sql)) v.push("the runner's policy is the only one created, and only for sandbox_exec");
  if ((sql.match(/CREATE POLICY/g) ?? []).length !== 1) v.push("exactly one CREATE POLICY");
  if (!/to_regclass\(''\s*\|\|\s*t\)\s+IS NULL/.test(code)) v.push("guarded by to_regclass");
  if (!/to_regprocedure\(''\)\s+IS NOT NULL/.test(code) || !/REVOKE ALL ON FUNCTION public\._mig_exec\(text\) FROM PUBLIC, anon, authenticated/.test(sql)) v.push("the helper's REVOKE is re-asserted by name, guarded by to_regprocedure");
  if (/CREATE TABLE|DROP TABLE|DROP FUNCTION|CREATE (OR REPLACE )?FUNCTION/i.test(code)) v.push("the file must not create or drop the runner's objects");
  return v;
}

describe("the deploy runner read a table anyone could write", () => {
  it("ships the lock, stamped after the last file the runner staged", () => {
    expect(LOCK, "20260915090000 is missing").toBeDefined();
    const last = files.filter((f) => f < LOCK!).pop();
    expect(last?.startsWith("20260909228000_")).toBe(true);
  });

  it("the lock holds every property", () => {
    expect(lockViolations(readFileSync(resolve(DIR, LOCK!), "utf8"))).toEqual([]);
  });

  it("the header carries the measured evidence: rows came back, not a status code alone", () => {
    const sql = readFileSync(resolve(DIR, LOCK!), "utf8");
    expect(sql).toMatch(/200, eight rows/);
    expect(sql).toMatch(/23502/);
    expect(sql).toMatch(/200 \[\] under RLS is indistinguishable/);
  });

  it("no migration after the lock grants either table to a client role or adds a client policy", () => {
    const later = files.filter((f) => f > LOCK!);
    const bad: string[] = [];
    for (const f of later) {
      const code = codeOnly(readFileSync(resolve(DIR, f), "utf8"));
      if (/GRANT[^;]*\b_mig_(stage|probe)\b[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(code)) bad.push(`${f}: grant`);
      if (/CREATE POLICY[^;]*\bON public\._mig_(stage|probe)\b[^;]*\bTO\b[^;]*\b(anon|authenticated|public)\b/i.test(code)) bad.push(`${f}: policy`);
    }
    expect(bad).toEqual([]);
  });

  it("the harness exists and runs the lock twice (idempotence is a claim the header makes)", () => {
    const h = readFileSync(resolve(__dirname, "../../scripts/verify-migration-20260915090000.mjs"), "utf8");
    expect(h).toMatch(/20260915090000_a_staging_table_anyone_can_rewrite_runs_as_the_definer\.sql/);
    expect((h.match(/await db\.exec\(sql\)/g) ?? []).length).toBeGreaterThanOrEqual(3); // no-op run, the lock, the second run
    expect(h).toMatch(/has_table_privilege/);
    expect(h).toMatch(/TEETH: before the lock anon holds/);
  });
});

describe("the deploy runner read a table anyone could write — has teeth", () => {
  const good = () => readFileSync(resolve(DIR, LOCK!), "utf8");
  it("a REVOKE from PUBLIC alone fails", () => {
    const sql = good().replace("FROM PUBLIC, anon, authenticated', t)", "FROM PUBLIC', t)");
    expect(lockViolations(sql)).toContain("the REVOKE must name PUBLIC, anon AND authenticated");
  });
  it("a lock that forgets RLS fails", () => {
    const sql = good().replace("ENABLE ROW LEVEL SECURITY', t)", "DISABLE ROW LEVEL SECURITY', t)");
    expect(lockViolations(sql)).toContain("RLS must be enabled");
  });
  it("a second policy, or one for a client role, fails", () => {
    const sql = good().replace("END LOOP;\n\n  IF to_regprocedure", "END LOOP;\n  EXECUTE 'CREATE POLICY open_again ON public._mig_stage FOR SELECT TO anon USING (true)';\n\n  IF to_regprocedure");
    expect(lockViolations(sql)).toContain("exactly one CREATE POLICY");
  });
  it("a file that reaches for DROP TABLE fails", () => {
    const sql = good() + "\nDROP TABLE public._mig_stage;\n";
    expect(lockViolations(sql)).toContain("the file must not create or drop the runner's objects");
  });
  it("the required literals live in code, not in the header", () => {
    // Strip the file to its header only: every property must then fail.
    const header = good().split("\nDO $lock$")[0];
    expect(lockViolations(header).length).toBeGreaterThanOrEqual(6);
  });
});
