// @vitest-environment node
//
// Node, not jsdom: this file executes the migration's plpgsql in pglite, over
// the REAL field curve rather than a stub of it.
//
// THE FIELD CURVE THE PAGE WAITED A MINUTE FOR JOINS THE HOURLY CACHE.
//
// Two data pages computed the field curve live on every visit, at the same
// (90, 300) variant (the index page passes it; /jobs passes nothing and the
// defaults are those numbers). The call stopped answering inside its
// sixty-second header on 2026-09-27 and each page's caught Promise.all turned
// that into a missing section. 20260928004823 re-issues the hourly refresh so
// it writes an eighth part -- an object carrying its own stamp, the variant
// and the rows -- under the same carry-forward / stale-list contract the
// seven others carry, plus a sibling key that says WHY a run was carried.
//
// WHAT THIS FILE PROVES, BY RUNNING THE FUNCTION rather than reading it:
//   * a healthy run writes the part with its OWN stamp (clock, not the row's
//     transaction start), the variant the pages resolve to, the rows in the
//     curve's own thirty column names, an empty stale list and no error key;
//   * the cached rows are the 300-floor variant, told apart from the 25-floor
//     one by which fields answer over the same fixture;
//   * a statement cancel, a generic error (a table the real curve reads goes
//     missing) and an EMPTY answer (the fixture is removed) each carry the
//     previous object whole -- rows, variant AND stamp -- name the part stale
//     exactly once, record the reason, and leave the other seven parts
//     refreshed;
//   * the next healthy run replaces the rows, advances the stamp and clears
//     both the label and the error key;
//   * the first run ever, failing, writes a JSON null under the key and still
//     writes the row;
//   * the pre-fix definer (20260909228000) over the same stubs writes NO such
//     key -- the teeth;
//   * every other block of the body is byte-identical to the pre-fix copy once
//     the new block, its DECLARE line and the header value are removed, so the
//     literal spellings published-claims and instrument-recovery pin cannot
//     have moved;
//   * the ten-minute header covers the SUM of every callee's live header, and
//     the old five-minute one would not have -- both derived from the source;
//   * the migration restates the function's reachable set by name and carries
//     a self-check, and after it runs neither anon nor authenticated can
//     execute the function;
//   * the two crons that compute this curve cannot overlap: the stats job's
//     minute sits outside explore's whole window and vice versa, derived from
//     the last schedule each job carries in the migration lane, with the
//     minute it ran on before as the recorded red.
//
// Every source assertion runs against comment-stripped SQL through the shared
// helper, and this file's own comments are checked for the literals it pins.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { commentsOf, sqlCodeOf } from "./helpers/strip-comments";
import { CLEAR_FIXTURE, FIXTURE, SCHEMA, SCIENCE_CLEARS_THE_FLOOR } from "./helpers/field-curve-fixture";

// PGLITE BOOTS A POSTGRES AND REPLAYS MIGRATIONS, SO ITS HOOK IS NOT A UNIT
// TEST. The boot budget is separate from the assertion budget on purpose.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");

const NEW_FILE = "20260928004823_the_field_curve_the_page_waited_a_minute_for_joins_the_hourly_cache.sql";
const OLD_FILE = "20260909228000_a_leaderboard_read_live_on_every_visit_joins_the_hourly_cache.sql";
const CURVE_FILE = "20260928003117_a_timeout_that_blanks_a_section_is_raised_where_the_cron_pays_for_it.sql";
const CURVE_PREV = "20260925163842_a_field_pooled_over_boards_that_never_showed_us_an_event_is_not_a_field.sql";
const CRON_FILE = "20260928011742_two_five_minute_scans_of_one_curve_must_not_share_a_minute.sql";
const CURVE = "get_category_fill_curve";
const REFRESH = "refresh_stats_cache";
const STATS_JOB = "refresh-stats-cache";
const EXPLORE_JOB = "refresh-explore-cache";
const PART = "fill_curve";
const ERR = "fill_curve_error";
const DAY_BOUNDARY = "20260927211436";

/** The refresh_stats_cache definition alone, from a file that may hold others. */
const refreshFn = (sql: string): string => {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.refresh_stats_cache()");
  expect(at, "no refresh_stats_cache definition in this file").toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", at);
  return sql.slice(at, end + 4);
};
const NEW_RAW = read(NEW_FILE);
const NEW = sqlCodeOf(refreshFn(NEW_RAW));
const OLD = sqlCodeOf(refreshFn(read(OLD_FILE)));

const TIMEOUT_RE = /SET statement_timeout = '([^']+)'/;
const secs = (v: string): number => {
  const m = v.match(/^(\d+)\s*(s|min)$/);
  if (!m) throw new Error(`unparseable statement_timeout: ${v}`);
  return Number(m[1]) * (m[2] === "min" ? 60 : 1);
};
const latestWith = (needle: string): string => {
  const hits = FILES.filter((f) => read(f).includes(needle));
  if (hits.length === 0) throw new Error(`no migration contains ${needle}`);
  return read(hits[hits.length - 1]);
};
const timeoutOf = (fn: string): number => {
  const sql = sqlCodeOf(latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`));
  const start = sql.indexOf(`FUNCTION public.${fn}`);
  const head = sql.slice(start, sql.indexOf("AS $$", start));
  const m = TIMEOUT_RE.exec(head);
  return m ? secs(m[1]) : 0;
};
const calleesOf = (code: string): string[] =>
  [...new Set([...code.matchAll(/public\.(get_[a-z_]+)\s*\(/g)].map((m) => m[1]))].sort();

/** The new block, located by its first statement and closed by the empty guard's END IF. */
const BLOCK_START = "  BEGIN\n    curve_at := clock_timestamp();";
const blockBounds = (code: string): [number, number] => {
  const start = code.indexOf(BLOCK_START);
  expect(start, "the eighth part's block is missing").toBeGreaterThan(-1);
  const guardAt = code.indexOf(`IF NOT ('${PART}' = ANY(stale))`, start);
  expect(guardAt, "the eighth part's empty guard is missing").toBeGreaterThan(start);
  const endIf = code.indexOf("  END IF;\n", guardAt);
  expect(endIf).toBeGreaterThan(guardAt);
  return [start, endIf + "  END IF;\n".length];
};

describe("the migration: one function, the eighth part, the header, nothing else moved", () => {
  it("is the newest migration defining refresh_stats_cache, so the pins follow it", () => {
    const newest = FILES
      .filter((f) => { const s = read(f); return /FUNCTION\s+public\.refresh_stats_cache\s*\(/.test(s) && s.includes("$$"); })
      .pop();
    expect(newest).toBe(NEW_FILE);
  });

  it("defines exactly one function and drops none", () => {
    const code = sqlCodeOf(NEW_RAW);
    const defs = [...code.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
    expect(defs).toEqual(["refresh_stats_cache"]);
    expect(code).not.toMatch(/DROP FUNCTION/i);
    expect(code).not.toMatch(/CREATE\s+FUNCTION/i);
  });

  it("does not carry the marker phrase another guard selects its file by", () => {
    // stats-cache-resilience pins the six-handler shape on the newest file
    // holding this phrase; a re-issue that carried it would be pinned to a
    // shape it no longer has.
    expect(NEW_RAW).not.toContain("SIX STATISTICS, SIX FATES");
  });

  it("raises the header to ten minutes, and the budget is derived: every callee's live header sums under it, and would not have under five", () => {
    const head = NEW.slice(0, NEW.indexOf("AS $$"));
    const m = TIMEOUT_RE.exec(head);
    expect(m).toBeTruthy();
    const outer = secs(m![1]);
    expect(outer).toBe(600);
    const called = calleesOf(NEW.slice(NEW.indexOf("AS $$")));
    expect(called.length, "no callees found -- the regex broke").toBeGreaterThanOrEqual(8);
    const inner = called.map((fn) => [fn, timeoutOf(fn)] as const);
    for (const [fn, t] of inner) expect(t, `${fn} has no header, so it is unbounded inside the refresh`).toBeGreaterThan(0);
    expect(inner.find(([fn]) => fn === CURVE)![1], "the curve's live header").toBe(300);
    const sum = inner.reduce((a, [, t]) => a + t, 0);
    const detail = inner.map(([f, t]) => `${f}=${t}s`).join(", ");
    expect(outer, `inner ceilings total ${sum}s against ${outer}s: ${detail}`).toBeGreaterThanOrEqual(sum);
    // The reason the header moved, recorded as a number rather than a sentence.
    const oldOuter = secs(TIMEOUT_RE.exec(OLD.slice(0, OLD.indexOf("AS $$")))![1]);
    expect(oldOuter).toBe(300);
    expect(sum, `the old ${oldOuter}s header would have covered ${detail}`).toBeGreaterThan(oldOuter);
  });

  it("adds exactly one callee, the curve at the pages' variant", () => {
    const was = calleesOf(OLD.slice(OLD.indexOf("AS $$")));
    const now = calleesOf(NEW.slice(NEW.indexOf("AS $$")));
    expect(now).toEqual([...was, CURVE].sort());
    expect(NEW).toMatch(/FROM public\.get_category_fill_curve\(90, 300\) x/);
    expect([...NEW.matchAll(/public\.get_category_fill_curve\(/g)]).toHaveLength(1);
  });

  it("writes the part as {computed_at, variant, rows} with a stamp of its own, off the clock", () => {
    expect(NEW).toMatch(/curve_at := clock_timestamp\(\);/);
    expect(NEW).toMatch(/curve_at timestamptz;/);
    expect(NEW).toMatch(new RegExp(
      `jsonb_build_object\\('${PART}', jsonb_build_object\\(\\s*'computed_at', curve_at,\\s*` +
      `'variant', jsonb_build_object\\('p_days', 90, 'p_min_n', 300\\),\\s*` +
      `'rows', \\(SELECT COALESCE\\(jsonb_agg\\(row_to_json\\(x\\)\\), '\\[\\]'::jsonb\\) FROM public\\.get_category_fill_curve\\(90, 300\\) x\\)\\)\\)`,
    ));
  });

  it("guards the part in its own block: both arms carry the previous object, name it stale and record the reason", () => {
    const [start, end] = blockBounds(NEW);
    const block = NEW.slice(start, end);
    const carry = `stale := stale \\|\\| '${PART}'::text;\\s*payload := payload \\|\\| jsonb_build_object\\('${PART}', prev -> '${PART}'\\);`;
    const record = (reason: string) =>
      `payload := payload \\|\\| jsonb_build_object\\('${ERR}', jsonb_build_object\\(\\s*'at', clock_timestamp\\(\\), 'reason', '${reason}', 'sqlstate', SQLSTATE, 'message', SQLERRM\\)\\);`;
    expect(block).toMatch(new RegExp(`WHEN QUERY_CANCELED THEN\\s*${carry}\\s*${record("query_canceled")}`));
    expect(block).toMatch(new RegExp(`WHEN OTHERS THEN\\s*${carry}\\s*${record("error")}`));
    // Cast, never bare: an uncast literal on || resolved as an array literal
    // and killed the handler itself on 2026-08-12.
    expect([...NEW.matchAll(/stale := stale \|\| '[a-z_]+'(?!::text)/g)]).toEqual([]);
    // The block holds exactly one BEGIN and one EXCEPTION: isolated, not nested.
    expect(block.match(/\bBEGIN\b/g)).toHaveLength(1);
    expect(block.match(/\bEXCEPTION\b/g)).toHaveLength(1);
  });

  it("does not publish an empty curve as a good one, never names the part twice, and records the empty reason", () => {
    expect(NEW).toMatch(new RegExp(
      `IF NOT \\('${PART}' = ANY\\(stale\\)\\)\\s*AND jsonb_array_length\\(COALESCE\\(payload -> '${PART}' -> 'rows', '\\[\\]'::jsonb\\)\\) = 0 THEN\\s*` +
      `stale := stale \\|\\| '${PART}'::text;\\s*payload := payload \\|\\| jsonb_build_object\\('${PART}', prev -> '${PART}'\\);\\s*` +
      `payload := payload \\|\\| jsonb_build_object\\('${ERR}', jsonb_build_object\\(\\s*'at', clock_timestamp\\(\\), 'reason', 'empty', 'message', '[^']+'\\)\\);\\s*END IF;`,
    ));
  });

  it("the block sits after the seventh part and before the payload assembly; the write stays unconditional", () => {
    const [start, end] = blockBounds(NEW);
    const seventhEnd = NEW.indexOf("  END IF;\n", NEW.indexOf("IF NOT ('actively_hiring' = ANY(stale))"));
    const assemblyAt = NEW.indexOf("jsonb_build_object('computed_at', now())");
    const insertAt = NEW.indexOf("INSERT INTO public.job_board_meta");
    expect(seventhEnd).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(seventhEnd);
    expect(assemblyAt).toBeGreaterThan(end);
    expect(insertAt).toBeGreaterThan(assemblyAt);
    expect(NEW.slice(NEW.lastIndexOf("END;", insertAt), insertAt)).not.toMatch(/EXCEPTION/);
    expect(NEW).toMatch(/jsonb_build_object\('stale_parts', to_jsonb\(stale\)\)/);
  });

  it("is byte-identical to the pre-fix body everywhere but the new block, its DECLARE line and the header value", () => {
    const [start, end] = blockBounds(NEW);
    const without = (NEW.slice(0, start) + NEW.slice(end))
      .replace("  curve_at timestamptz;\n", "")
      .replace(TIMEOUT_RE, "SET statement_timeout = '<masked>'");
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(without)).toBe(norm(OLD.replace(TIMEOUT_RE, "SET statement_timeout = '<masked>'")));
  });

  it("teeth: the pre-fix definer has no such part", () => {
    expect(OLD).not.toMatch(new RegExp(PART));
    expect(OLD).not.toMatch(/curve_at/);
  });

  it("carries a non-round, unique stamp that sorts after the curve re-issue and after the day's last stamp", () => {
    const stamp = NEW_FILE.slice(0, 14);
    expect(stamp).toMatch(/^\d{14}$/);
    expect(stamp.slice(12), "a round second collides with the runner's own stamps").not.toBe("00");
    expect(FILES.filter((f) => f.startsWith(stamp))).toHaveLength(1);
    // The five-minute callee header must already be in place when this
    // function first runs with the call in it.
    expect(stamp > CURVE_FILE.slice(0, 14)).toBe(true);
    expect(stamp > DAY_BOUNDARY).toBe(true);
  });

  it("restates the reachable set by name after the definition and carries a self-check that reads the catalogue", () => {
    const code = sqlCodeOf(NEW_RAW);
    const defEnd = code.indexOf("$$;");
    const tail = code.slice(defEnd);
    expect(tail).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${REFRESH}\\(\\) FROM PUBLIC, anon, authenticated;`));
    expect(tail).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${REFRESH}\\(\\) TO service_role;`));
    expect(tail).not.toMatch(/TO anon|TO authenticated/);
    const selfCheck = tail.slice(tail.indexOf("DO $$"));
    expect(selfCheck).toMatch(/RAISE EXCEPTION/);
    expect(selfCheck).toMatch(/proconfig/);
    expect(selfCheck).toMatch(/prosrc/);
    expect(selfCheck).toMatch(/has_function_privilege\('anon'/);
    expect(selfCheck).toMatch(/has_function_privilege\('authenticated'/);
  });

  it("keeps the guarded literals out of the migration's prose", () => {
    const prose = NEW_RAW.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
    for (const lit of ["clock_timestamp()", "jsonb_build_object(", "= ANY(stale)", ":= stale ||", "WHEN QUERY_CANCELED THEN", "WHEN OTHERS THEN", "statement_timeout = '", "REVOKE ALL", "GRANT EXECUTE", "RAISE EXCEPTION"]) {
      expect(prose, `the migration's prose spells the guarded literal ${lit}`).not.toContain(lit);
    }
  });

  it("this file's own comments carry none of the literals it pins", () => {
    const own = commentsOf(readFileSync(__filename, "utf8"));
    for (const lit of ["clock_timestamp()", "jsonb_build_object(", "= ANY(stale)", ":= stale ||", "WHEN QUERY_CANCELED THEN", "WHEN OTHERS THEN", "QUERY_CANCELED", "statement_timeout = '", "get_category_fill_curve(90, 300)", "curve_at timestamptz", PART, ERR, "stale_parts", "computed_at", "prev -> ", "CREATE OR REPLACE FUNCTION", "DROP FUNCTION", "REVOKE ALL", "GRANT EXECUTE", "has_function_privilege", STATS_JOB, EXPLORE_JOB, "cron.schedule", "* * * *"]) {
      expect(own, `a comment in this file spells the guarded literal ${lit}`).not.toContain(lit);
    }
  });
});

describe("the two crons that compute this curve cannot overlap", () => {
  /** The LAST schedule a job carries in the lane, comment-stripped -- a later file re-schedules and the earlier one is history. */
  const scheduleOf = (job: string): string => {
    let found: string | null = null;
    for (const f of FILES) {
      const m = new RegExp(`cron\\.schedule\\(\\s*'${job}'\\s*,\\s*'([^']+)'`).exec(sqlCodeOf(read(f)));
      if (m) found = m[1];
    }
    if (!found) throw new Error(`no migration schedules ${job}`);
    return found;
  };
  const hourlyMinute = (expr: string): number => {
    const m = /^(\d{1,2}) \* \* \* \*$/.exec(expr.trim());
    if (!m) throw new Error(`${expr} is not a single-minute hourly schedule`);
    return Number(m[1]);
  };
  /** Each job's start must sit outside the other's whole window, measured forward around the hour. */
  const overlapViolations = (statsExpr: string, exploreExpr: string): string[] => {
    const out: string[] = [];
    const stats = hourlyMinute(statsExpr);
    const explore = hourlyMinute(exploreExpr);
    const statsOuter = timeoutOf(REFRESH) / 60;
    const exploreOuter = timeoutOf("refresh_explore_cache") / 60;
    expect(statsOuter).toBeGreaterThan(0);
    expect(exploreOuter).toBeGreaterThan(0);
    const afterExplore = (stats - explore + 60) % 60;
    const afterStats = (explore - stats + 60) % 60;
    if (afterExplore < exploreOuter) out.push(`stats starts ${afterExplore}min after explore, inside explore's ${exploreOuter}min window`);
    if (afterStats < statsOuter) out.push(`explore starts ${afterStats}min after stats, inside stats' ${statsOuter}min window`);
    return out;
  };

  it("the last schedule of each job in the lane keeps each start outside the other's window", () => {
    expect(overlapViolations(scheduleOf(STATS_JOB), scheduleOf(EXPLORE_JOB))).toEqual([]);
  });

  it("the move is one guarded reschedule that sorts after the arm it protects and changes nothing else", () => {
    expect(CRON_FILE > NEW_FILE).toBe(true);
    expect(FILES).toContain(CRON_FILE);
    const stamp = CRON_FILE.slice(0, 14);
    expect(stamp.slice(12)).not.toBe("00");
    expect(FILES.filter((f) => f.startsWith(stamp))).toHaveLength(1);
    const cron = sqlCodeOf(read(CRON_FILE));
    expect(cron).toMatch(/nspname = 'cron'/);
    expect(cron).toMatch(new RegExp(`cron\\.unschedule\\('${STATS_JOB}'\\)`));
    expect(cron).toMatch(new RegExp(`cron\\.schedule\\('${STATS_JOB}', '\\d{1,2} \\* \\* \\* \\*',\\s*\\$job\\$ SELECT public\\.${REFRESH}\\(\\); \\$job\\$\\)`));
    expect([...cron.matchAll(/cron\.schedule\(/g)]).toHaveLength(1);
    expect(cron).not.toMatch(/FUNCTION|ALTER|CREATE|DROP/i);
    // The schedule this lane resolves for the job IS the one this file sets.
    expect(scheduleOf(STATS_JOB)).toBe(/cron\.schedule\('[^']+', '([^']+)'/.exec(cron)![1]);
  });

  it("teeth: the minute it ran on before this change sat inside explore's window", () => {
    const before = overlapViolations("12 * * * *", scheduleOf(EXPLORE_JOB));
    expect(before.some((v) => v.startsWith("stats starts 5min after explore"))).toBe(true);
    expect(overlapViolations(scheduleOf(STATS_JOB), scheduleOf(EXPLORE_JOB))).toEqual([]);
    // And the other direction is a real constraint too, not a tautology.
    expect(overlapViolations("5 * * * *", scheduleOf(EXPLORE_JOB)).some((v) => v.startsWith("explore starts 2min after stats"))).toBe(true);
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
  CREATE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
  RETURNS TABLE (company text, company_token text, open_roles bigint, fill_incidence_14d numeric, tracking_days int, dated_share numeric)
  LANGUAGE sql AS $$ SELECT * FROM (VALUES
    ('Acme'::text, 'acme'::text, 120::bigint, 0.42::numeric, 40, 0.9::numeric),
    ('Globex'::text, 'globex'::text, 300::bigint, 0.31::numeric, 35, 0.8::numeric)) v LIMIT p_limit $$;
`;
const GHOST_MOVED = `CREATE OR REPLACE FUNCTION public.get_ghost_job_index_stats() RETURNS TABLE (total_open bigint, observed_days int) LANGUAGE sql AS $$ SELECT 794318::bigint, 59 $$;`;

/** The curve's RETURNS TABLE, lifted from the live file so the stand-in shares the real shape without a hand-typed column list. */
const returnsTable = (): string => {
  const sql = read(CURVE_FILE);
  const at = sql.indexOf("RETURNS TABLE (");
  const end = sql.indexOf("\n)", at);
  return sql.slice(at, end + 2);
};
/** The curve, raising instead of answering -- same signature, same shape, so a replace swaps it in and the live text swaps it back. */
const CANCELLED = `
  CREATE OR REPLACE FUNCTION public.${CURVE}(p_days int DEFAULT 90, p_min_n int DEFAULT 300)
  ${returnsTable()}
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END $$;
`;
const CURVE_COLUMNS = [...returnsTable().matchAll(/^\s+([a-z_0-9]+)\s+[a-z]+,?$/gm)].map((m) => m[1]);

interface Part { computed_at: string; variant: { p_days: number; p_min_n: number }; rows: Array<Record<string, unknown>> }
interface Err { at: string; reason: string; sqlstate?: string; message: string }
interface Cache {
  computed_at: string; stale_parts: string[];
  ghost_stats: { total_open: number } | null;
  actively_hiring: { computed_at: string; rows: Array<{ company: string }> } | null;
  fill_curve?: Part | null; fill_curve_error?: Err;
}

describe("the refresh, executed over the real curve", () => {
  let db: PGlite;
  const run = async (): Promise<Cache> => {
    await db.exec("SELECT public.refresh_stats_cache();");
    return (await db.query<{ v: Cache }>("SELECT v FROM public.job_board_meta WHERE k = 'stats_cache'")).rows[0].v;
  };
  const clearFixture = () => db.exec(CLEAR_FIXTURE);
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(STUBS);
    await db.exec(FIXTURE);
    await db.exec(read(CURVE_PREV));
    await db.exec(read(CURVE_FILE));
    await db.exec(NEW_RAW);
  });
  afterAll(async () => { await db.close(); });

  let healthy: Cache;
  it("healthy run: the key, its own stamp, the pages' variant, the curve's own columns, no error, nothing stale", async () => {
    healthy = await run();
    expect(healthy.stale_parts).toEqual([]);
    expect(ERR in healthy).toBe(false);
    expect(healthy.fill_curve?.variant).toEqual({ p_days: 90, p_min_n: 300 });
    expect(healthy.fill_curve?.rows.map((r) => r.category)).toEqual(["engineering"]);
    expect(CURVE_COLUMNS.length, "the column list parsed from the live file").toBe(30);
    for (const c of CURVE_COLUMNS) expect(healthy.fill_curve!.rows[0], `row lacks column ${c}`).toHaveProperty(c);
    // window_days is the observed depth of the ledgers, capped by p_days; the
    // pages gate on it, so it must ride along as an integer inside the cap.
    const win = healthy.fill_curve!.rows[0].window_days as number;
    expect(Number.isInteger(win)).toBe(true);
    expect(win).toBeGreaterThan(0);
    expect(win).toBeLessThanOrEqual(90);
    expect(typeof healthy.fill_curve?.computed_at).toBe("string");
    expect(Number.isNaN(new Date(healthy.fill_curve!.computed_at).getTime())).toBe(false);
    // Its own stamp: taken on the clock after seven other parts ran, so it is
    // never earlier than the row's transaction-start now().
    expect(new Date(healthy.fill_curve!.computed_at).getTime()).toBeGreaterThanOrEqual(new Date(healthy.computed_at).getTime());
    // The seven parts before it are untouched.
    expect(healthy.ghost_stats?.total_open).toBe(794317);
    expect(healthy.actively_hiring?.rows.map((r) => r.company)).toEqual(["Acme", "Globex"]);
  });

  it("the cached rows are the 300-floor variant: the 25-floor answer over the same fixture has a second field", async () => {
    const wide = (await db.query<{ category: string }>(`SELECT category FROM public.${CURVE}(90, 25) ORDER BY category`)).rows;
    expect(wide.map((r) => r.category)).toEqual(["engineering", "science"]);
  });

  it("a statement timeout carries the previous object whole, names the part stale, records the reason; the other parts refresh", async () => {
    await db.exec(CANCELLED);
    await db.exec(GHOST_MOVED);
    const v = await run();
    expect(v.stale_parts).toEqual([PART]);
    expect(v.fill_curve).toEqual(healthy.fill_curve);
    expect(v.fill_curve_error?.reason).toBe("query_canceled");
    expect(v.fill_curve_error?.sqlstate).toBe("57014");
    expect(v.ghost_stats?.total_open).toBe(794318);
    expect(v.actively_hiring?.rows.map((r) => r.company)).toEqual(["Acme", "Globex"]);
    // The carried stamp is OLDER than the row that carries it -- the fact the
    // page exists to print.
    expect(new Date(v.fill_curve!.computed_at).getTime()).toBeLessThanOrEqual(new Date(v.computed_at).getTime());
    expect(new Date(v.computed_at).getTime()).toBeGreaterThanOrEqual(new Date(healthy.computed_at).getTime());
  });

  it("a generic error from the REAL curve does the same: a table it reads goes missing", async () => {
    await db.exec(read(CURVE_FILE));
    await db.exec("ALTER TABLE public.job_board_closures RENAME TO job_board_closures_hidden;");
    try {
      const v = await run();
      expect(v.stale_parts).toEqual([PART]);
      expect(v.fill_curve).toEqual(healthy.fill_curve);
      expect(v.fill_curve_error?.reason).toBe("error");
      expect(v.fill_curve_error?.sqlstate).toBe("42P01");
      expect(v.fill_curve_error?.message).toMatch(/job_board_closures/);
      expect(v.ghost_stats?.total_open).toBe(794318);
    } finally {
      await db.exec("ALTER TABLE public.job_board_closures_hidden RENAME TO job_board_closures;");
    }
  });

  it("an EMPTY answer from the REAL curve is carried and named stale, exactly once, with its own reason", async () => {
    await clearFixture();
    const v = await run();
    expect(v.stale_parts).toEqual([PART]);
    expect(v.fill_curve).toEqual(healthy.fill_curve);
    expect(v.fill_curve_error?.reason).toBe("empty");
    expect(v.fill_curve_error?.sqlstate).toBeUndefined();
  });

  it("the next healthy run replaces the rows, advances the stamp and clears the label and the error key", async () => {
    await db.exec(FIXTURE);
    await db.exec(SCIENCE_CLEARS_THE_FLOOR);
    const v = await run();
    expect(v.stale_parts).toEqual([]);
    expect(ERR in v).toBe(false);
    expect(v.fill_curve?.rows.map((r) => r.category).sort()).toEqual(["engineering", "science"]);
    expect(new Date(v.fill_curve!.computed_at).getTime()).toBeGreaterThan(new Date(healthy.fill_curve!.computed_at).getTime());
  });

  it("first run ever, failing: a JSON null under the key, the part named stale, the row still written", async () => {
    await db.exec("DELETE FROM public.job_board_meta WHERE k = 'stats_cache';");
    await db.exec(CANCELLED);
    const v = await run();
    expect(v.fill_curve).toBeNull();
    expect(v.stale_parts).toEqual([PART]);
    expect(v.fill_curve_error?.reason).toBe("query_canceled");
    expect(v.ghost_stats?.total_open).toBe(794318);
  });

  it("teeth: the pre-fix definer run over the same stubs writes no curve at all, and the shipped text puts it back", async () => {
    await db.exec(read(CURVE_FILE));
    await db.exec(refreshFn(read(OLD_FILE)));
    const v = await run();
    expect(v.stale_parts).toEqual([]);
    expect(PART in v, "the 20260909228000 body wrote a fill_curve key").toBe(false);
    expect(ERR in v).toBe(false);
    await db.exec(NEW_RAW);
    const again = await run();
    expect(again.fill_curve?.rows.map((r) => r.category).sort()).toEqual(["engineering", "science"]);
    expect(again.stale_parts).toEqual([]);
  });
});
