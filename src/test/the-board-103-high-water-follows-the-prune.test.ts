// @vitest-environment node
/**
 * THE BOARD-103 HIGH-WATER FOLLOWS THE PRUNE (job-board 2026-09-09.103, db lane).
 *
 * .103 prunes the dead entries on vendors whose robots and terms allow our
 * read, and retires lever:usasurveyjob, so it carries fewer boards than .102's
 * 44,499. The orphan prune refuses while JOB_SOURCES.length is below the
 * catalogue high-water (a strict less-than, index.ts), and the bundle cannot
 * tell a prune from a stale deploy, so the mark has to come down by
 * migration: 20261117110000, the same shape as .102's 20261111120000.
 *
 * WHAT HOLDS, with the real file and a real Postgres:
 *  1. the file is the newest high-water clamp, and every number it compares
 *     the mark with (the clamp, the self-check's condition and its two
 *     messages) is JOB_SOURCES.length, so a catalogue that moves after the file
 *     was written fails here until the file follows it;
 *  2. started from Supabase's default grants, it lowers a mark above the
 *     catalogue, never raises one, keeps the rest of the row, runs twice,
 *     tolerates a database with no mark, and changes no privilege and creates
 *     nothing;
 *  3. it refuses, and lowers nothing, until a slice of .103 or later has
 *     written job_board_meta.slice_stats: an OPTIONS answer of .103 comes
 *     while .102's last hop still runs, and that bundle's next pass end would
 *     raise the mark straight back;
 *  4. its self-check alone refuses a mark above the catalogue.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIGRATIONS = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const STAMP = "20261117110000";
const FILE = MIGRATIONS.find((f) => f.startsWith(`${STAMP}_`)) ?? null;
const RAW = FILE ? readFileSync(resolve(MIG_DIR, FILE), "utf8") : "";
/** What the database runs: the file without its comment lines (the reading a-demo-board-is-not-an-employer makes). */
const codeOf = (sql: string) => sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const CODE = codeOf(RAW);
const CLAMP = /LEAST\(\(v->>'size'\)::int,\s*(\d+)\)/g;
const clampsOf = (sql: string) => [...codeOf(sql).matchAll(CLAMP)].map((m) => Number(m[1]));
const N = JOB_SOURCES.length;

const TABLE = `
  ${SUPABASE_DEFAULTS}
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.job_board_meta ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.job_board_meta FROM anon, authenticated;
`;
const mark = async (db: PGlite) =>
  (await db.query<{ n: number | null }>(`SELECT (v->>'size')::int AS n FROM public.job_board_meta WHERE k = 'catalog_highwater'`)).rows[0]?.n ?? null;
const setMark = (db: PGlite, size: number) =>
  db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('catalog_highwater', '{"size": ${size}}') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
const setBuild = (db: PGlite, build: string) =>
  db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build": "${build}"}') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
/** The table's grants and every relation and function in public: what a clamp must leave as it found it. */
const footprint = async (db: PGlite) => ({
  acl: (await db.query<{ acl: string | null }>(`SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.job_board_meta'::regclass`)).rows[0].acl,
  relations: (await db.query<{ n: string }>(`SELECT relname AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' ORDER BY 1`)).rows.map((r) => r.n),
  functions: (await db.query<{ n: string }>(`SELECT proname AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' ORDER BY 1`)).rows.map((r) => r.n),
  anonReads: (await db.query<{ ok: boolean }>(`SELECT has_table_privilege('anon', 'public.job_board_meta', 'SELECT') AS ok`)).rows[0].ok,
});

describe("job-board .103's catalogue high-water migration follows the catalogue the bundle carries", () => {
  it("is the newest clamp, and every number it compares the mark with is JOB_SOURCES.length", () => {
    expect(FILE, `no migration ${STAMP}: nothing lowers the high-water after the prune, so the orphan prune stays blocked`).toBe(
      "20261117110000_the_catalogue_high_water_follows_the_dead_board_prune.sql",
    );
    const newest = MIGRATIONS.filter((f) => clampsOf(readFileSync(resolve(MIG_DIR, f), "utf8")).length > 0).pop();
    expect(newest, "a later migration clamps the high-water again, so this clamp is not the one production keeps").toBe(FILE);
    expect(clampsOf(RAW), `${FILE} must clamp the mark to JOB_SOURCES.length (${N})`).toEqual([N]);
    expect(CODE).toMatch(/WHERE k = 'catalog_highwater'/);
    const selfCheck = [...CODE.matchAll(/IF mark > (\d+) THEN\s+RAISE EXCEPTION/g)].map((m) => Number(m[1]));
    expect(selfCheck, "the self-check raises when the mark is above the catalogue").toEqual([N]);
    const said = [...CODE.matchAll(/above the (\d+) boards|at most (\d+)\)/g)].map((m) => Number(m[1] ?? m[2]));
    expect(said, "the self-check's messages name the same catalogue").toEqual([N, N]);
  });

  it("on a Postgres started from Supabase's default grants it lowers a higher mark, never raises one, runs again, tolerates no mark, and changes no privilege", async () => {
    const db = new PGlite();
    try {
      await db.exec(TABLE);
      await setBuild(db, "2026-09-09.103");
      const before = await footprint(db);
      await db.exec(RAW); // no mark row: a notice, nothing written
      expect(await mark(db)).toBeNull();
      // .102's mark, and one above it as a .102 bundle could leave it: both come down to the catalogue.
      for (const high of [44_499, N + 365]) {
        await db.exec(`DELETE FROM public.job_board_meta WHERE k = 'catalog_highwater'`);
        await db.exec(`INSERT INTO public.job_board_meta (k, v) VALUES ('catalog_highwater', '{"size": ${high}, "at": "2026-11-17T18:30:00Z"}')`);
        await db.exec(RAW);
        expect(await mark(db), String(high)).toBe(Math.min(high, N));
        expect(
          (await db.query<{ at: string }>(`SELECT v->>'at' AS at FROM public.job_board_meta WHERE k = 'catalog_highwater'`)).rows[0].at,
          "the rest of the row is kept",
        ).toBe("2026-11-17T18:30:00Z");
        await db.exec(RAW);
        expect(await mark(db), "a second run is a no-op").toBe(Math.min(high, N));
      }
      await setMark(db, N - 500);
      await db.exec(RAW);
      expect(await mark(db), "LEAST lowers and never raises").toBe(N - 500);
      expect(await footprint(db), "the clamp writes one row and touches no grant, table or function").toEqual(before);
      expect(before.anonReads).toBe(false);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("refuses, and lowers nothing, until a slice of .103 or later has written slice_stats", async () => {
    const db = new PGlite();
    try {
      await db.exec(TABLE);
      await setMark(db, N + 365);
      await expect(db.exec(RAW)).rejects.toThrow(/20261117110000: job_board_meta\.slice_stats names build \(none\), not job-board 2026-09-09\.103 or later/);
      expect(await mark(db)).toBe(N + 365);
      for (const build of ["2026-09-09.102", "2026-09-09.99", "2026-09-08.200", "garbage"]) {
        await setBuild(db, build);
        await expect(db.exec(RAW), build).rejects.toThrow(new RegExp(`names build ${build.replace(/\./g, "\\.")}, not job-board 2026-09-09\\.103`));
        expect(await mark(db), build).toBe(N + 365);
      }
      for (const build of ["2026-09-09.103", "2026-09-09.1000", "2026-12-01.1"]) {
        await setMark(db, N + 365);
        await setBuild(db, build);
        await db.exec(RAW);
        expect(await mark(db), build).toBe(N);
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it("its self-check alone refuses a mark above the catalogue", async () => {
    const db = new PGlite();
    try {
      await db.exec(TABLE);
      const selfCheck = /DO \$\$[\s\S]*?\$\$;/.exec(RAW.slice(RAW.lastIndexOf("-- SELF-CHECK")))?.[0] ?? "";
      expect(selfCheck).not.toBe("");
      await setMark(db, N + 1);
      await expect(db.exec(selfCheck)).rejects.toThrow(new RegExp(`self-check 20261117110000: the catalogue high-water is ${N + 1}, above the ${N} boards`));
      await setMark(db, N);
      await db.exec(selfCheck);
    } finally {
      await db.close();
    }
  }, 30_000);
});
