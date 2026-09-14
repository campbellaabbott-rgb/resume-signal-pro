// @vitest-environment node
//
// Node, not jsdom: this file executes the migration's plpgsql in pglite, which
// needs real Node globals (a wasm Postgres, node:fs). There is no DOM here; the
// page half of this change is guarded in
// the-leaderboard-joins-the-hourly-cache-page.test.tsx.
//
// THE LEADERBOARD THE PAGE WAITED TWENTY SECONDS FOR WAS COMPUTABLE AN HOUR AGO.
//
// Measured live 2026-09-14: get_actively_hiring_companies(20) answered in
// 13.8-25.7s across five runs, one brushing its own 25s header; get_stats_cache
// answered in 0.24s. The Ghost Job Index read the six cached parts first and
// the leaderboard LIVE, every visit. 20260909228000 re-issues the hourly
// refresh so it writes a seventh part, `actively_hiring`, as
// { computed_at, rows } under the same carry-forward / stale_parts contract the
// other six have carried since 20260807214412.
//
// WHAT THIS FILE PROVES, BY RUNNING THE FUNCTION rather than reading it:
//   * a healthy run writes the key with the part's OWN stamp (clock, not the
//     row's now()) and an empty stale_parts;
//   * a QUERY_CANCELED, a generic error and an EMPTY answer each carry the
//     previous object whole -- rows AND stamp -- and name the part stale,
//     exactly once, while the other six parts refresh normally;
//   * the first run ever, failing, writes a JSON null under the key (nothing
//     to carry) and still writes the row;
//   * the pre-fix definer (20260812230000, an applied migration that never
//     changes) run over the same stubs writes NO such key -- the teeth;
//   * every other block of the body is byte-identical to the pre-fix copy once
//     the new block and its one DECLARE line are removed, so the literal
//     spellings published-claims and instrument-recovery pin cannot have moved.
//
// Every source assertion runs against comment-stripped SQL: the header quotes
// the shape it introduces, and a guard satisfied by prose is the trap this
// repo has fallen into seven times.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIG = resolve(__dirname, "../../supabase/migrations");
const NEW_FILE = "20260909228000_a_leaderboard_read_live_on_every_visit_joins_the_hourly_cache.sql";
const OLD_FILE = "20260812230000_cast_the_labels_everywhere_not_where_it_fired.sql";
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

/** The refresh_stats_cache definition alone, from a file that may hold others. */
const refreshFn = (sql: string): string => {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.refresh_stats_cache()");
  expect(at, "no refresh_stats_cache definition in this file").toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", at);
  return sql.slice(at, end + 4);
};
const NEW_RAW = read(NEW_FILE);
const NEW = stripSql(refreshFn(NEW_RAW));
const OLD = stripSql(refreshFn(read(OLD_FILE)));

describe("the migration: one function, the seventh part, nothing else moved", () => {
  it("is the newest migration defining refresh_stats_cache, so the pins follow it", () => {
    // The same selector published-claims uses: mentions the function with a
    // body. An OLDER definition sorting last would leave every guard here
    // asserting dead text.
    const newest = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => { const s = read(f); return /FUNCTION\s+public\.refresh_stats_cache\s*\(/.test(s) && s.includes("$$"); })
      .pop();
    expect(newest).toBe(NEW_FILE);
  });

  it("defines exactly one function and drops none", () => {
    const defs = [...stripSql(NEW_RAW).matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
    expect(defs).toEqual(["refresh_stats_cache"]);
    expect(stripSql(NEW_RAW)).not.toMatch(/DROP FUNCTION/i);
    expect(stripSql(NEW_RAW)).not.toMatch(/CREATE\s+FUNCTION/i);
  });

  it("keeps the 5-minute header the cron run is governed by", () => {
    expect(NEW).toMatch(/SET statement_timeout = '5min'/);
  });

  it("writes actively_hiring as {computed_at, rows} with a stamp of its own, off the clock", () => {
    // now() is the transaction start -- the row's top-level computed_at. The
    // part's stamp must be a different fact: the moment these rows were
    // computed, which on a carried run is the run that produced them.
    expect(NEW).toMatch(/hiring_at := clock_timestamp\(\);/);
    expect(NEW).toMatch(/jsonb_build_object\('actively_hiring', jsonb_build_object\(\s*'computed_at', hiring_at,\s*'rows', \(SELECT COALESCE\(jsonb_agg\(row_to_json\(x\)\), '\[\]'::jsonb\) FROM public\.get_actively_hiring_companies\(20\) x\)\)\)/);
  });

  it("guards the part in its own block: both arms carry the previous object and name it stale", () => {
    const at = NEW.indexOf("hiring_at := clock_timestamp();");
    const block = NEW.slice(NEW.lastIndexOf("BEGIN", at), NEW.indexOf("END;", at) + 4);
    // The two arms, since WHEN OTHERS does not catch a statement timeout.
    expect(block).toMatch(/WHEN QUERY_CANCELED THEN\s*stale := stale \|\| 'actively_hiring'::text;\s*payload := payload \|\| jsonb_build_object\('actively_hiring', prev -> 'actively_hiring'\);/);
    expect(block).toMatch(/WHEN OTHERS THEN\s*stale := stale \|\| 'actively_hiring'::text;\s*payload := payload \|\| jsonb_build_object\('actively_hiring', prev -> 'actively_hiring'\);/);
    // Cast, never bare: an uncast literal on || resolved as an array literal
    // and killed the handler itself on 2026-08-12.
    expect([...NEW.matchAll(/stale := stale \|\| '[a-z_]+'(?!::text)/g)]).toEqual([]);
  });

  it("does not publish an empty leaderboard as a good one, and never names the part twice", () => {
    expect(NEW).toMatch(/IF NOT \('actively_hiring' = ANY\(stale\)\)\s*AND jsonb_array_length\(COALESCE\(payload -> 'actively_hiring' -> 'rows', '\[\]'::jsonb\)\) = 0 THEN\s*stale := stale \|\| 'actively_hiring'::text;\s*payload := payload \|\| jsonb_build_object\('actively_hiring', prev -> 'actively_hiring'\);\s*END IF;/);
  });

  it("the block sits before the payload assembly and the write stays unconditional", () => {
    const blockAt = NEW.indexOf("'actively_hiring'");
    const assemblyAt = NEW.indexOf("jsonb_build_object('computed_at', now())");
    const insertAt = NEW.indexOf("INSERT INTO public.job_board_meta");
    expect(blockAt).toBeGreaterThan(-1);
    expect(assemblyAt).toBeGreaterThan(blockAt);
    expect(insertAt).toBeGreaterThan(assemblyAt);
    expect(NEW.slice(NEW.lastIndexOf("END;", insertAt), insertAt)).not.toMatch(/EXCEPTION/);
    expect(NEW).toMatch(/jsonb_build_object\('stale_parts', to_jsonb\(stale\)\)/);
  });

  it("is byte-identical to the pre-fix body everywhere but the new block and its DECLARE line", () => {
    // Remove precisely what the header says was added; what remains must be
    // the 20260812230000 text, whitespace-normalised. This is the guard that
    // stops a re-typed copy from quietly moving a spelling some other suite
    // pins (published-claims' null guards, instrument-recovery's 5min).
    const start = NEW.indexOf("  BEGIN\n    hiring_at := clock_timestamp();");
    expect(start).toBeGreaterThan(-1);
    const endIf = NEW.indexOf("  END IF;\n", NEW.indexOf("IF NOT ('actively_hiring' = ANY(stale))", start));
    expect(endIf).toBeGreaterThan(start);
    const without = (NEW.slice(0, start) + NEW.slice(endIf + "  END IF;\n".length))
      .replace("  hiring_at timestamptz;\n", "");
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(without)).toBe(norm(OLD));
  });

  it("teeth: the pre-fix definer has no such part", () => {
    expect(OLD).not.toMatch(/actively_hiring/);
    expect(OLD).not.toMatch(/clock_timestamp/);
  });
});

// ── executed in pglite ────────────────────────────────────────────────────────
const STUBS = `
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.get_ghost_job_index_stats() RETURNS TABLE (total_open bigint, observed_days int)
    LANGUAGE sql AS $$ SELECT 794317::bigint, 58 $$;
  CREATE FUNCTION public.get_date_coverage() RETURNS TABLE (source text, total bigint, dated bigint)
    LANGUAGE sql AS $$ SELECT 'greenhouse'::text, 100::bigint, 90::bigint $$;
  CREATE FUNCTION public.get_entry_level_stats() RETURNS TABLE (entry_open bigint, entry_share numeric)
    LANGUAGE sql AS $$ SELECT 10::bigint, 0.1::numeric $$;
  CREATE FUNCTION public.get_entry_level_companies(p_limit int) RETURNS TABLE (company text, n bigint)
    LANGUAGE sql AS $$ SELECT 'x'::text, 1::bigint $$;
  CREATE FUNCTION public.get_hiring_trends() RETURNS TABLE (category text, n bigint)
    LANGUAGE sql AS $$ SELECT 'engineering'::text, 1::bigint $$;
  CREATE FUNCTION public.get_trending_categories() RETURNS TABLE (category text, n bigint)
    LANGUAGE sql AS $$ SELECT 'engineering'::text, 1::bigint $$;
`;
/** The leaderboard callee, in each of the ways it can behave. Same signature
 *  and shape throughout, so CREATE OR REPLACE can swap bodies between runs. */
const leaderboard = (body: string) => `
  CREATE OR REPLACE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
  RETURNS TABLE (company text, company_token text, open_roles bigint, fill_incidence_14d numeric, tracking_days int, dated_share numeric)
  LANGUAGE plpgsql AS $$ BEGIN ${body} END $$;
`;
const ANSWERS = leaderboard(`RETURN QUERY SELECT * FROM (VALUES
  ('Acme'::text, 'acme'::text, 120::bigint, 0.42::numeric, 40, 0.9::numeric),
  ('Globex'::text, 'globex'::text, 300::bigint, 0.31::numeric, 35, 0.8::numeric)) v LIMIT p_limit;`);
const ANSWERS_LATER = leaderboard(`RETURN QUERY SELECT 'Initech'::text, 'initech'::text, 90::bigint, 0.5::numeric, 30, 0.95::numeric;`);
const CANCELLED = leaderboard(`RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled';`);
const ERRORS = leaderboard(`RAISE EXCEPTION 'relation does not exist';`);
const EMPTY = leaderboard(`RETURN QUERY SELECT 'x'::text, 'x'::text, 0::bigint, 0::numeric, 0, 0::numeric WHERE false;`);

interface Row { v: { computed_at: string; stale_parts: string[]; ghost_stats: { total_open: number } | null; actively_hiring: { computed_at: string; rows: Array<{ company: string }> } | null | undefined } }

describe("the refresh, executed", () => {
  let db: PGlite;
  const run = async () => {
    await db.exec("SELECT public.refresh_stats_cache();");
    return (await db.query<Row>("SELECT v FROM public.job_board_meta WHERE k = 'stats_cache'")).rows[0].v;
  };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STUBS);
    await db.exec(ANSWERS);
    await db.exec(NEW_RAW);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  let healthy: Row["v"];
  it("healthy run: the key, its own stamp, an empty stale_parts", async () => {
    healthy = await run();
    expect(healthy.stale_parts).toEqual([]);
    expect(healthy.actively_hiring?.rows.map((r) => r.company)).toEqual(["Acme", "Globex"]);
    expect(typeof healthy.actively_hiring?.computed_at).toBe("string");
    expect(Number.isNaN(new Date(healthy.actively_hiring!.computed_at).getTime())).toBe(false);
    // Its own stamp: taken on the clock after six other parts ran, so it is
    // never earlier than the row's transaction-start now().
    expect(new Date(healthy.actively_hiring!.computed_at).getTime())
      .toBeGreaterThanOrEqual(new Date(healthy.computed_at).getTime());
    expect(healthy.ghost_stats?.total_open).toBe(794317);
  }, 60_000);

  it("a statement timeout carries the previous object whole and names the part stale; the other parts refresh", async () => {
    await db.exec(CANCELLED);
    // Move one sibling so "the other parts refresh" is observed, not assumed.
    await db.exec(`CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats() RETURNS TABLE (total_open bigint, observed_days int) LANGUAGE sql AS $$ SELECT 794318::bigint, 59 $$;`);
    const v = await run();
    expect(v.stale_parts).toEqual(["actively_hiring"]);
    expect(v.actively_hiring).toEqual(healthy.actively_hiring);
    expect(v.ghost_stats?.total_open).toBe(794318);
    expect(new Date(v.computed_at).getTime()).toBeGreaterThanOrEqual(new Date(healthy.computed_at).getTime());
    // The carried stamp is OLDER than the row that carries it -- the fact the
    // page exists to print.
    expect(new Date(v.actively_hiring!.computed_at).getTime()).toBeLessThanOrEqual(new Date(v.computed_at).getTime());
  }, 60_000);

  it("a generic error does the same", async () => {
    await db.exec(ERRORS);
    const v = await run();
    expect(v.stale_parts).toEqual(["actively_hiring"]);
    expect(v.actively_hiring).toEqual(healthy.actively_hiring);
  }, 60_000);

  it("an EMPTY answer is carried and named stale, exactly once", async () => {
    await db.exec(EMPTY);
    const v = await run();
    expect(v.stale_parts).toEqual(["actively_hiring"]);
    expect(v.actively_hiring).toEqual(healthy.actively_hiring);
  }, 60_000);

  it("the next healthy run replaces the rows, advances the stamp and clears the label", async () => {
    await db.exec(ANSWERS_LATER);
    const v = await run();
    expect(v.stale_parts).toEqual([]);
    expect(v.actively_hiring?.rows.map((r) => r.company)).toEqual(["Initech"]);
    expect(new Date(v.actively_hiring!.computed_at).getTime()).toBeGreaterThan(new Date(healthy.actively_hiring!.computed_at).getTime());
  }, 60_000);

  it("first run ever, failing: a JSON null under the key, the part named stale, the row still written", async () => {
    await db.exec("DELETE FROM public.job_board_meta WHERE k = 'stats_cache';");
    await db.exec(CANCELLED);
    const v = await run();
    expect(v.actively_hiring).toBeNull();
    expect(v.stale_parts).toEqual(["actively_hiring"]);
    expect(v.ghost_stats?.total_open).toBe(794318);
  }, 60_000);

  it("teeth: the pre-fix definer run over the same stubs writes no leaderboard at all", async () => {
    await db.exec(ANSWERS);
    await db.exec(refreshFn(read(OLD_FILE)));
    const v = await run();
    expect(v.stale_parts).toEqual([]);
    expect("actively_hiring" in v, "the 20260812230000 body wrote an actively_hiring key").toBe(false);
    // ...and the shipped text puts it back.
    await db.exec(NEW_RAW);
    const again = await run();
    expect(again.actively_hiring?.rows.map((r) => r.company)).toEqual(["Acme", "Globex"]);
  }, 60_000);
});
