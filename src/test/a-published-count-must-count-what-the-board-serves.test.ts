import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Two stats functions scanned the whole corpus to publish one number, and
 * counted postings the board refuses to serve while doing it.
 *
 * get_entry_level_stats had NO WHERE CLAUSE AT ALL — two full scans of 708k
 * rows — so it failed its 20s budget (500 57014, 3/3) and became the only key
 * in the stats cache's stale_parts, freezing /entry-level-index on a stale
 * figure. That figure was also inflated: ~65,952 against a fenced ~54,600-58,200,
 * about 17%, on a page whose whole pitch is that its numbers are real.
 *
 * get_stale_board_count LEFT JOINed 708k postings and took DISTINCT afterwards,
 * to answer a question about ~23k boards. It is a HEARTBEAT check, wrapped by
 * scan-heartbeat in a 10s timeout while allowing itself 20s, so the wrapper
 * always gave up first and the failure was swallowed — the check was dead.
 */
const SQL = readFileSync(resolve(__dirname,
  "../../supabase/migrations/20260827145000_two_stats_that_scanned_the_whole_board_to_say_one_number.sql"), "utf8");

/** Comment-stripped: this migration explains the bug by quoting the broken shapes. */
const code = SQL.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** The body of one CREATE OR REPLACE FUNCTION, by name. */
function body(name: string): string {
  const i = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(i, `${name} not found in the migration`).toBeGreaterThan(-1);
  const j = code.indexOf("$$;", i);
  return code.slice(i, j);
}

describe("a published count must count what the board serves", () => {
  it("fences the entry-level scan on both predicates", () => {
    const b = body("get_entry_level_stats");
    expect(b, "withdrawn postings must not be counted").toMatch(/missing_since IS NULL/);
    expect(b, "the 30-day serving window must be bound").toMatch(
      /effective_posted >= now\(\) - interval '30 days'/);
  });

  it("reads total_open from the published headline instead of spelling it a fifth time", () => {
    // refresh_headline_open (20260826171900) already counts exactly these two
    // predicates and writes coverage.open, which the list endpoint serves as
    // `total`. Recomputing it here would be a second definition of one
    // statistic, which is how two surfaces start disagreeing about one corpus.
    const b = body("get_entry_level_stats");
    expect(b).toMatch(/v -> 'coverage' ->> 'open'/);
    expect(b).toMatch(/FROM public\.job_board_meta WHERE k = 'refresh'/);
    // And it must not fall back to a guess when the key is absent.
    expect(b, "no COALESCE to a fabricated total").not.toMatch(/coalesce\s*\(\s*\(\s*SELECT\s*\(v -> 'coverage'/i);
  });

  it("deduplicates before joining in the stale-board count, and fences it", () => {
    const b = body("get_stale_board_count");
    expect(b, "the DISTINCT must come before the join, not after").toMatch(
      /FROM \(\s*SELECT DISTINCT p\.company_token[\s\S]*?\) b\s*LEFT JOIN/);
    expect(b, "a board whose every posting is withdrawn is not waiting to be verified")
      .toMatch(/missing_since IS NULL/);
  });

  it("restates SECURITY DEFINER on both — CREATE OR REPLACE does not inherit it", () => {
    // 20260827130000 ALTERed both to DEFINER so they survive anon losing SELECT
    // on job_board_postings. CREATE OR REPLACE preserves only ownership and
    // grants; every other property reverts to what the command says. Omitting
    // the keyword would silently revert them to INVOKER, and under the lockdown
    // an INVOKER function returns ZERO ROWS to anon rather than raising.
    for (const fn of ["get_entry_level_stats", "get_stale_board_count"]) {
      expect(body(fn), `${fn} must restate SECURITY DEFINER`).toMatch(/SECURITY DEFINER/);
      expect(body(fn), `${fn} must restate its search_path`).toMatch(/SET search_path = public/);
    }
  });

  it("builds the indexes that make the fenced scans affordable", () => {
    // Partial on missing_since IS NULL so they cover only the servable rows.
    expect(code).toMatch(/CREATE INDEX job_board_postings_entry_serving_idx[\s\S]*?WHERE missing_since IS NULL/);
    expect(code).toMatch(/CREATE INDEX job_board_postings_token_serving_idx[\s\S]*?WHERE missing_since IS NULL/);
    // DROP-first, so an INVALID index from an interrupted build self-heals
    // instead of being skipped forever by IF NOT EXISTS.
    expect(code).toMatch(/DROP INDEX IF EXISTS public\.job_board_postings_entry_serving_idx;/);
    expect(code).toMatch(/DROP INDEX IF EXISTS public\.job_board_postings_token_serving_idx;/);
    // NOT CONCURRENTLY: the migration runner wraps each file in a transaction,
    // where CONCURRENTLY raises 25001 and applies nothing.
    expect(code, "CONCURRENTLY cannot run inside the migration transaction").not.toMatch(/CREATE INDEX CONCURRENTLY/);
  });
});
