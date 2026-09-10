import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A FRESHNESS FIGURE THAT COUNTED BOARDS THE SITE STOPPED SERVING.
 *
 * The 'freshness' rollup's population was "stamps whose token holds >= 1
 * posting row". Written when unverified boards' rows were DELETED, that meant
 * "boards being served"; after 20260827182000 switched the sweep to stamping
 * missing_since, dark boards stayed in the population and their stamps aged
 * without bound (max_min 14.6 d on 2026-09-10, 'constructor' and 'applied').
 *
 * Migration 20260909221000 narrows the population to stamps with at least
 * one LIVE row and publishes the excluded stamps as their own bucket. This
 * pins: one function; the predicate; the four existing keys unchanged in
 * meaning and the two new ones; the other two rollup blocks byte-identical
 * to the definition it re-issues; the revoke by name; and the status
 * endpoint reading the bucket from the row (the RPC's signature does not
 * move). Text tests run over comment-stripped SQL so prose about a
 * predicate is never mistaken for the predicate.
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const STAMP = "20260909221000";
const FILE = readdirSync(MIG_DIR).find((f) => f.startsWith(STAMP));
const RAW = FILE ? readFileSync(resolve(MIG_DIR, FILE), "utf8") : "";
const strip = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const SQL = strip(RAW);
const PREV = strip(readFileSync(resolve(MIG_DIR, "20260904090000_a_count_that_opened_every_description_to_say_one_number.sql"), "utf8"));
const PROSE = RAW.replace(/\n--[ \t]*/g, " ");
const IDX = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8")
  .replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");

/** The freshness block: from its key to its END. */
const block = (s: string) => s.slice(s.indexOf("'freshness'"), s.indexOf("END;", s.indexOf("'freshness'")) + 4);
/** From date_coverage's key through desc_coverage's END — the two blocks that must not move. */
const rest = (s: string) => s.slice(s.indexOf("'date_coverage'"), s.lastIndexOf("END;", s.indexOf("END $$;")) + 4);

describe("20260909221000 — the freshness rollup, re-issued over live rows", () => {
  it("exists, is the newest definition of refresh_job_board_stats, and defines exactly ONE function", () => {
    expect(FILE, "the migration is missing").toBeTruthy();
    const defs = SQL.match(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.\w+\s*\(/g) ?? [];
    expect(defs).toEqual(["CREATE OR REPLACE FUNCTION public.refresh_job_board_stats("]);
    const newest = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(resolve(MIG_DIR, f), "utf8").includes("CREATE OR REPLACE FUNCTION public.refresh_job_board_stats")).sort().pop();
    expect(newest).toBe(FILE);
    // The RPC that projects the row is NOT re-issued: same signature, one function per file.
    expect(SQL).not.toMatch(/get_freshness_stats/);
    expect(SQL).not.toMatch(/DROP FUNCTION/);
  });

  it("the population is stamps whose token holds at least one LIVE row, decided per stamp", () => {
    const b = block(SQL);
    expect(b).toMatch(/EXISTS \(\s*SELECT 1 FROM public\.job_board_postings p\s+WHERE p\.company_token = ver\.company_token\s+AND p\.missing_since IS NULL\s*\) AS is_live/);
    // The outer EXISTS (any row) is kept: a stamp with no rows at all is
    // neither live nor dark — it is the 03:51 cleanup's, as before.
    expect(b).toMatch(/WHERE EXISTS \(\s*SELECT 1 FROM public\.job_board_postings p\s+WHERE p\.company_token = ver\.company_token\s*\)\s*\) live/);
    expect(b).toMatch(/FROM public\.job_board_verifications ver/);
  });

  it("every existing key keeps its meaning over the live population; the dark bucket is its own two keys", () => {
    const b = block(SQL);
    expect(b).toMatch(/'boards',\s+count\(\*\) FILTER \(WHERE live\.is_live\)/);
    expect(b).toMatch(/'p50_min',\s+round\(\(percentile_cont\(0\.5\)\s+WITHIN GROUP \(ORDER BY live\.age_min\) FILTER \(WHERE live\.is_live\)\)::numeric, 1\)/);
    expect(b).toMatch(/'p95_min',\s+round\(\(percentile_cont\(0\.95\) WITHIN GROUP \(ORDER BY live\.age_min\) FILTER \(WHERE live\.is_live\)\)::numeric, 1\)/);
    expect(b).toMatch(/'max_min',\s+round\(\(max\(live\.age_min\) FILTER \(WHERE live\.is_live\)\)::numeric, 1\)/);
    expect(b).toMatch(/'dark_boards',\s+count\(\*\) FILTER \(WHERE NOT live\.is_live\)/);
    expect(b).toMatch(/'dark_max_min', round\(\(max\(live\.age_min\) FILTER \(WHERE NOT live\.is_live\)\)::numeric, 1\)/);
    // The basis rides the row, so a reader of the row never has to find this file.
    expect(b).toMatch(/'population',\s+'verification stamps whose token holds at least one live posting row \(missing_since IS NULL\); dark_boards = stamps whose token holds rows but none live'/);
    // The four keys the RPC projects are all still written, under their names.
    for (const k of ["'boards'", "'p50_min'", "'p95_min'", "'max_min'"]) expect(b).toContain(k);
  });

  it("the previous population (any row, live or not) is gone from the figures", () => {
    const b = block(SQL);
    // The old form: an age computed over every stamp with any row, unfiltered.
    expect(b).not.toMatch(/'boards',\s+count\(\*\),/);
    expect(b).not.toMatch(/'max_min',\s+round\(\(max\(age_min\)\)::numeric, 1\)/);
  });

  it("re-issued from the LATEST definition: date_coverage and desc_coverage are byte-identical to 20260904090000", () => {
    expect(rest(SQL).length).toBeGreaterThan(800);
    expect(rest(SQL)).toBe(rest(PREV));
    // And the header, timeout and per-block degradation are the same function.
    for (const s of ["SECURITY DEFINER", "SET search_path = public", "SET statement_timeout = '4min'", "WHEN QUERY_CANCELED THEN", "stats rollup: freshness unavailable (%)"]) {
      expect(SQL).toContain(s);
    }
  });

  it("revokes from PUBLIC AND anon by name, and reloads the schema", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_job_board_stats\(\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/NOTIFY pgrst, 'reload schema';/);
    expect(SQL).not.toMatch(/GRANT/);
  });

  it("states the decision, its refused alternative, the population, and what it moves in 20260909218000", () => {
    expect(PROSE).toMatch(/\(b\) the rollup excludes stamps whose token has zero LIVE rows/);
    expect(PROSE).toMatch(/TAKEN/);
    expect(PROSE).toMatch(/\(a\) the edge function writes the catalogue token set to job_board_meta/);
    expect(PROSE).toMatch(/Refused/);
    expect(PROSE).toMatch(/EVERY EXISTING KEY KEEPS ITS MEANING/);
    expect(PROSE).toMatch(/first\.age_min == the greater of max_min and dark_max_min/);
    expect(PROSE).toMatch(/2026-09-10 02:45 UTC/);
    expect(PROSE).toMatch(/max_min 20,961\.0/);
  });
});

describe("status publishes the excluded bucket", () => {
  it("reads the rollup ROW beside the RPC, appended at the end of the positional read", () => {
    const at = IDX.indexOf("hwMeta, deepCur, chainKick, sliceStatsRow, descCov, traceRow");
    expect(at).toBeGreaterThan(-1);
    const arr = IDX.slice(at);
    const row = arr.indexOf('from("job_board_stats_rollup").select("v, computed_at").eq("k", "freshness").maybeSingle()');
    expect(row).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(arr.indexOf('eq("k", "stale_lane")'));
    expect(arr.slice(0, row)).toMatch(/staleMeta, freshRow\] = await Promise\.all\(\[/);
  });

  it("freshness carries dark_boards, dark_max_min and population when the row has them, and the RPC's four keys always", () => {
    const f = IDX.slice(IDX.indexOf("freshness: (() => {"), IDX.indexOf("staleLane: (() => {"));
    expect(f).toMatch(/const v = \(freshRow\.data\?\.v \?\? \{\}\) as \{ dark_boards\?: unknown; dark_max_min\?: unknown; population\?: unknown \};/);
    expect(f).toMatch(/\.\.\.row,/);
    expect(f).toMatch(/dark_boards: Number\(v\.dark_boards\) \|\| 0, dark_max_min: v\.dark_max_min \?\? null, population: typeof v\.population === "string" \? v\.population : null/);
    // A row written before the migration carries no bucket: the keys are absent, not zero.
    expect(f).toMatch(/v\.dark_boards !== undefined\s*\?/);
    // The RPC is still the source of the four figures — nothing is recomputed here.
    expect(IDX).toMatch(/withDeadline\(client\.rpc\("get_freshness_stats"\), 2_500\)/);
  });
});
