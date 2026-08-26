import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A GUC THAT VANISHES IN A REWRITE TAKES ITS REASON WITH IT.
 *
 * `search_jobs_semantic` shipped with `SET hnsw.ef_search = '100'` and a header
 * explaining it: pgvector's default of 40 caps the HNSW candidate list below
 * this function's own 60-row LIMIT ceiling. The function was later re-issued
 * several times for unrelated reasons and the setting was dropped on the way,
 * while statement_timeout and search_path survived.
 *
 * It bites on the path that calls it: the semantic rescue tier passes
 * `p_limit: fetchLimit` (min(limit*3, 200)), clamped in-function to 60. Between
 * 40 and 60 the scan is silently truncated and nothing reports a short page.
 *
 * This test reads the LAST migration that defines the function, so it fails
 * the next time the definition is re-issued without the setting rather than
 * pinning one filename that a later rewrite would leave behind.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const defining = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => readFileSync(resolve(DIR, f), "utf8").includes("FUNCTION public.search_jobs_semantic("))
  .sort();
const LATEST = defining[defining.length - 1];
const SQL = readFileSync(resolve(DIR, LATEST), "utf8");
// The definition only — a file may touch several functions.
const DEF = SQL.slice(SQL.indexOf("FUNCTION public.search_jobs_semantic("));

describe("the ANN scan lost its search width", () => {
  it("a migration defines the semantic RPC at all", () => {
    expect(defining.length, "search_jobs_semantic is not defined anywhere").toBeGreaterThan(0);
  });

  it("the newest definition sets hnsw.ef_search above the row ceiling", () => {
    const m = /SET hnsw\.ef_search = '(\d+)'/.exec(DEF);
    expect(m, `${LATEST} re-issues search_jobs_semantic without SET hnsw.ef_search`).toBeTruthy();
    // The function clamps p_limit to 60; the candidate list must exceed it or
    // the scan is capped below a full page.
    expect(Number(m![1]), "ef_search is at or below the 60-row LIMIT ceiling").toBeGreaterThan(60);
  });

  it("the newest definition still carries both fences", () => {
    // Restoring a GUC must not quietly revert the freshness/closure predicates
    // that a later migration added — this function shipped without them once.
    expect(DEF, "the 30-day window predicate is gone").toMatch(/effective_posted >= now\(\) - interval '30 days'/);
    expect(DEF, "closed postings would be served by the semantic tier")
      .toMatch(/p\.missing_since IS NULL/);
  });

  it("it is re-issued in place, never as a second overload", () => {
    // A second overload of a search function took this schema down with
    // PGRST203 once. The signature must be unchanged.
    expect(DEF).toMatch(/p_embedding text,\s*\n\s*p_limit integer DEFAULT 30,\s*\n\s*p_max_distance numeric DEFAULT 0\.18/);
    expect(SQL, "the re-issue drops the function instead of replacing it")
      .not.toMatch(/DROP FUNCTION[^;]*search_jobs_semantic/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_jobs_semantic\(text, integer, numeric\)/);
  });
});
