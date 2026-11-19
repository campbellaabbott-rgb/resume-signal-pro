// @vitest-environment node
/**
 * THE TRUTH FUNCTIONS AND TABLES GRANT NOTHING TO CLIENTS.
 *
 * WHAT HAPPENED. Supabase grants anon and authenticated ALL on every table,
 * function and sequence created in public, and a revoke from PUBLIC alone
 * leaves their own grant in place: 107 of 121 definer functions were once
 * callable by the publishable key, one of them granting paid credits, and the
 * API4 design first named only EXECUTE revokes for its new tables
 * (critique-api 2.9). posting_truth reads the closure ledger, company_facts
 * spends the global employer_compute budget, and api_expensive_take writes
 * the meter that rations both: any of them open to a client is a free bulk
 * read or a way to spend everyone's budget.
 *
 * THE PROPERTY. Run in a real Postgres (pglite) started from Supabase's
 * default grants, 20261206100000 leaves:
 *   - posting_truth, company_facts and api_expensive_take executable by the
 *     service role and by neither client role, each a definer with its
 *     search_path pinned;
 *   - company_fact_cache and api_expensive_meter with row level security on
 *     and no table privilege of any kind for either client role;
 *   - no new sequence.
 * The control: a function created in the same harness with no revoke IS
 * callable by anon, so the probe can see an open door. The teeth: the same
 * migration with its revokes and its self-check removed leaves the door open,
 * and with its revokes removed alone it refuses to apply.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261206100000_a_posting_is_answered_by_what_we_saw_of_it.sql"),
  "utf8",
);

/** The tables posting_truth reads, with the columns its SQL names. */
const STAND_INS = `
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    posted_at timestamptz, first_seen timestamptz NOT NULL DEFAULT now(), effective_posted timestamptz,
    missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text NOT NULL, company text, title text,
    category text NOT NULL DEFAULT '', first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL,
    superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false, batch_live_before integer,
    absence_basis text);
  CREATE TABLE public.job_board_aged_out (
    id text PRIMARY KEY, source text, company_token text, posted_at timestamptz, aged_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY, bucket text NOT NULL, lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_verifications (
    company_token text PRIMARY KEY, verified_at timestamptz NOT NULL DEFAULT now(), feed_total integer);
`;

const FUNCTIONS = [
  "public.posting_truth(text[])",
  "public.company_facts(text[])",
  "public.api_expensive_take(text, text, integer, integer, integer, integer, boolean)",
];
const TABLES = ["public.company_fact_cache", "public.api_expensive_meter"];
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const CLIENTS = ["anon", "authenticated"];

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(STAND_INS);
  return db;
}

const sequences = async (db: PGlite): Promise<string[]> =>
  (await db.query<{ s: string }>(
    "SELECT c.oid::regclass::text AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1",
  )).rows.map((r) => r.s);

const canExecute = async (db: PGlite, role: string, fn: string): Promise<boolean> =>
  (await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, fn])).rows[0].ok;

const tableGrants = async (db: PGlite, role: string, table: string): Promise<string[]> => {
  const held: string[] = [];
  for (const p of PRIVS) {
    if ((await db.query<{ ok: boolean }>("SELECT has_table_privilege($1, $2, $3) AS ok", [role, table, p])).rows[0].ok) held.push(p);
  }
  return held;
};

/** The migration without the lines that revoke from the client roles. */
const withoutRevokes = (sql: string): string =>
  sql.split("\n").filter((l) => !/^REVOKE ALL ON (?:FUNCTION|TABLE) public\.\S+.* FROM PUBLIC, anon, authenticated;$/.test(l)).join("\n");
/** And without its self-check. */
const withoutSelfCheck = (sql: string): string => sql.slice(0, sql.indexOf("DO $check$"));

let db: PGlite;
let before: string[];
beforeAll(async () => {
  db = await boot();
  before = await sequences(db);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // safe to re-run
  await db.exec("CREATE FUNCTION public.control_open() RETURNS integer LANGUAGE sql AS 'SELECT 1';");
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("the harness starts from Supabase's default grants (the control)", () => {
  it("a function created with no revoke is callable by anon and by a signed-in account", async () => {
    expect(await canExecute(db, "anon", "public.control_open()")).toBe(true);
    expect(await canExecute(db, "authenticated", "public.control_open()")).toBe(true);
  });
  it("and a stand-in table created with no revoke is readable by anon", async () => {
    expect(await tableGrants(db, "anon", "public.job_board_postings")).toEqual(PRIVS);
  });
});

describe("20261206100000 opens nothing to a client", () => {
  for (const fn of FUNCTIONS) {
    it(`${fn} answers the service role only`, async () => {
      for (const role of CLIENTS) expect(await canExecute(db, role, fn), `${role} can execute ${fn}`).toBe(false);
      expect(await canExecute(db, "service_role", fn)).toBe(true);
      const { rows } = await db.query<{ definer: boolean; config: string[] | null }>(
        "SELECT p.prosecdef AS definer, p.proconfig AS config FROM pg_proc p WHERE p.oid = to_regprocedure($1)", [fn]);
      expect(rows[0].definer).toBe(true);
      expect(rows[0].config ?? []).toContain("search_path=public");
    });
  }

  it("a client role calling each function is refused by the database itself", async () => {
    for (const role of CLIENTS) {
      for (const call of [
        "SELECT * FROM public.posting_truth(ARRAY['greenhouse:acme:1'])",
        "SELECT * FROM public.company_facts(ARRAY['acme'])",
        "SELECT * FROM public.api_expensive_take('employer_compute', NULL, 1, NULL, NULL, NULL, true)",
      ]) {
        await db.exec(`SET ROLE ${role}`);
        try {
          await expect(db.query(call), `${role}: ${call}`).rejects.toThrow(/permission denied/);
        } finally {
          await db.exec("RESET ROLE");
        }
      }
    }
  });

  for (const table of TABLES) {
    it(`${table} holds no privilege for a client and has row level security on`, async () => {
      for (const role of CLIENTS) expect(await tableGrants(db, role, table), `${role} on ${table}`).toEqual([]);
      expect(await tableGrants(db, "service_role", table)).toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      const { rows } = await db.query<{ rls: boolean }>("SELECT c.relrowsecurity AS rls FROM pg_class c WHERE c.oid = $1::regclass", [table]);
      expect(rows[0].rls).toBe(true);
    });
  }

  it("creates no sequence, so no sequence can be left open", async () => {
    expect(await sequences(db)).toEqual(before);
    expect(before.length, "the stand-in ledger's identity sequence is visible to the probe").toBeGreaterThan(0);
  });
});

describe("teeth", () => {
  it("with its revokes and its self-check removed, the same migration leaves every function open to anon", async () => {
    const bare = withoutSelfCheck(withoutRevokes(MIGRATION));
    expect(bare).not.toBe(MIGRATION);
    const d = await boot();
    try {
      await d.exec(bare);
      for (const fn of FUNCTIONS) expect(await canExecute(d, "anon", fn), fn).toBe(true);
      for (const t of TABLES) expect(await tableGrants(d, "anon", t), t).toEqual(PRIVS);
    } finally {
      await d.close();
    }
  });

  it("with its revokes removed alone, the migration's own self-check refuses to apply it", async () => {
    const d = await boot();
    try {
      await expect(d.exec(withoutRevokes(MIGRATION))).rejects.toThrow(/callable by anon|holds SELECT/);
    } finally {
      await d.close();
    }
  });
});
