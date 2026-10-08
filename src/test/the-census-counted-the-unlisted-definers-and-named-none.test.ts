// @vitest-environment node
/**
 * THE CENSUS COUNTED THE UNLISTED DEFINERS AND NAMED NONE.
 *
 * client_callable_census() (20261004110000) answers the publishable key with
 * counts only — on purpose, since the list is a map for a stranger. It reported
 * two client-callable SECURITY DEFINER functions that no list describes, and
 * nothing let the owner learn which two without a SQL console.
 *
 * 20261008141000 adds client_callable_unlisted_names(), executed here in a real
 * Postgres (pglite) beside the census's own CREATE statement, cut out of the
 * census migration unchanged. The properties, each run:
 *   - it names exactly the definers the census counts as unlisted, with the
 *     client role that can call each, and says the two agree;
 *   - it never names a listed function, an INVOKER one, a trigger function or
 *     a definer closed to both client roles;
 *   - anon and authenticated are refused it; service_role can call it;
 *   - it follows the census's lists, not a copy: a census re-issued with one
 *     more entry stops that function being named;
 *   - a census rewritten in a shape the parse cannot read fails the apply;
 *   - after replaying every migration's grants, each catalogue reader admin-ops
 *     serves is an INVOKER function no client role can execute.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { anonCan, authenticatedCan, migrationReplay, splitStatements } from "./helpers/function-acl";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), "utf8");
const MIGRATION = file("20261008141000_");
const CENSUS_FILE = file("20261004110000_");
/** The census's CREATE and its two grant statements, exactly as shipped. */
const CENSUS = splitStatements(CENSUS_FILE)
  .filter((s) => /^\s*(CREATE OR REPLACE FUNCTION|REVOKE ALL ON FUNCTION|GRANT EXECUTE ON FUNCTION) public\.client_callable_census\(\)/.test(s))
  .map((s) => `${s.trim()};`);

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(census: string[] = CENSUS): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  for (const st of census) await db.exec(st);
  await db.exec(`
    -- Listed in the census (allow_anon), with Supabase's default grants.
    CREATE FUNCTION public.get_hiring_trends() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    GRANT EXECUTE ON FUNCTION public.get_hiring_trends() TO anon, authenticated, service_role;
    -- In no list, open to both client roles.
    CREATE FUNCTION public.stray_reader(p integer) RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT p $$;
    GRANT EXECUTE ON FUNCTION public.stray_reader(integer) TO anon, authenticated, service_role;
    -- In no list, signed-in only.
    CREATE FUNCTION public.stray_writer(p text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    REVOKE ALL ON FUNCTION public.stray_writer(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.stray_writer(text) TO authenticated, service_role;
    -- In no list but closed to clients: not the owner's problem here.
    CREATE FUNCTION public.closed_definer() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    REVOKE ALL ON FUNCTION public.closed_definer() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.closed_definer() TO service_role;
    -- Open, but INVOKER: it runs with the caller's own rights.
    CREATE FUNCTION public.invoker_open() RETURNS void LANGUAGE sql AS $$ SELECT $$;
    -- A definer trigger function: PostgREST cannot call it.
    CREATE FUNCTION public.definer_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
  `);
  return db;
}

type Names = {
  unlisted: Array<{ signature: string; anon: boolean; authenticated: boolean }>;
  census_unlisted_client_callable: number; agrees: boolean; census_signatures_read: number;
};

async function namesAs(db: PGlite, role: string): Promise<Names> {
  await db.exec(`SET ROLE ${role}`);
  try {
    const { rows } = await db.query<{ r: Names }>("SELECT public.client_callable_unlisted_names() AS r");
    return rows[0].r;
  } finally {
    await db.exec("RESET ROLE");
  }
}

describe("the owner can read which client-callable definers no list names", () => {
  it("found the census statement to run beside it (guards the guard)", () => {
    expect(CENSUS.length).toBe(3);
    expect(CENSUS[0]).toMatch(/SECURITY INVOKER/);
  });

  it("names exactly the definers the census counts as unlisted, with who can call each", async () => {
    const db = await boot();
    await db.exec(MIGRATION);
    const r = await namesAs(db, "service_role");
    expect(r.unlisted).toEqual([
      { signature: "public.stray_reader(integer)", anon: true, authenticated: true },
      { signature: "public.stray_writer(text)", anon: false, authenticated: true },
    ]);
    expect(r.census_unlisted_client_callable).toBe(2);
    expect(r.agrees).toBe(true);
    expect(r.census_signatures_read, "every quoted signature in the census's lists was read").toBeGreaterThan(100);
  });

  it("refuses both client roles, so the names never reach the publishable key", async () => {
    const db = await boot();
    await db.exec(MIGRATION);
    for (const role of ["anon", "authenticated"]) {
      await expect(namesAs(db, role), role).rejects.toThrow(/permission denied/);
    }
    // The census itself stays readable with the publishable key: it is untouched.
    await db.exec("SET ROLE anon");
    const { rows } = await db.query<{ n: number }>("SELECT (public.client_callable_census() ->> 'unlisted_client_callable')::int AS n");
    await db.exec("RESET ROLE");
    expect(rows[0].n).toBe(2);
  });

  it("follows the census's own lists: an entry added to a re-issued census stops that function being named", async () => {
    const reissued = CENSUS.map((s) => s.replace("'public.agent_sender_public_status()',", "'public.agent_sender_public_status()',\n        'public.stray_reader(integer)',"));
    expect(reissued[0]).not.toBe(CENSUS[0]);
    const db = await boot(reissued);
    await db.exec(MIGRATION);
    const r = await namesAs(db, "service_role");
    expect(r.unlisted.map((u) => u.signature)).toEqual(["public.stray_writer(text)"]);
    expect(r.agrees).toBe(true);
  });

  it("is safe to re-run", async () => {
    const db = await boot();
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect((await namesAs(db, "service_role")).agrees).toBe(true);
  });

  it("a census rewritten in a shape the parse cannot read fails the apply instead of naming the wrong set", async () => {
    // Same counts, no quoted signatures in the body: the reader would call
    // every client-callable definer unlisted, so the self-check must refuse.
    const opaque = [
      "CREATE FUNCTION public.client_callable_census() RETURNS jsonb LANGUAGE sql STABLE AS $c$ SELECT jsonb_build_object('unlisted_client_callable', 2) $c$;",
      "GRANT EXECUTE ON FUNCTION public.client_callable_census() TO anon, authenticated, service_role;",
    ];
    const db = await boot(opaque);
    await expect(db.exec(MIGRATION)).rejects.toThrow(/read no signature/);
  });

  it("every catalogue reader admin-ops serves is, after every migration, an INVOKER function no client role can execute", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/admin-ops/rpcs.ts"), "utf8");
    const at = src.indexOf("export const ADMIN_CATALOGUE_RPCS");
    const body = src.slice(src.indexOf("new Set([", at), src.indexOf("]);", at));
    const names = [...body.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(names).toContain("client_callable_unlisted_names");
    const { fns } = migrationReplay();
    for (const n of names) {
      const defs = [...fns.values()].filter((f) => f.name === n);
      expect(defs.length, `${n} is created by exactly one signature`).toBe(1);
      const f = defs[0];
      expect(f.definer, `${n} must run with the caller's rights`).toBe(false);
      expect(anonCan(f) || authenticatedCan(f), `${n} must not be callable with a client key`).toBe(false);
      expect(f.acl.service_role, `${n} must be executable by service_role, or admin-ops cannot read it`).toBe(true);
    }
  });
});
