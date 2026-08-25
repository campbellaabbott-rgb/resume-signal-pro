import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ONE UNINDEXED ARM COSTS YOU THE WHOLE OR-TREE.
 *
 * buildQuery emits `title ILIKE '%q%' OR company ILIKE '%q%' OR department
 * ILIKE '%q%'` per term. A BitmapOr needs EVERY arm to have an index path;
 * 20260713210000 declared trigram indexes on all four text columns and only
 * title and location were ever rebuilt, so two arms had none and the indexed
 * title arm was dragged onto a full scan with them.
 *
 * Measured live 2026-08-25 with a zero-match six-character term (so the scan
 * cannot stop early), the board's exact select, fence, ordering and LIMIT 60:
 *
 *   title alone ................ 0.203-0.206 s   indexed
 *   OR(title, location) ........ 0.215-0.249 s   both indexed — BitmapOr works
 *   OR(title, company) ......... 2.483-2.882 s   collapses
 *   OR(title, company, dept) ... 2.652-3.232 s   the real predicate, and
 *                                                intermittently HTTP 500
 *
 * Three diagnoses preceded this one and all three were wrong: the count RPC,
 * then the rescue tiers' deadlines summing, then "cost scales inversely with
 * match count". The third was the closest — rare words ARE the slow ones — but
 * the cause is not the walk, it is that no indexed plan existed to choose.
 *
 * company LOOKS covered and is not: 20260821170000 indexed
 * to_tsvector('simple', company), which serves wfts() and cannot serve ILIKE.
 */
const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(resolve(DIR, "20260826010000_the_or_tree_had_two_unindexed_arms.sql"), "utf8");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

describe("every arm of the free-text OR-tree needs an index", () => {
  it("the predicate still ORs exactly the three columns this migration covers", () => {
    // If a fourth column joins the OR-tree it needs an index too, or the tree
    // collapses again and this migration silently stops helping.
    const code = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(code).toMatch(/title\.ilike/);
    expect(code).toMatch(/company\.ilike/);
    expect(code).toMatch(/department\.ilike/);
  });

  it("builds trigram indexes on the two arms that had none", () => {
    expect(MIG).toMatch(/CREATE INDEX job_board_postings_company_trgm_idx\s+ON public\.job_board_postings USING gin \(company gin_trgm_ops\);/);
    expect(MIG).toMatch(/CREATE INDEX job_board_postings_department_trgm_idx\s+ON public\.job_board_postings USING gin \(department gin_trgm_ops\);/);
  });

  it("does NOT rebuild the two arms that already have one", () => {
    // title (20260720220847) and location (20260726171432) measure healthy at
    // 0.20-0.22 s. Rebuilding them would pay the lock for nothing. One judge in
    // the design panel recommended adding location; it was already there.
    const sql = MIG.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/CREATE INDEX[\s\S]{0,120}\(title gin_trgm_ops\)/);
    expect(sql).not.toMatch(/CREATE INDEX[\s\S]{0,120}\(location gin_trgm_ops\)/);
  });

  it("uses plain CREATE INDEX, because CONCURRENTLY cannot run here", () => {
    // The runner wraps each file in a transaction: CONCURRENTLY raises 25001
    // and applies NOTHING. The pg_cron workaround has silently failed on this
    // table before, and a silent failure looks exactly like success.
    const sql = MIG.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/CONCURRENTLY/);
    expect(sql).not.toMatch(/cron\.schedule/);
  });

  it("drops before creating, so an INVALID leftover cannot be skipped forever", () => {
    // CREATE INDEX IF NOT EXISTS treats an INVALID index from an interrupted
    // CONCURRENTLY build as present, and never repairs it.
    expect(MIG.indexOf("DROP INDEX IF EXISTS public.job_board_postings_company_trgm_idx"))
      .toBeLessThan(MIG.indexOf("CREATE INDEX job_board_postings_company_trgm_idx"));
    expect(MIG.indexOf("DROP INDEX IF EXISTS public.job_board_postings_department_trgm_idx"))
      .toBeLessThan(MIG.indexOf("CREATE INDEX job_board_postings_department_trgm_idx"));
  });

  it("bounds the lock it takes and re-plans afterwards", () => {
    expect(MIG).toMatch(/SET LOCAL lock_timeout/);
    expect(MIG).toMatch(/SET LOCAL statement_timeout/);
    expect(MIG).toMatch(/ANALYZE public\.job_board_postings;/);
  });

  it("changes no predicate and no data", () => {
    // A trigram index is LOSSY — the heap scan rechecks the original ILIKE, so
    // which jobs a search returns is unchanged. Anything that rewrites the
    // predicate (a tsvector swap) would change the answer instead of the plan.
    expect(/ALTER TABLE|UPDATE |DELETE FROM|DROP TABLE|CREATE OR REPLACE FUNCTION/i.test(MIG)).toBe(false);
  });

  it("its stamp does not collide with an existing migration", () => {
    const stamp = "20260826010000";
    const clashes = readdirSync(DIR).filter((f) => f.startsWith(stamp));
    expect(clashes.length, `stamp ${stamp} used by ${clashes.join(", ")}`).toBe(1);
  });
});
