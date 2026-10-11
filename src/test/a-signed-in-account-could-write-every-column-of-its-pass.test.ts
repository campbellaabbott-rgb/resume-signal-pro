// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite.
/**
 * A SIGNED-IN ACCOUNT COULD WRITE EVERY COLUMN OF ITS PASS.
 *
 * WHAT WAS WRONG (Lovable's staged run of 20261008132000, 2026-10-10). The
 * migration that made agent_passes took its privileges away from the public
 * and the anonymous role and granted the signed-in role SELECT, but Supabase
 * starts every public table with ALL granted to anon, authenticated and
 * service_role, so the signed-in role kept INSERT, UPDATE, DELETE and TRUNCATE
 * on every column. 20261008132000's self-check (a signed-in account must not
 * write settled_at) refused live and was rolled back twice, while the tests
 * passed: the pglite stand-ins never carried Supabase's default grants.
 *
 * Here the table is the agent harness's stand-in with Supabase's default and
 * the 20260917100000 grants on top (the live state), and the file
 * 20261008131500 runs against it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

const M = "20261008131500_a_signed_in_account_reads_its_pass_and_never_writes_it.sql";

let db: PGlite;
const priv = async (sql: string): Promise<boolean> => (await db.query<{ x: boolean }>(`SELECT (${sql}) AS x`)).rows[0].x;
const anyClientWrite = (role: string) => `
  has_table_privilege('${role}', 'public.agent_passes', 'INSERT')
  OR has_table_privilege('${role}', 'public.agent_passes', 'UPDATE')
  OR has_table_privilege('${role}', 'public.agent_passes', 'DELETE')
  OR has_table_privilege('${role}', 'public.agent_passes', 'TRUNCATE')`;

beforeAll(async () => {
  db = await agentDb();
}, 240_000);

afterAll(async () => { await db?.close(); });

describe("a signed-in account reads its pass and never writes it", () => {
  it("before the file, the signed-in role holds every write, as it does live", async () => {
    expect(await priv(anyClientWrite("authenticated"))).toBe(true);
    expect(await priv(`has_column_privilege('authenticated', 'public.agent_passes', 'closed_at', 'UPDATE')`)).toBe(true);
    // The anonymous role was already locked out by 20260917100000.
    expect(await priv(anyClientWrite("anon"))).toBe(false);
  });

  it("after the file, no client role can write any column, and the owner can still read", async () => {
    await db.exec(migration(M));
    expect(await priv(anyClientWrite("authenticated"))).toBe(false);
    expect(await priv(anyClientWrite("anon"))).toBe(false);
    const cols = (await db.query<{ c: string }>(
      `SELECT attname AS c FROM pg_attribute WHERE attrelid = 'public.agent_passes'::regclass AND attnum > 0 AND NOT attisdropped`,
    )).rows.map((r) => r.c);
    expect(cols).toContain("closed_at");
    for (const c of cols) {
      expect(await priv(`has_column_privilege('authenticated', 'public.agent_passes', '${c}', 'UPDATE')`), c).toBe(false);
      expect(await priv(`has_column_privilege('authenticated', 'public.agent_passes', '${c}', 'INSERT')`), c).toBe(false);
    }
    expect(await priv(`has_table_privilege('authenticated', 'public.agent_passes', 'SELECT')`)).toBe(true);
    expect(await priv(`has_table_privilege('anon', 'public.agent_passes', 'SELECT')`)).toBe(false);
    expect(await priv(`has_table_privilege('service_role', 'public.agent_passes', 'UPDATE')`)).toBe(true);
  });

  it("is safe to run again", async () => {
    await expect(db.exec(migration(M))).resolves.toBeDefined();
    expect(await priv(anyClientWrite("authenticated"))).toBe(false);
  });
});
