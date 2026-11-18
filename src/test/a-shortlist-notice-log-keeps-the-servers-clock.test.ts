// @vitest-environment node
/**
 * A SHORTLIST NOTICE LOG KEEPS THE SERVER'S CLOCK (S14X-163; migration
 * 20261112210000).
 *
 * The notice log is evidence that a candidate was told (NYC LL144 asks for
 * ten business days' notice). Before the migration a client could write any
 * sent_at it liked, in the future included, and nothing recorded when the
 * row was actually written; under Supabase's default grants anon held every
 * privilege on the table and a signed-in client held UPDATE, DELETE and
 * TRUNCATE (RLS has no policy for the first two, and none applies to
 * TRUNCATE).
 *
 * In a real Postgres (pglite) started from Supabase's default grants, with
 * production's Shortlist statements (20260704160023), as the signed-in owner
 * through SET ROLE authenticated: TEETH first, then with the migration a
 * client's logged_at is replaced by the server's clock, a send date after
 * today is refused, the recipient list is capped, an old-page insert with no
 * dates still lands, and no client role can rewrite or remove a row. The
 * file runs twice without error.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(MIG, readdirSync(MIG).find((f) => f.startsWith(prefix))!), "utf8");
const THIS = file("20261112210000_");
const BASE = sqlCodeOf(file("20260704160023_"))
  .split(/;\s*\n/)
  .filter((s) => /public\.shortlist_/.test(s))
  .map((s) => `${s};`)
  .join("\n");

/** Supabase's defaults: anon and authenticated get every privilege on a new table. */
const SUPABASE_DEFAULTS = `
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT; CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

const A = "00000000-0000-4000-8000-00000000000a";
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
    INSERT INTO auth.users VALUES ('${A}', 'a@employer.test');
  `);
  await db.exec(BASE);
  const role = await db.query<{ id: string }>(`INSERT INTO public.shortlist_roles (owner_id, title, jd_text) VALUES ($1, 'Data Engineer', 'Airflow, dbt and Snowflake for five years.') RETURNING id`, [A]);
  await db.query(`INSERT INTO public.shortlist_notices (role_id, owner_id, jurisdiction, notice_type, content, sent_at) VALUES ($1, $2, 'NYC', 'nyc_advance', 'old row', '2026-09-01T12:00:00Z')`, [role.rows[0].id, A]);
  if (withMigration) await db.exec(THIS);
  return { db, roleId: role.rows[0].id };
}

async function as(db: PGlite, role: "authenticated" | "anon", sql: string, params: unknown[] = []) {
  try {
    const rows = await db.transaction(async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      if (role === "authenticated") await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [A]);
      return (await tx.query<Record<string, unknown>>(sql, params)).rows;
    });
    return { rows, error: null as string | null };
  } catch (e) {
    return { rows: [] as Record<string, unknown>[], error: String((e as Error).message) };
  }
}

const insertAs = (db: PGlite, roleId: string, extra: string, values: string) =>
  as(db, "authenticated", `INSERT INTO public.shortlist_notices (role_id, owner_id, jurisdiction, notice_type, content${extra}) VALUES ($1, $2, 'NYC', 'nyc_advance', 'NOTICE'${values}) RETURNING *`, [roleId, A]);

describe("without the migration (teeth)", () => {
  it("a client logs a send date in the future, and anon and the owner can rewrite or empty the log", async () => {
    const { db, roleId } = await boot(false);
    expect((await insertAs(db, roleId, ", sent_at", ", now() + interval '30 days'")).error).toBeNull();
    expect((await as(db, "anon", `SELECT has_table_privilege('anon', 'public.shortlist_notices', 'TRUNCATE') AS t`)).rows[0].t).toBe(true);
    expect((await as(db, "authenticated", `SELECT has_table_privilege('authenticated', 'public.shortlist_notices', 'UPDATE') AS u`)).rows[0].u).toBe(true);
  });
});

describe("with the migration", () => {
  it("keeps existing rows, dated by the only date they have", async () => {
    const { db } = await boot(true);
    const old = (await db.query<{ logged_at: Date; sent_at: Date }>(`SELECT logged_at, sent_at FROM public.shortlist_notices WHERE content = 'old row'`)).rows[0];
    expect(old.logged_at.toISOString()).toBe(old.sent_at.toISOString());
  });

  it("replaces a client's logged_at with the server's clock and keeps the stated send date", async () => {
    const { db, roleId } = await boot(true);
    const r = await insertAs(db, roleId, ", sent_at, logged_at, recipients", ", now() - interval '12 days', '2020-01-01T00:00:00Z', 'Candidate 1'");
    expect(r.error).toBeNull();
    const row = (await db.query<{ fresh: boolean; stated: boolean }>(`SELECT logged_at > now() - interval '1 minute' AS fresh, sent_at < now() - interval '11 days' AS stated FROM public.shortlist_notices WHERE recipients = 'Candidate 1'`)).rows[0];
    expect(row).toEqual({ fresh: true, stated: true });
  });

  it("refuses a send date after today", async () => {
    const { db, roleId } = await boot(true);
    expect((await insertAs(db, roleId, ", sent_at", ", now() + interval '2 days'")).error).toMatch(/after today/);
  });

  it("an old page's insert with no dates still lands", async () => {
    const { db, roleId } = await boot(true);
    expect((await insertAs(db, roleId, "", "")).error).toBeNull();
  });

  it("caps the recipient list at 2,000 characters", async () => {
    const { db, roleId } = await boot(true);
    expect((await insertAs(db, roleId, ", recipients", `, repeat('x', 2001)`)).error).toMatch(/recipients_length/);
  });

  it("no client role can read, rewrite or remove the log beyond the owner's read and insert", async () => {
    const { db } = await boot(true);
    const priv = async (role: string, p: string) => (await db.query<{ ok: boolean }>(`SELECT has_table_privilege($1, 'public.shortlist_notices', $2) AS ok`, [role, p])).rows[0].ok;
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(await priv("anon", p), `anon ${p}`).toBe(false);
    for (const p of ["UPDATE", "DELETE", "TRUNCATE"]) expect(await priv("authenticated", p), `authenticated ${p}`).toBe(false);
    for (const p of ["SELECT", "INSERT"]) expect(await priv("authenticated", p), `authenticated ${p}`).toBe(true);
    expect((await as(db, "authenticated", `DELETE FROM public.shortlist_notices`)).error).toMatch(/permission denied/);
  });

  it("runs twice without error", async () => {
    const { db } = await boot(true);
    await expect(db.exec(THIS)).resolves.toBeDefined();
  });
});
