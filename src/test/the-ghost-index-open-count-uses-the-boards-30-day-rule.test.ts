// @vitest-environment node
/**
 * THE GHOST INDEX OPEN COUNT USES THE BOARD'S 30-DAY RULE (S14X-273), AND ITS
 * READER RETURNS WHAT THE WRITER CARRIED (S14X-160, the database half).
 *
 * refresh_ghost_stats counted every stored row with missing_since IS NULL as
 * open while the board serves only rows posted within 30 days, and
 * get_ghost_job_index_stats dropped the stale_parts the writer always wrote.
 * On pglite, the live writer and reader first (lifted from 20260909201000 and
 * 20260808191630, the reader made SECURITY DEFINER as 20260820174500 did),
 * then this round's file:
 *   board A: ten open postings dated 10 days ago, one taken down;
 *   board B: fifteen open postings dated 40 days ago (stored, never served);
 *   two rows stamped missing.
 * The live writer counts twenty-five open on two boards; the new one ten on one,
 * with the age median over the ten, and the row says open_window_days 30.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const FIX = mig("20261112194000_");

/** A statement lifted whole from a migration: from its first line to the line that ends it. */
const lift = (text: string, start: string, end: string) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a);
  expect(a, `no ${start}`).toBeGreaterThan(-1);
  expect(b, `no end after ${start}`).toBeGreaterThan(a);
  return text.slice(a, b + end.length);
};
const WRITER_WAS = lift(mig("20260909201000_"), "CREATE OR REPLACE FUNCTION public.refresh_ghost_stats()", "END $$;");
const READER_WAS = lift(mig("20260808191630_"), "CREATE FUNCTION public.get_ghost_job_index_stats()", "\n$$;");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, company_token text NOT NULL, posted_at timestamptz, first_seen timestamptz,
    closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now());
`;

const FIXTURE = `
  INSERT INTO public.job_board_postings (id, company_token, company, posted_at, effective_posted, first_seen)
  SELECT 'a:' || g, 'a', 'Acme', now() - interval '10 days', now() - interval '10 days', now() - interval '10 days'
  FROM generate_series(1, 10) g;
  INSERT INTO public.job_board_postings (id, company_token, company, posted_at, effective_posted, first_seen)
  SELECT 'b:' || g, 'b', 'Bolt', now() - interval '40 days', now() - interval '40 days', now() - interval '40 days'
  FROM generate_series(1, 15) g;
  INSERT INTO public.job_board_postings (id, company_token, company, posted_at, effective_posted, first_seen, missing_since)
  SELECT 'm:' || g, 'a', 'Acme', now() - interval '5 days', now() - interval '5 days', now() - interval '5 days', now()
  FROM generate_series(1, 2) g;
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, absence_basis)
  VALUES ('a:gone', 'a', now() - interval '20 days', now() - interval '20 days', now() - interval '6 days', 'full_read');
`;

type Ghost = Record<string, unknown> & { total_open: number; total_companies: number; total_company_names: number; median_days_open: string };
let db: PGlite;
let was: Ghost;
let now: Ghost;

const read = async () => (await db.query<Ghost>(`SELECT * FROM public.get_ghost_job_index_stats()`)).rows[0];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(WRITER_WAS);
  await db.exec(READER_WAS);
  await db.exec(`ALTER FUNCTION public.get_ghost_job_index_stats() SECURITY DEFINER;`);
  await db.exec(`SELECT public.refresh_ghost_stats();`);
  was = await read();
  await db.exec(FIX);
  await db.exec(`SELECT public.refresh_ghost_stats();`);
  now = await read();
});

describe("the live writer and reader (the positive control)", () => {
  it("count the board that serves nothing and age its postings in the median, and return no stale_parts", () => {
    expect(Number(was.total_open)).toBe(25);
    expect(Number(was.total_companies)).toBe(2);
    expect(Number(was.median_days_open)).toBe(40);
    expect(Object.keys(was)).not.toContain("stale_parts");
  });
});

describe("the writer now", () => {
  it("counts only postings the board serves, by its 30-day window, and ages only those", () => {
    expect(Number(now.total_open)).toBe(10);
    expect(Number(now.total_companies)).toBe(1);
    expect(Number(now.total_company_names)).toBe(1);
    expect(Number(now.median_days_open)).toBe(10);
  });

  it("states the window in the row", () => {
    expect(now.open_window_days).toBe(30);
  });

  it("leaves the closure figures as they were", () => {
    for (const k of ["closed_90d", "observed_days", "median_days_to_close"]) expect(now[k], k).toEqual(was[k]);
  });
});

describe("the reader now", () => {
  it("returns the parts the writer carried forward, and an empty list when it carried none", async () => {
    expect(now.stale_parts).toEqual([]);
    await db.exec(`UPDATE public.job_board_stats_rollup SET v = v || '{"stale_parts": ["closures"]}' WHERE k = 'ghost_stats'`);
    expect((await read()).stale_parts).toEqual(["closures"]);
  });

  it("answers open_window_days null for a row written before the window existed", async () => {
    await db.exec(`UPDATE public.job_board_stats_rollup SET v = v - 'open_window_days' WHERE k = 'ghost_stats'`);
    expect((await read()).open_window_days).toBeNull();
  });

  it("is callable by the page's roles and by nobody through PUBLIC; the writer by neither client role", async () => {
    const r = (await db.query<{ anon_r: boolean; auth_r: boolean; pub_r: boolean; anon_w: boolean; definer: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_ghost_job_index_stats()', 'EXECUTE') AS anon_r,
             has_function_privilege('authenticated', 'public.get_ghost_job_index_stats()', 'EXECUTE') AS auth_r,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_ghost_job_index_stats()'::regprocedure AND a.grantee = 0) AS pub_r,
             has_function_privilege('anon', 'public.refresh_ghost_stats()', 'EXECUTE') AS anon_w,
             (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_ghost_job_index_stats()'::regprocedure) AS definer`)).rows[0];
    expect(r).toEqual({ anon_r: true, auth_r: true, pub_r: false, anon_w: false, definer: true });
  });
});

describe("the file", () => {
  it("runs twice", async () => {
    await db.exec(FIX);
    await db.exec(`SELECT public.refresh_ghost_stats();`);
    expect(Number((await read()).total_open)).toBe(10);
  });

  it("the end-state block refuses a writer whose age median left the window", async () => {
    const mutant = FIX.replace(
      "WHERE missing_since IS NULL AND effective_posted >= now() - interval '30 days' AND posted_at IS NOT NULL));",
      "WHERE missing_since IS NULL AND posted_at IS NOT NULL));",
    );
    expect(mutant).not.toBe(FIX);
    await expect(db.exec(`BEGIN;\n${mutant}`)).rejects.toThrow(/not all on the board's 30-day window/);
    await db.exec("ROLLBACK");
  });
});
