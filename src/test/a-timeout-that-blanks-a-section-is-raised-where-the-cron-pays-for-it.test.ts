// @vitest-environment node
//
// Node, not jsdom: this file executes two migrations in pglite, which needs
// real Node globals (a wasm Postgres, node:fs).
//
// A TIMEOUT THAT BLANKS A SECTION IS RAISED WHERE THE CRON PAYS FOR IT.
//
// get_category_fill_curve(90, 300) capped itself at sixty seconds and the
// catalogue outgrew the cap: 34s on 2026-09-25, 47s on 2026-09-27 at 14:xx,
// and at 18:xx, 23:xx and 23:48Z the same day the full minute with NO rows
// (SQLSTATE 57014). Both data pages held the call inside a caught
// Promise.all, so the cap did not shorten the field section, it removed it.
// 20260928003117 re-issues the function with its own header raised to five
// minutes and NOTHING else changed; the companion 20260928004823 moves the
// rows into the hourly stats cache so no visitor pays the five minutes.
//
// WHAT THIS FILE PROVES:
//   * the re-issue is the newest definition, so every pin follows it;
//   * it defines one function, drops nothing, and its head names the new
//     value where the predecessor named the old one;
//   * the two comment-stripped definitions are IDENTICAL once the one header
//     line is masked -- and the raw texts differ on exactly one line, which is
//     that line. The comparison has teeth: the previous re-issue (20260909217500
//     to 20260925163842) changed the body and fails it, and one moved token in
//     the new file fails it;
//   * the other cron that calls the curve, refresh_explore_cache, still covers
//     the sum of its callees' headers -- derived from the source, as
//     explore-claims does, not quoted;
//   * EXECUTED in pglite: the same fixture answers the same rows before and
//     after, and only pg_proc.proconfig moves.
//
// Every source assertion runs against comment-stripped SQL through the shared
// helper, and this file's own comments are checked for the literals it pins.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { commentsOf, sqlCodeOf } from "./helpers/strip-comments";
import { FIXTURE, SCHEMA } from "./helpers/field-curve-fixture";

// PGLITE BOOTS A POSTGRES AND REPLAYS MIGRATIONS, SO ITS HOOK IS NOT A UNIT
// TEST. The boot budget is separate from the assertion budget on purpose: a
// hung query still fails long before a boot would.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");

const FN = "get_category_fill_curve";
const NEW_FILE = "20260928003117_a_timeout_that_blanks_a_section_is_raised_where_the_cron_pays_for_it.sql";
const PREV_FILE = "20260925163842_a_field_pooled_over_boards_that_never_showed_us_an_event_is_not_a_field.sql";
const PREV_PREV_FILE = "20260909217500_a_field_is_only_as_open_as_the_boards_we_can_read.sql";
/** The newest stamp that existed before this lane; both new files must sort after it. */
const DAY_BOUNDARY = "20260927211436";

/**
 * One function's definition, cut from its CREATE to the close of the dollar
 * tag it opened with -- so an assertion about this function can never be
 * satisfied by a DO block sharing the file.
 */
function definitionOf(sql: string, fn: string): string {
  const m = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").exec(sql);
  if (!m) throw new Error(`no definition of ${fn}`);
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(m.index));
  if (!tag) throw new Error(`no body opener for ${fn}`);
  const open = m.index + tag.index + tag[0].indexOf(tag[1]);
  const close = sql.indexOf(tag[1], open + tag[1].length);
  if (close < 0) throw new Error(`unterminated body for ${fn}`);
  return sql.slice(m.index, close + tag[1].length);
}

/** The head only: signature to the body opener, where a function's SET lines live. */
const headOf = (def: string) => def.slice(0, def.indexOf("AS $$"));
const TIMEOUT_RE = /SET statement_timeout = '([^']+)'/;
const MASK = "SET statement_timeout = '<masked>'";
/** Comment-stripped code with the one header line masked. */
const masked = (def: string) => sqlCodeOf(def).replace(TIMEOUT_RE, MASK);

/** '4min' -> 240, '90s' -> 90; anything else is a parse failure, never a zero. */
const secs = (v: string): number => {
  const m = v.match(/^(\d+)\s*(s|min)$/);
  if (!m) throw new Error(`unparseable statement_timeout: ${v}`);
  return Number(m[1]) * (m[2] === "min" ? 60 : 1);
};

const NEW_RAW = read(NEW_FILE);
const NEW_DEF = definitionOf(NEW_RAW, FN);
const PREV_DEF = definitionOf(read(PREV_FILE), FN);
const PREV_PREV_DEF = definitionOf(read(PREV_PREV_FILE), FN);

describe("the migration: one header line, nothing else", () => {
  it("was the newest definition of the curve when it landed, and every later re-issue keeps its header", () => {
    // The selector published-claims uses: mentions the function with a body.
    // RE-ANCHORED 2026-10-02. This file was the newest definition until the
    // curve was re-issued with a per-board watch floor on its day-30 pool
    // (20261002121843). The pins above still compare THIS file to its
    // predecessor, because the claim under test is this file's own -- one
    // header line, nothing else -- and the property that must outlive it is
    // the raised header: a later re-issue that put the sixty seconds back
    // would blank the section on the cron path this file paid for.
    const defining = FILES.filter((f) => { const s = read(f); return new RegExp(`FUNCTION\\s+public\\.${FN}\\s*\\(`).test(s) && s.includes("$$"); });
    expect(defining, "this file is still a definition of the curve").toContain(NEW_FILE);
    expect(defining[defining.indexOf(NEW_FILE) - 1], "and it replaced the file its pins compare against").toBe(PREV_FILE);
    const later = defining.slice(defining.indexOf(NEW_FILE) + 1);
    expect(later, "the 2026-10-02 watch-floor re-issue").toContain("20261002121843_a_field_pools_only_the_roles_whose_whole_thirty_days_we_could_see.sql");
    for (const f of later) {
      const head = headOf(definitionOf(read(f), FN));
      const m = TIMEOUT_RE.exec(sqlCodeOf(head));
      expect(m, `${f} re-issued the curve with no header timeout`).toBeTruthy();
      expect(secs(m![1]), `${f} moved the header the cron pays for`).toBe(300);
    }
  });

  it("defines exactly one function, drops none, creates none bare", () => {
    const code = sqlCodeOf(NEW_RAW);
    const defs = [...code.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
    expect(defs).toEqual([FN]);
    expect(code).not.toMatch(/DROP FUNCTION/i);
    expect(code).not.toMatch(/CREATE\s+FUNCTION/i);
  });

  it("raises the function's own header to five minutes where the predecessor said sixty seconds", () => {
    const now = TIMEOUT_RE.exec(sqlCodeOf(headOf(NEW_DEF)));
    const was = TIMEOUT_RE.exec(sqlCodeOf(headOf(PREV_DEF)));
    expect(now, "the re-issue has no header timeout at all").toBeTruthy();
    expect(was, "the predecessor has no header timeout at all").toBeTruthy();
    expect(secs(now![1])).toBe(300);
    expect(secs(was![1])).toBe(60);
    // Exactly one such line in each head: a second SET would be a second change.
    expect(sqlCodeOf(headOf(NEW_DEF)).match(/statement_timeout/g)).toHaveLength(1);
  });

  it("is byte-identical to 20260925163842 once the header line is masked (comment-stripped)", () => {
    expect(masked(NEW_DEF)).toBe(masked(PREV_DEF));
  });

  it("the raw texts differ on exactly one line, and it is the header line", () => {
    const a = NEW_DEF.split("\n");
    const b = PREV_DEF.split("\n");
    expect(a.length).toBe(b.length);
    const diff = a.map((line, i) => [i, line, b[i]] as const).filter(([, x, y]) => x !== y);
    expect(diff, "more than one line moved").toHaveLength(1);
    const [, now, was] = diff[0];
    expect(now).toMatch(TIMEOUT_RE);
    expect(was).toMatch(TIMEOUT_RE);
  });

  it("teeth: the comparison is not vacuous -- the previous re-issue changed the body and fails it", () => {
    expect(masked(PREV_DEF)).not.toBe(masked(PREV_PREV_DEF));
  });

  it("teeth: one moved token in the body fails it, and so does a second head change hidden beside the mask", () => {
    const token = "GREATEST(p_min_n, 25)";
    expect(NEW_DEF.includes(token), "the floor expression the mutation targets is missing").toBe(true);
    expect(masked(NEW_DEF.replace(token, "GREATEST(p_min_n, 26)"))).not.toBe(masked(PREV_DEF));
    expect(masked(NEW_DEF.replace("SET search_path = public", "SET search_path = public, pg_temp"))).not.toBe(masked(PREV_DEF));
  });

  it("restates the reachable set by name at the foot, unchanged from the predecessor", () => {
    const code = sqlCodeOf(NEW_RAW);
    const defAt = code.indexOf(`FUNCTION public.${FN}(`);
    const revoke = /REVOKE ALL ON FUNCTION public\.get_category_fill_curve\(int, int\) FROM PUBLIC, anon, authenticated;/;
    const grant = /GRANT EXECUTE ON FUNCTION public\.get_category_fill_curve\(int, int\) TO anon, authenticated, service_role;/;
    expect(code).toMatch(revoke);
    expect(code).toMatch(grant);
    expect(code.search(revoke)).toBeGreaterThan(defAt);
    expect(code.search(grant)).toBeGreaterThan(code.search(revoke));
    // The predecessor granted the same three roles: the reachable set did not move.
    expect(sqlCodeOf(read(PREV_FILE))).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_category_fill_curve\(int, int\) TO anon, authenticated, service_role;/);
  });

  it("carries a non-round, unique stamp that sorts after its predecessor and after the day's last stamp", () => {
    const stamp = NEW_FILE.slice(0, 14);
    expect(stamp).toMatch(/^\d{14}$/);
    expect(stamp.slice(12), "a round second collides with the runner's own stamps").not.toBe("00");
    expect(FILES.filter((f) => f.startsWith(stamp))).toHaveLength(1);
    expect(stamp > PREV_FILE.slice(0, 14)).toBe(true);
    expect(stamp > DAY_BOUNDARY).toBe(true);
  });

  it("keeps the guarded header literal out of the migration's prose", () => {
    const prose = NEW_RAW.split("\n").filter((l) => /^\s*--/.test(l)).join("\n");
    expect(prose).not.toMatch(/statement_timeout = '/);
    expect(prose).not.toMatch(/REVOKE ALL/);
    expect(prose).not.toMatch(/GRANT EXECUTE/);
  });

  it("this file's own comments carry none of the literals it pins", () => {
    const own = commentsOf(readFileSync(__filename, "utf8"));
    for (const lit of ["statement_timeout = '", "statement_timeout=", "GREATEST(p_min_n", "FROM PUBLIC, anon, authenticated", "TO anon, authenticated, service_role", "CREATE OR REPLACE", "DROP FUNCTION", "CREATE FUNCTION", "dated_cohort_n_30", "AS $$"]) {
      expect(own, `a comment in this file spells the guarded literal ${lit}`).not.toContain(lit);
    }
  });
});

describe("the other cron that calls it still fits", () => {
  const latestWith = (needle: string): string => {
    const hits = FILES.filter((f) => read(f).includes(needle));
    if (hits.length === 0) throw new Error(`no migration contains ${needle}`);
    return read(hits[hits.length - 1]);
  };
  /** A function's own header timeout, from its newest definition; 0 when it has none. */
  const timeoutOf = (fn: string): number => {
    const sql = sqlCodeOf(latestWith(`CREATE OR REPLACE FUNCTION public.${fn}`));
    const start = sql.indexOf(`FUNCTION public.${fn}`);
    const head = sql.slice(start, sql.indexOf("AS $$", start));
    const m = TIMEOUT_RE.exec(head);
    return m ? secs(m[1]) : 0;
  };

  it("refresh_explore_cache's outer ceiling covers the sum of its callees with the curve at five minutes", () => {
    const sql = sqlCodeOf(latestWith("CREATE OR REPLACE FUNCTION public.refresh_explore_cache"));
    const start = sql.indexOf("FUNCTION public.refresh_explore_cache");
    const body = sql.slice(start, sql.indexOf("$$;", start));
    const called = [...new Set([...body.matchAll(/public\.(get_[a-z_]+)\s*\(/g)].map((m) => m[1]))];
    expect(called, "the explore refresh no longer calls the curve -- this budget is moot, and the header's claim is stale").toContain(FN);
    const inner = called.map((fn) => [fn, timeoutOf(fn)] as const);
    for (const [fn, t] of inner) expect(t, `${fn} has no header, so it is unbounded inside the refresh`).toBeGreaterThan(0);
    expect(inner.find(([fn]) => fn === FN)![1]).toBe(300);
    const sum = inner.reduce((a, [, t]) => a + t, 0);
    const outer = timeoutOf("refresh_explore_cache");
    expect(outer, `inner ceilings total ${sum}s against ${outer}s: ${inner.map(([f, t]) => `${f}=${t}s`).join(", ")}`).toBeGreaterThanOrEqual(sum);
  });
});

// ── executed in pglite ────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const curveRows = async (db: PGlite, minN: number) =>
  (await db.query<Row>(`SELECT * FROM public.${FN}(90, ${minN}) ORDER BY category`)).rows;
const proconfig = async (db: PGlite) =>
  String((await db.query<{ proconfig: unknown }>(
    `SELECT p.proconfig FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = '${FN}'`,
  )).rows.map((r) => r.proconfig));
const definitions = async (db: PGlite) =>
  Number((await db.query<{ n: number | string }>(
    `SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = '${FN}'`,
  )).rows[0].n);

describe("executed: the same fixture answers the same rows before and after; only proconfig moves", () => {
  let db: PGlite;
  let before: Row[];
  let cfgBefore: string;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(FIXTURE);
    await db.exec(read(PREV_FILE));
    cfgBefore = await proconfig(db);
    before = await curveRows(db, 300);
    await db.exec(NEW_RAW);
  });
  afterAll(async () => { await db.close(); });

  it("the fixture is inside the estimator's reach (guards the guard)", async () => {
    // At the absolute floor both fields answer; at the pages' floor only the
    // large one does. That difference is what tells the two variants apart.
    expect(before.map((r) => r.category)).toEqual(["engineering"]);
    expect((await curveRows(db, 25)).map((r) => r.category)).toEqual(["engineering", "science"]);
  });

  it("the predecessor's proconfig carried sixty seconds; the re-issue carries five minutes", async () => {
    expect(cfgBefore).toContain("statement_timeout=60s");
    expect(await proconfig(db)).toContain("statement_timeout=5min");
    expect(await proconfig(db)).not.toContain("statement_timeout=60s");
  });

  it("exactly one definition survives the re-issue", async () => {
    expect(await definitions(db)).toBe(1);
  });

  it("the rows are identical, column for column", async () => {
    const after = await curveRows(db, 300);
    expect(after).toEqual(before);
    expect(Object.keys(after[0]).length, "the thirty columns").toBe(30);
    // window_days is the OBSERVED depth of the ledgers, capped by p_days, so
    // over a 33-day fixture it is well under the cap and never the cap itself.
    expect(Number.isInteger(after[0].window_days)).toBe(true);
    expect(after[0].window_days as number).toBeGreaterThan(0);
    expect(after[0].window_days as number).toBeLessThanOrEqual(90);
  });
});
