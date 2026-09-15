// Runs 20260915090000 in pglite against the runner's own tables, recreated
// here in the exposed state that was measured live (anon and authenticated
// holding every privilege on _mig_stage, no RLS), and proves:
//   * before the migration the hole is real in this harness -- anon CAN
//     select, insert, update and delete (so the checks below have teeth);
//   * after it, anon and authenticated hold NO privilege on _mig_stage or
//     _mig_probe; PUBLIC holds none; service_role and sandbox_exec hold ALL;
//   * ROW LEVEL SECURITY is on for both, every pre-existing policy is gone,
//     and exactly one policy remains per table -- the runner's;
//   * _mig_exec(text) is not executable by anon, authenticated or PUBLIC;
//   * the file is idempotent: a second run changes nothing and raises nothing;
//   * on a database WITHOUT the runner's objects the file is a no-op (NOTICE),
//     which is what a fresh environment sees.
// Usage: node scripts/verify-migration-20260915090000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = "20260915090000_a_staging_table_anyone_can_rewrite_runs_as_the_definer.sql";
const sql = readFileSync(`supabase/migrations/${MIG}`, "utf8");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const db = new PGlite();
const rows = async (q, params) => (await db.query(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];
const priv = (role, table, p) => one(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, p]).then((r) => r.ok);
const fnPriv = (role) => one(`SELECT has_function_privilege($1, 'public._mig_exec(text)', 'EXECUTE') AS ok`, [role]).then((r) => r.ok);
const rls = (table) => one(`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)`, [`public.${table}`]).then((r) => r.relrowsecurity);
const policies = (table) => rows(`SELECT policyname, roles::text AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [table]);

// ---- 1. a fresh database with none of the runner's objects: a no-op --------
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
let threw = "";
try { await db.exec(sql); } catch (e) { threw = String(e?.message ?? e); }
check("without the runner's objects the file applies as a no-op", threw === "", threw);

// ---- 2. the exposed state measured live, rebuilt ---------------------------
await db.exec(`
  CREATE ROLE sandbox_exec;
  CREATE TABLE public._mig_stage (name text PRIMARY KEY, sql text, applied_at timestamptz);
  CREATE TABLE public._mig_probe (k text PRIMARY KEY, v text);
  GRANT ALL ON TABLE public._mig_stage TO PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public._mig_probe TO anon;
  CREATE POLICY stray_open ON public._mig_stage FOR SELECT TO anon USING (true);
  CREATE OR REPLACE FUNCTION public._mig_exec(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$ BEGIN EXECUTE p_sql; END; $fn$;
  GRANT EXECUTE ON FUNCTION public._mig_exec(text) TO anon;
  INSERT INTO public._mig_stage (name, sql, applied_at) VALUES ('20260909224000_a_proposal_is_not_a_move.sql', 'SELECT 1', now());
`);
for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) check(`TEETH: before the lock anon holds ${p} on _mig_stage`, await priv("anon", "_mig_stage", p) === true);
check("TEETH: before the lock anon can execute _mig_exec", await fnPriv("anon") === true);
check("TEETH: before the lock RLS is off on _mig_stage", await rls("_mig_stage") === false);

// ---- 3. apply ----------------------------------------------------------------
await db.exec(sql);
for (const t of ["_mig_stage", "_mig_probe"]) {
  for (const role of ["anon", "authenticated"]) for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"])
    check(`${role} holds no ${p} on ${t}`, await priv(role, t, p) === false);
  // PUBLIC: a role that inherits only from PUBLIC must see nothing either.
  await db.exec(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nobody_probe') THEN CREATE ROLE nobody_probe; END IF; END $$;`);
  check(`PUBLIC holds no SELECT on ${t}`, await priv("nobody_probe", t, "SELECT") === false);
  check(`service_role holds ALL on ${t}`, (await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => priv("service_role", t, p)))).every(Boolean));
  check(`sandbox_exec holds ALL on ${t}`, (await Promise.all(["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => priv("sandbox_exec", t, p)))).every(Boolean));
  check(`RLS is on for ${t}`, await rls(t) === true);
  const pol = await policies(t);
  check(`exactly one policy remains on ${t}, the runner's`, pol.length === 1 && pol[0].policyname === `${t}_runner_only` && /sandbox_exec/.test(pol[0].roles), JSON.stringify(pol));
}
for (const role of ["anon", "authenticated", "nobody_probe"]) check(`${role} cannot execute _mig_exec`, await fnPriv(role) === false);
check("the staged row is still there (the lock deletes nothing)", (await one(`SELECT count(*)::int AS n FROM public._mig_stage`)).n === 1);

// ---- 4. idempotent ------------------------------------------------------------
threw = "";
try { await db.exec(sql); } catch (e) { threw = String(e?.message ?? e); }
check("a second run applies cleanly", threw === "", threw);
check("a second run leaves one policy per table", (await policies("_mig_stage")).length === 1 && (await policies("_mig_probe")).length === 1);
check("a second run leaves anon with nothing", await priv("anon", "_mig_stage", "SELECT") === false);

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
