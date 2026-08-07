/**
 * ONE SLOW QUERY BLACKED OUT SIX STATISTICS FOR FOUR DAYS.
 *
 * get_ghost_job_index_stats() timed out (57014 at 60s, measured live
 * 2026-08-07) and refresh_stats_cache() called it inside a single
 * jsonb_build_object alongside five other functions. The assignment threw, the
 * INSERT never ran, and the whole cache froze at 2026-08-03 — entry_stats,
 * hiring_trends, trending_categories and date_coverage included, none of which
 * were slow.
 *
 * TWO DEFECTS. The query outgrew its budget; and six independent statistics
 * shared one all-or-nothing transaction. The second is what turned a slow query
 * into a blackout, and it is the one that would otherwise happen again with
 * whichever function gets slow next.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. It pins the structure — that the pieces
 * are isolated, that the row is always written, that the sort is gone. It
 * cannot prove the rewritten query is FAST; that needs the database, and the
 * measurement is the post-deploy call.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const all = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
const fnFile = all.filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("SIX STATISTICS, SIX FATES")).sort().pop()!;
const fn = readFileSync(resolve(DIR, fnFile), "utf8");
const bare = fn.replace(/--[^\n]*/g, "");

describe("the query stops scanning the whole table", () => {
  it("no longer sorts every posting for the median", () => {
    // percentile_cont over job_board_postings was the full sort. It survives
    // ONLY for closures, where the expression is computed and no index can help.
    const postingsMedian = /percentile_cont[\s\S]{0,200}?FROM public\.job_board_postings/.test(bare);
    expect(postingsMedian, "percentile_cont still runs over job_board_postings").toBe(false);
    expect(bare).toMatch(/percentile_cont[\s\S]{0,300}?FROM public\.job_board_closures/);
  });

  it("takes the median by index-ordered offset instead", () => {
    expect(bare).toMatch(/ORDER BY p\.posted_at\s*\n?\s*OFFSET GREATEST\(\(SELECT dated_n FROM counts\) \/ 2, 0\)/);
  });

  it("measures the median from posted_at and NEVER from first_seen", () => {
    // The 2.8-day incident. first_seen is when WE noticed; the page's label
    // says "the company's own stated post date", and on 4,179 rows carrying
    // both the bases differ by 17.6 days at the median — the published number
    // being the flattering one. An early draft of this very migration reverted
    // it while chasing speed; published-claims.test.ts caught that, and this
    // pins it locally too.
    const median = bare.slice(bare.indexOf("EXTRACT(EPOCH FROM (now() - p."), bare.indexOf("LIMIT 1),"));
    expect(median).toContain("p.posted_at");
    expect(median).not.toContain("first_seen");
  });

  it("keeps every count to postings the board will actually serve", () => {
    // A figure headed "open postings" that includes rows we refuse to show is
    // simply wrong. Present on both distinct counts and both plain ones.
    expect((bare.match(/missing_since IS NULL/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("counts distinct values by loose index scan, exactly — not by estimate", () => {
    expect(bare).toMatch(/WITH RECURSIVE/);
    expect(bare).toMatch(/WHERE p\.company_token > tok\.v/);
    expect(bare).toMatch(/WHERE p\.company > nm\.v/);
    // reltuples/estimates would make a published figure approximate.
    expect(bare).not.toMatch(/reltuples|TABLESAMPLE/);
  });

  it("keeps the same eight columns, in the same order", () => {
    // Readers include the cache payload and the public page; a reordering here
    // silently re-labels every number on it. posted_coverage_pct is the eighth
    // and is load-bearing: GhostJobIndex gates its coverage caveat on it, and
    // when the column went missing that caveat had never rendered once.
    const sig = bare.slice(bare.indexOf("RETURNS TABLE"), bare.indexOf("LANGUAGE sql"));
    const cols = ["total_open", "total_companies", "total_company_names", "closed_90d", "observed_days", "median_days_open", "median_days_to_close", "posted_coverage_pct"];
    let at = -1;
    for (const c of cols) {
      const i = sig.indexOf(c);
      expect(i, `${c} missing`).toBeGreaterThan(-1);
      expect(i, `${c} out of order`).toBeGreaterThan(at);
      at = i;
    }
  });
});

describe("six statistics, six fates", () => {
  const PARTS = ["ghost_stats", "date_coverage", "entry_stats", "entry_companies", "hiring_trends", "trending_categories"];

  it("computes every piece in its own guarded block", () => {
    for (const p of PARTS) {
      const i = bare.indexOf(`'${p}',`);
      expect(i, `${p} not built`).toBeGreaterThan(-1);
    }
    // One EXCEPTION handler per piece — the property that stops one failure
    // from taking the other five with it.
    expect((bare.match(/EXCEPTION WHEN OTHERS THEN/g) ?? []).length).toBe(PARTS.length);
  });

  it("keeps the previous value for a piece that fails", () => {
    // Blanking the page would be a second way to publish something false.
    for (const p of PARTS) {
      expect(bare, `${p} has no fallback to its previous value`).toMatch(new RegExp(`prev -> '${p}'`));
    }
  });

  it("names what went stale, always — empty array, never absent", () => {
    // A key that appears only when something is wrong cannot be told apart
    // from a key that stopped being written.
    expect(bare).toMatch(/stale := stale \|\| 'ghost_stats'/);
    expect(bare).toMatch(/jsonb_build_object\('stale_parts', to_jsonb\(stale\)\)/);
  });

  it("ALWAYS writes the cache row", () => {
    // The whole defect: the old version wrote nothing at all when any single
    // piece threw. The INSERT must sit outside every guarded block.
    const insertAt = bare.indexOf("INSERT INTO public.job_board_meta");
    const lastEnd = bare.lastIndexOf("END;", insertAt);
    expect(insertAt).toBeGreaterThan(lastEnd);
    expect(bare).toMatch(/ON CONFLICT \(k\) DO UPDATE SET v = EXCLUDED\.v/);
  });

  it("bounds each piece so six timeouts still fit the hourly window", () => {
    expect((bare.match(/SET LOCAL statement_timeout = '20s'/g) ?? []).length).toBe(PARTS.length);
  });
});
