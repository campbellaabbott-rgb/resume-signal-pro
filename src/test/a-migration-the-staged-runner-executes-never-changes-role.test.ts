/**
 * A MIGRATION THE STAGED RUNNER EXECUTES NEVER CHANGES ROLE.
 *
 * Lovable applies most migrations through public._mig_exec(p_sql)
 * (drizzle/migrations/0020_mig_exec_helper.sql), a SECURITY DEFINER function
 * that EXECUTEs the staged file. PostgreSQL refuses to set "role" inside a
 * security-definer function (42501), so a file that switches role anywhere,
 * a self-check included, raises and rolls back there, while the pglite guards
 * that run the same file inline pass. 20261012130000's self-check did exactly
 * that: four role switches, the first outside any exception block.
 *
 * The rule covers every migration from the ledger's drizzle baseline on (the
 * files the runner can still be handed). The only files that ever switched
 * role are from before the runner existed, and the positive control below
 * proves this guard finds one of them, so it is not passing on an empty scan.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(__dirname, "../../supabase/migrations");
const LEDGER = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8")) as { drizzleBaseline: string };
const FILES = readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

/** The SQL a server executes: line comments and block comments out. */
function sqlWithoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ROLE_SWITCH = /\bSET\s+(?:LOCAL\s+|SESSION\s+)?ROLE\b|\bSET\s+(?:LOCAL\s+|SESSION\s+)?SESSION\s+AUTHORIZATION\b/i;

describe("no migration the staged runner can be handed switches role", () => {
  const scoped = FILES.filter((f) => f.slice(0, 14) >= LEDGER.drizzleBaseline);

  it("scans the files from the drizzle baseline on (this round's included)", () => {
    expect(scoped.length).toBeGreaterThan(50);
    expect(scoped.some((f) => f.startsWith("20261012130000_"))).toBe(true);
  });

  it("finds a role switch where one exists (positive control on a pre-runner file)", () => {
    const old = FILES.find((f) => f.startsWith("20260827130000_"));
    expect(old, "the pre-runner control file").toBeTruthy();
    expect(ROLE_SWITCH.test(sqlWithoutComments(readFileSync(resolve(DIR, old!), "utf8")))).toBe(true);
    expect(ROLE_SWITCH.test(sqlWithoutComments("-- SET LOCAL ROLE anon;\nSELECT 1;"))).toBe(false);
  });

  it("none of them switches role outside a comment", () => {
    const bad = scoped.filter((f) => ROLE_SWITCH.test(sqlWithoutComments(readFileSync(resolve(DIR, f), "utf8"))));
    expect(bad).toEqual([]);
  });

  it("the refusal is real: PostgreSQL rejects a role switch inside the runner's definer, and accepts it inline", async () => {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon;
      CREATE FUNCTION public._mig_exec(p_sql text) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$ BEGIN EXECUTE p_sql; END; $fn$;`);
    const block = "DO $$ BEGIN SET LOCAL ROLE anon; PERFORM 1; RESET ROLE; END $$;";
    await expect(db.exec(block)).resolves.toBeDefined();
    await expect(db.query("SELECT public._mig_exec($1)", [block])).rejects.toThrow(/cannot set parameter "role" within security-definer function/);
  });
});
