// @vitest-environment node
/**
 * THE FULL ANALYSIS RUN LEASE IS ONE ROW PER PURCHASE, AND CLOSED TO THE
 * CLIENT ROLES (hotfix 2026-11-10; migration 20261110120000; M-S14-005).
 *
 * Applied twice to pglite from Supabase's default grants (anon and
 * authenticated get ALL on a new table unless the migration takes it back):
 *   - the table exists with row-level security on, and neither client role
 *     can read, write or delete a lease (a visitor could otherwise lock a
 *     buyer's purchase, or free one mid-run);
 *   - service_role, which analyze-resume runs as, can take, read and free one;
 *   - one session holds one lease: a second take is a unique violation, the
 *     23505 the function reads as "in progress";
 *   - a key that is no purchase is refused;
 *   - the file is safe to run again, and its own check passes both times.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261110120000_"));
const SQL = readFileSync(resolve(DIR, FILE ?? "missing"), "utf8");

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

let pg: PGlite;
beforeAll(async () => {
  expect(FILE, "migration 20261110120000 is missing").toBeTruthy();
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(SQL);
  await pg.exec(SQL);
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

const as = async (role: string, sql: string) => {
  await pg.exec(`SET ROLE ${role}`);
  try {
    return await pg.query(sql);
  } finally {
    await pg.exec("RESET ROLE");
  }
};

describe("analysis_run_leases", () => {
  it("row-level security is on and neither client role holds any privilege", async () => {
    const rls = await pg.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analysis_run_leases'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = await pg.query<{ ok: boolean }>(`SELECT has_table_privilege('${role}', 'public.analysis_run_leases', '${priv}') AS ok`);
        expect(r.rows[0].ok, `${role} holds ${priv}`).toBe(false);
      }
      await expect(as(role, "SELECT * FROM public.analysis_run_leases")).rejects.toThrow(/permission denied/);
      await expect(as(role, "INSERT INTO public.analysis_run_leases (session_id, holder, expires_at) VALUES ('cs_live_x', gen_random_uuid(), now() + interval '1 minute')")).rejects.toThrow(/permission denied/);
    }
  });

  it("service_role takes, reads and frees a lease, and one session holds one", async () => {
    await as("service_role", "INSERT INTO public.analysis_run_leases (session_id, holder, expires_at) VALUES ('cs_live_lease_one', '00000000-0000-4000-8000-000000000001', now() + interval '3 minutes')");
    await expect(
      as("service_role", "INSERT INTO public.analysis_run_leases (session_id, holder, expires_at) VALUES ('cs_live_lease_one', '00000000-0000-4000-8000-000000000002', now() + interval '3 minutes')"),
    ).rejects.toMatchObject({ code: "23505" });
    const read = await as("service_role", "SELECT holder FROM public.analysis_run_leases WHERE session_id = 'cs_live_lease_one'");
    expect(read.rows).toEqual([{ holder: "00000000-0000-4000-8000-000000000001" }]);
    await as("service_role", "DELETE FROM public.analysis_run_leases WHERE session_id = 'cs_live_lease_one' AND holder = '00000000-0000-4000-8000-000000000001'");
    expect((await as("service_role", "SELECT 1 FROM public.analysis_run_leases")).rows).toEqual([]);
  });

  it("a Pro grant is a purchase; anything else is refused", async () => {
    await as("service_role", "INSERT INTO public.analysis_run_leases (session_id, holder, expires_at) VALUES ('pro_8a6f7d3e-1b2c-4d5e-9f00-112233445566', gen_random_uuid(), now() + interval '1 minute')");
    await expect(
      as("service_role", "INSERT INTO public.analysis_run_leases (session_id, holder, expires_at) VALUES ('anything', gen_random_uuid(), now() + interval '1 minute')"),
    ).rejects.toThrow(/analysis_run_leases_is_a_purchase/);
  });
});
