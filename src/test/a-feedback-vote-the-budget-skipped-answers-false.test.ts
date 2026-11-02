// @vitest-environment node
/**
 * A FEEDBACK VOTE THE BUDGET SKIPPED ANSWERS FALSE (register S13-057, the
 * database half).
 *
 * record_scan_feedback returned VOID, so a vote client_write_allowed refused
 * (ten an hour from one address, 300 an hour from everyone) came back exactly
 * like a stored one, and the page thanked people for votes it never kept.
 * 20261101150000 makes it answer true or false. This runs that file in a real
 * Postgres (pglite) over 20261004110000's void definition, the state
 * production is in, twice: it must find and replace the void function from
 * the catalogue, keep the grants, and answer the truth.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const PRIOR = readFileSync(resolve(MIG, "20261004110000_every_function_a_stranger_can_call_is_named_with_its_caller.sql"), "utf8");
const FIX = readFileSync(resolve(MIG, "20261101150000_a_feedback_vote_the_budget_skipped_is_never_thanked.sql"), "utf8");

/** 20261004110000's own definition and grants, cut from the file as shipped. */
const priorDefinition = (() => {
  const start = PRIOR.indexOf("CREATE OR REPLACE FUNCTION public.record_scan_feedback(");
  const grant = PRIOR.indexOf("GRANT EXECUTE ON FUNCTION public.record_scan_feedback(", start);
  const end = PRIOR.indexOf(";", grant) + 1;
  expect(start).toBeGreaterThan(0);
  expect(grant).toBeGreaterThan(start);
  return PRIOR.slice(start, end);
})();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    -- Supabase's defaults: new tables and functions in public are granted to
    -- every client role, and a GRANT never takes any of it away.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.scan_feedback (
      id bigserial PRIMARY KEY, visitor_id text, rating boolean NOT NULL, industry text,
      ats_score integer, had_job_description boolean, resume_word_count integer, feedback_text text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.client_write_allowed(p_fn text, p_per_addr int, p_global int, p_window int)
      RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.allow', true), 'yes') <> 'no' $$;
  `);
  await db.exec(priorDefinition);
});
afterAll(async () => { await db?.close(); });

const ret = async () => (await db.query<{ t: string }>(
  `SELECT p.prorettype::regtype::text AS t FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_scan_feedback'`)).rows.map((r) => r.t);
const rows = async () => Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM public.scan_feedback")).rows[0].n);
const vote = async (args = "p_rating => true, p_industry => 'technology', p_ats_score => 64") =>
  (await db.query<{ v: boolean | string | null }>(`SELECT public.record_scan_feedback(${args}) AS v`)).rows[0].v;

describe("before the fix, the void definition production runs", () => {
  it("answers nothing whether or not it stored the vote", async () => {
    expect(await ret()).toEqual(["void"]);
    await db.exec("SET test.allow = 'yes'");
    const before = await rows();
    const stored = await vote();
    expect(typeof stored, "the void function answered a boolean").not.toBe("boolean");
    expect(await rows()).toBe(before + 1);
    await db.exec("SET test.allow = 'no'");
    expect(await vote(), "a refused vote looked exactly like a stored one").toEqual(stored);
    expect(await rows()).toBe(before + 1);
  });
});

describe("20261101150000", () => {
  it("applies over the void definition, and again over its own", async () => {
    await db.exec(`BEGIN; ${FIX} COMMIT;`);
    expect(await ret()).toEqual(["boolean"]);
    await db.exec(`BEGIN; ${FIX} COMMIT;`);
    expect(await ret()).toEqual(["boolean"]);
  });

  it("answers true for a stored vote and false for a refused one", async () => {
    await db.exec("SET test.allow = 'yes'");
    const before = await rows();
    expect(await vote()).toBe(true);
    expect(await rows()).toBe(before + 1);
    await db.exec("SET test.allow = 'no'");
    expect(await vote()).toBe(false);
    expect(await rows()).toBe(before + 1);
    await db.exec("SET test.allow = 'yes'");
    expect(await vote("p_rating => NULL")).toBe(false);
    expect(await rows()).toBe(before + 1);
  });

  it("keeps the access the page needs and gives PUBLIC none", async () => {
    const { rows: r } = await db.query<{ anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'record_scan_feedback'`);
    expect(r).toEqual([{ anon: true, auth: true, svc: true, pub: false }]);
    await db.exec("SET test.allow = 'yes'; SET ROLE anon;");
    try {
      expect(await vote()).toBe(true);
    } finally {
      await db.exec("RESET ROLE;");
    }
  });

  it("names no signature by hand: the drop and the grants read the catalogue", () => {
    const sql = FIX.replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/DROP FUNCTION (?:IF EXISTS )?public\.record_scan_feedback\s*\(/i);
    expect(sql).not.toMatch(/(?:GRANT|REVOKE)[^;]*ON FUNCTION public\.record_scan_feedback\s*\(/i);
    expect(sql).toMatch(/prorettype = 'void'::regtype/);
  });
});
