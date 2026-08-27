/**
 * A SORT KEY THAT IS ZERO FOR EVERY ROW IT IS SUPPOSED TO ORDER.
 *
 * search_jobs escalates to search_tsv when fewer than 200 titles match, and the
 * rows it then returns are mostly description-only matches — the "related"
 * segment, up to 3,000 of them. Every ORDER BY in that branch read
 *
 *     ts_rank_cd(ARRAY[0,0,0,1]::float4[], p.title_tsv, $1) DESC
 *
 * and a description-only row does not match title_tsv, so ts_rank_cd returns 0
 * for all of them. Not a low score — zero, identically. The sort fell through to
 * effective_posted, and the related segment was ordered by nothing but recency.
 *
 * MEASURED live, 2026-08-27, six plain-English searches. "help old people at
 * home" returned Caregiver/Home Health Aide, then "Project Management Officer",
 * "Retail Sales Associate" and two "Courier" rows. Those really do contain
 * help, old, people and home — in four thousand characters of description where
 * "must be 18 years old" and "work from home" are boilerplate. The AND matched;
 * nothing ranked. "teach kids to swim" (27 related rows) was six swim
 * instructors; "work with my hands outdoors" (3,000 related) was noise. Quality
 * tracked the size of the segment that had no ordering.
 *
 * The fix ranks the title against the OR form of the same query, so a title
 * carrying some of the words outranks one carrying none. This is the signal
 * rerankWindow already applies in the edge function — which is why the top rows
 * above ARE the sensible ones. The edge can only reorder the twenty rows SQL
 * hands it, and SQL was handing it the twenty most recent of three hundred and
 * ninety.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");

/** The last migration that defines search_jobs is the live one. */
const LIVE = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => readFileSync(resolve(MIGRATIONS, f), "utf8").includes("CREATE FUNCTION public.search_jobs("))
  .pop()!;

const RAW = readFileSync(resolve(MIGRATIONS, LIVE), "utf8");
/** Comments stripped — this migration quotes the broken ORDER BY to explain it. */
const SQL = RAW.replace(/^--[^\n]*$/gm, "");

/** The union branch: everything between the escalation test and its ELSE. */
const UNION = SQL.slice(
  SQL.indexOf("IF tsv_col = 'p.search_tsv' THEN"),
  SQL.indexOf("  ELSE\n    RETURN QUERY EXECUTE", SQL.indexOf("IF tsv_col = 'p.search_tsv' THEN")),
);

describe("the related segment is ordered by something other than the clock", () => {
  it("found the live definition", () => {
    expect(LIVE, "no migration defines search_jobs").toBeTruthy();
    expect(UNION.length, "the search_tsv branch is gone or restructured").toBeGreaterThan(500);
  });

  it("derives an OR form of the query inside the function", () => {
    // querytree, not a text rewrite of p_q: replacing spaces with " or " would
    // split a quoted phrase into disjuncts. querytree returns `&` between
    // lexemes and `<->` inside phrases, so swapping & for | loosens only the
    // conjunction.
    expect(SQL, "q_or is not declared").toMatch(/q_or\s+tsquery;/);
    expect(SQL, "the OR query is not built from the parsed tree")
      .toMatch(/replace\(querytree\(q\), '&', '\|'\)::tsquery/);
    expect(SQL, "an unparseable query must fall back to q, not raise")
      .toMatch(/EXCEPTION WHEN OTHERS THEN[\s\S]{0,60}q_or := q;/);
  });

  it("orders the related rows by that OR rank", () => {
    const keys = UNION.match(/CASE WHEN p\.title_tsv @@ \$1 THEN 0::float4 ELSE ts_rank_cd\(ARRAY\[0,0,0,1\]::float4\[\], p\.title_tsv, \$16\) END DESC/g) ?? [];
    expect(keys.length, "the related segment has no relevance key — it is sorted by date again").toBe(2);
  });

  it("leaves the title segment byte-identical", () => {
    // The new key is a CONSTANT for every row that matches the title vector, so
    // ties among title matches still break on effective_posted exactly as
    // before. Without the CASE this would silently reorder the primary segment
    // — a much bigger change than the one being made.
    expect(UNION, "the tiebreak applies to title matches too")
      .toMatch(/CASE WHEN p\.title_tsv @@ \$1 THEN 0::float4/);
    expect(UNION, "the primary rank is no longer weights-only over title_tsv")
      .toMatch(/ts_rank_cd\(ARRAY\[0,0,0,1\]::float4\[\], p\.title_tsv, \$1\) DESC, CASE WHEN/);
  });

  it("binds q_or, or every ranked search raises on an unbound $16", () => {
    expect(UNION).toMatch(/USING q,[^\n]*related, q_or;/);
  });

  it("uses the SAME ordering in the page CTE and the outer SELECT", () => {
    // The CTE picks the slice with LIMIT/OFFSET and the outer SELECT re-sorts
    // it. If the two orderings disagree the slice is chosen by one rule and
    // presented by another, and page two repeats rows from page one — the
    // failure that made a stable tiebreak necessary in the first place.
    const orders = UNION.match(/ORDER BY ts_rank_cd[^']*p\.id ASC/g) ?? [];
    expect(orders.length, "expected the CTE ordering and the outer ordering").toBe(2);
    expect(orders[0], "the slice is chosen by one ordering and shown in another").toBe(orders[1]);
  });

  it("changes no signature, so the edge function deploy stays independent", () => {
    // q_or is derived inside the function. A new parameter would renumber the
    // USING clauses and make the SQL and the edge deploy order-dependent.
    expect(SQL).not.toMatch(/p_q_or|p_or_query/);
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.search_jobs\(text, timestamptz, text, boolean, text, text, text\[\], numeric, text\[\], timestamptz, integer, text, integer, integer, text\[\], boolean, boolean\);/);
  });

  it("re-issues all three functions together", () => {
    // An old overload left behind in any database makes PostgREST answer
    // PGRST203 to every call, which is the standing reason these three move as
    // a set.
    for (const fn of ["search_jobs", "count_jobs_capped", "fuzzy_title_search"]) {
      expect(SQL, `${fn} is not re-issued`).toContain(`CREATE FUNCTION public.${fn}(`);
    }
  });

  it("does not rank the description vector, which would detoast 3,000 rows", () => {
    // title_tsv is short and stored inline; search_tsv holds 4,000 characters
    // of description and is TOASTed. Putting it in an ORDER BY over the sample
    // means detoasting the lot on every query.
    const orderZone = UNION.match(/ORDER BY[^']*p\.id ASC/g)?.join(" ") ?? "";
    expect(orderZone, "search_tsv is being ranked, not just matched").not.toContain("ts_rank_cd(p.search_tsv");
  });
});
