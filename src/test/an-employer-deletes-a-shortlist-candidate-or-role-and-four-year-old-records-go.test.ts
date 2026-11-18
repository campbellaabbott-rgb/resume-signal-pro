// @vitest-environment node
/**
 * AN EMPLOYER DELETES A SHORTLIST CANDIDATE OR ROLE, AND FOUR-YEAR-OLD RECORDS
 * GO (S14X-073, the owner's rule A; migration 20261112211000).
 *
 * Before the migration no client role could delete a Shortlist record and
 * nothing ever expired, while the page promised four years. In a real
 * Postgres (pglite) started from Supabase's default grants, with production's
 * Shortlist statements (20260704160023), the evaluation lockdown
 * (20261009111000, 20261009112000) and the notice log (20261112210000), as
 * the signed-in employer through SET ROLE authenticated: TEETH first, then
 * with the migration the owner deletes one candidate or a whole role and
 * every child row goes with it, another account and anon delete nothing, each
 * deletion is logged with no resume text, only the purge job removes what is
 * more than four years old, closing an account still works and leaves no log,
 * and the file runs twice.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(prefix))!), "utf8");
const THIS = file("20261112211000_");
const BEFORE = [file("20261009111000_"), file("20261009112000_"), file("20261112210000_")];
const BASE = sqlCodeOf(file("20260704160023_"))
  .split(/;\s*\n/)
  .filter((s) => /public\.shortlist_/.test(s))
  .map((s) => `${s};`)
  .join("\n");

/** Supabase's defaults: anon and authenticated get every privilege on a new table and function. */
const SUPABASE_DEFAULTS = `
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) await db.close().catch(() => {}); });

async function boot(withMigration: boolean) {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${A}', 'a@employer.test'), ('${B}', 'b@other.test');
  `);
  await db.exec(BASE);
  for (const f of BEFORE) await db.exec(f);
  if (withMigration) await db.exec(THIS);
  return db;
}

/** A role with candidates uploaded `ages` ago (Postgres intervals), each with one decision, and one notice. */
async function seed(db: PGlite, owner: string, ages: string[], noticeAge = "1 day") {
  const role = (await db.query<{ id: string }>(`INSERT INTO public.shortlist_roles (owner_id, title, jd_text) VALUES ($1, 'Data Engineer', 'Airflow and dbt.') RETURNING id`, [owner])).rows[0].id;
  const cands: string[] = [];
  for (const age of ages) {
    const c = (await db.query<{ id: string }>(
      `INSERT INTO public.shortlist_candidates (role_id, owner_id, score, redacted_text, file_name, created_at) VALUES ($1, $2, 60, 'redacted text', 'Jane_Okafor_CV.pdf', now() - $3::interval) RETURNING id`,
      [role, owner, age],
    )).rows[0].id;
    await db.query(`INSERT INTO public.shortlist_decisions (candidate_id, owner_id, action, new_value) VALUES ($1, $2, 'note', 'seen')`, [c, owner]);
    cands.push(c);
  }
  const n = (await db.query<{ id: string }>(`INSERT INTO public.shortlist_notices (role_id, owner_id, jurisdiction, notice_type, content) VALUES ($1, $2, 'NYC', 'nyc_advance', 'NOTICE') RETURNING id`, [role, owner])).rows[0].id;
  await db.query(`UPDATE public.shortlist_notices SET logged_at = now() - $2::interval, sent_at = now() - $2::interval WHERE id = $1`, [n, noticeAge]);
  return { role, cands, notice: n };
}

async function as(db: PGlite, role: "authenticated" | "anon", uid: string | null, sql: string, params: unknown[] = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      if (uid) await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      return (await tx.query<Record<string, unknown>>(sql, params)).rows;
    });
    return { rows, error: null as string | null };
  } catch (e) {
    return { rows: [] as Record<string, unknown>[], error: String((e as Error).message) };
  }
}
const count = async (db: PGlite, sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n);

describe("without the migration (teeth)", () => {
  it("an employer cannot delete a candidate or a role, and nothing expires", async () => {
    const db = await boot(false);
    const s = await seed(db, A, ["5 years"]);
    const del = await as(db, "authenticated", A, `DELETE FROM public.shortlist_candidates WHERE id = $1 RETURNING id`, [s.cands[0]]);
    expect(del.rows.length === 0 || del.error !== null).toBe(true);
    await as(db, "authenticated", A, `DELETE FROM public.shortlist_roles WHERE id = $1`, [s.role]);
    expect(await count(db, "public.shortlist_candidates")).toBe(1);
    expect(await count(db, "public.shortlist_roles")).toBe(1);
    expect((await db.query(`SELECT to_regprocedure('public.shortlist_purge_expired(timestamptz)') AS p`)).rows[0]).toEqual({ p: null });
  });
});

describe("with the migration", () => {
  it("the owner deletes one candidate, its decisions go with it, and the log keeps ids and dates, never the resume", async () => {
    const db = await boot(true);
    const s = await seed(db, A, ["10 days", "20 days"]);
    const r = await as(db, "authenticated", A, `SELECT public.shortlist_delete_candidate($1) AS r`, [s.cands[0]]);
    expect(r.error).toBeNull();
    expect((r.rows[0].r as { deleted: string }).deleted).toBe(s.cands[0]);
    expect(await count(db, "public.shortlist_candidates WHERE id = $1", [s.cands[0]])).toBe(0);
    expect(await count(db, "public.shortlist_decisions WHERE candidate_id = $1", [s.cands[0]])).toBe(0);
    expect(await count(db, "public.shortlist_candidates WHERE id = $1", [s.cands[1]])).toBe(1);
    const log = (await db.query<Record<string, unknown>>(`SELECT * FROM public.shortlist_deletions`)).rows;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ owner_id: A, what: "candidate", how: "employer", role_id: s.role, candidate_id: s.cands[0] });
    expect(Object.keys(log[0]).sort()).toEqual(["candidate_id", "deleted_at", "how", "id", "owner_id", "role_id", "uploaded_at", "what"]);
    expect((await as(db, "authenticated", A, `SELECT what FROM public.shortlist_deletions`)).rows).toEqual([{ what: "candidate" }]);
  });

  it("the owner deletes a role and its candidates, decisions and notices go with it", async () => {
    const db = await boot(true);
    const s = await seed(db, A, ["10 days", "20 days", "30 days"]);
    const r = await as(db, "authenticated", A, `SELECT public.shortlist_delete_role($1) AS r`, [s.role]);
    expect(r.error).toBeNull();
    expect(r.rows[0].r).toEqual({ deleted: s.role, candidates: 3 });
    for (const t of ["shortlist_roles", "shortlist_candidates", "shortlist_decisions", "shortlist_notices"]) expect(await count(db, `public.${t}`), t).toBe(0);
    const log = (await db.query<{ what: string; how: string }>(`SELECT what, how FROM public.shortlist_deletions ORDER BY what`)).rows;
    expect(log).toEqual([...Array(3).fill({ what: "candidate", how: "employer" }), { what: "role", how: "employer" }]);
  });

  it("another account and anon delete nothing", async () => {
    const db = await boot(true);
    const s = await seed(db, A, ["10 days"]);
    expect((await as(db, "authenticated", B, `SELECT public.shortlist_delete_candidate($1)`, [s.cands[0]])).error).toMatch(/not found in your roles/);
    expect((await as(db, "authenticated", B, `SELECT public.shortlist_delete_role($1)`, [s.role])).error).toMatch(/not found in your account/);
    expect((await as(db, "authenticated", B, `DELETE FROM public.shortlist_candidates RETURNING id`)).rows).toEqual([]);
    expect((await as(db, "authenticated", B, `DELETE FROM public.shortlist_roles RETURNING id`)).rows).toEqual([]);
    expect((await as(db, "anon", null, `SELECT public.shortlist_delete_candidate($1)`, [s.cands[0]])).error).toMatch(/permission denied/);
    expect((await as(db, "anon", null, `SELECT public.shortlist_delete_role($1)`, [s.role])).error).toMatch(/permission denied/);
    await as(db, "anon", null, `DELETE FROM public.shortlist_roles`);
    expect(await count(db, "public.shortlist_candidates")).toBe(1);
    expect(await count(db, "public.shortlist_roles")).toBe(1);
    expect(await count(db, "public.shortlist_deletions")).toBe(0);
  });

  it("no client role may write, rewrite or remove the deletions log, and anon cannot read it", async () => {
    const db = await boot(true);
    const priv = async (role: string, p: string) => (await db.query<{ ok: boolean }>(`SELECT has_table_privilege($1, 'public.shortlist_deletions', $2) AS ok`, [role, p])).rows[0].ok;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(await priv("anon", p), `anon ${p}`).toBe(false);
    for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(await priv("authenticated", p), `authenticated ${p}`).toBe(false);
    expect(await priv("authenticated", "SELECT")).toBe(true);
    const s = await seed(db, A, ["10 days"]);
    expect((await as(db, "authenticated", A, `INSERT INTO public.shortlist_deletions (owner_id, what, how, role_id) VALUES ($1, 'role', 'employer', $2)`, [A, s.role])).error).toMatch(/permission denied/);
  });

  it("the purge deletes only what was uploaded or logged more than four years ago, and logs it as the purge", async () => {
    const db = await boot(true);
    const old = await seed(db, A, ["4 years 1 day", "3 years 360 days"], "4 years 1 day");
    const r = (await db.query<{ r: { candidates: number; notices: number } }>(`SELECT public.shortlist_purge_expired() AS r`)).rows[0].r;
    expect(r).toMatchObject({ candidates: 1, notices: 1 });
    expect(await count(db, "public.shortlist_candidates WHERE id = $1", [old.cands[0]])).toBe(0);
    expect(await count(db, "public.shortlist_decisions WHERE candidate_id = $1", [old.cands[0]])).toBe(0);
    expect(await count(db, "public.shortlist_candidates WHERE id = $1", [old.cands[1]])).toBe(1);
    expect(await count(db, "public.shortlist_roles WHERE id = $1", [old.role])).toBe(1);
    expect((await db.query(`SELECT what, how, candidate_id FROM public.shortlist_deletions`)).rows).toEqual([{ what: "candidate", how: "purge", candidate_id: old.cands[0] }]);
    // The setting does not leak: a delete later in the same session is the employer's.
    await as(db, "authenticated", A, `SELECT public.shortlist_delete_candidate($1)`, [old.cands[1]]);
    expect((await db.query(`SELECT how FROM public.shortlist_deletions WHERE candidate_id = $1`, [old.cands[1]])).rows).toEqual([{ how: "employer" }]);
  });

  it("no client role can run the purge", async () => {
    const db = await boot(true);
    expect((await as(db, "authenticated", A, `SELECT public.shortlist_purge_expired(now() + interval '100 years')`)).error).toMatch(/permission denied/);
    expect((await as(db, "anon", null, `SELECT public.shortlist_purge_expired()`)).error).toMatch(/permission denied/);
  });

  it("closing an account still works and leaves no Shortlist row or log behind", async () => {
    const db = await boot(true);
    const s = await seed(db, A, ["10 days", "20 days"]);
    await as(db, "authenticated", A, `SELECT public.shortlist_delete_candidate($1)`, [s.cands[0]]);
    expect(await count(db, "public.shortlist_deletions")).toBe(1);
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [A]);
    for (const t of ["shortlist_roles", "shortlist_candidates", "shortlist_decisions", "shortlist_notices", "shortlist_deletions"]) expect(await count(db, `public.${t}`), t).toBe(0);
  });

  it("runs twice without error", async () => {
    const db = await boot(true);
    await expect(db.exec(THIS)).resolves.toBeDefined();
  });
});
