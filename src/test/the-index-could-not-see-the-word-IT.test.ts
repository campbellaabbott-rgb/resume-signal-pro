import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FIVE QUERY-SIDE FIXES MOVED NOTHING, BECAUSE THE TOKEN WAS NEVER STORED.
 *
 * Every tsvector in this schema is built with the 'english' text-search
 * configuration, which discards stopwords before writing the index. "it" is not
 * in the index at all, so no rewrite on any of the four query paths could ever
 * retrieve it — which is why a week of query-layer work produced no measurable
 * change for q="IT".
 *
 * MEASURED THROUGH POSTGREST against live production:
 *   title=wfts(english).IT   -> matches NOTHING
 *   title=wfts(simple).IT    -> 4,072 rows
 * The board serves ~18 for q="IT" against 4,145 postings carrying it as a title
 * word. Stemming collisions go the same way: "intern" is 7,280 under english
 * (it conflates Internal and International) and 4,907 under simple.
 *
 * The fix is one expression index plus one rescue tier. No column (a STORED
 * generated column on 602,880 rows takes an ACCESS EXCLUSIVE lock for a full
 * table rewrite), and no function change (search_jobs has a fifteen-parameter
 * signature that cannot be read from here, and getting it wrong is what caused
 * the PGRST203 outage).
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const MIG = (() => {
  const d = resolve(__dirname, "../../supabase/migrations");
  const f = readdirSync(d).find((x) => x.includes("the_index_could_not_see_the_word_IT"));
  expect(f, "the simple-config index migration is missing").toBeTruthy();
  return readFileSync(resolve(d, f!), "utf8");
})();

describe("the index can see the words people search for", () => {
  it("indexes the EXACT expression PostgREST compiles, or the planner ignores it", () => {
    // ?title=wfts(simple).X becomes to_tsvector('simple', title) @@ ...
    // An index on any other expression — a different config, a coalesce, a
    // concatenation — is built, occupies disk, and is never used. Nothing
    // errors; the query just silently goes back to a sequential scan.
    expect(MIG).toMatch(/USING gin \(to_tsvector\('simple', title\)\)/);
    expect(/textSearch\("title", qText, \{ type: "websearch", config: "simple" \}\)/.test(FN),
      "the caller must use websearch + simple, matching the indexed expression").toBe(true);
  });

  it("builds CONCURRENTLY as the only statement in its migration", () => {
    // CREATE INDEX CONCURRENTLY raises 25001 inside a transaction block, and a
    // migration is one. Same shape as the draw-index migration that worked.
    expect(MIG).toMatch(/CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
    const statements = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((x) => x.trim()).filter(Boolean);
    expect(statements.length, `exactly one statement, found ${statements.length}`).toBe(1);
    expect(/BEGIN|COMMIT/i.test(statements[0]), "no transaction control").toBe(false);
  });

  it("does NOT add a column and does NOT touch a function signature", () => {
    // Both were considered and rejected: a stored generated column rewrites a
    // 602,880-row table under an exclusive lock, and editing search_jobs from a
    // repo file is what created the PGRST203 overload.
    expect(/ADD COLUMN/i.test(MIG), "no column — a table rewrite locks the board").toBe(false);
    expect(/CREATE (OR REPLACE )?FUNCTION/i.test(MIG), "no function — signatures are how the outage happened").toBe(false);
  });

  it("binds its filters through the ONE filter binder, not a fifth copy", () => {
    // A new matcher with its own filter binding is the mistake that produced
    // five defects in two days. skipTerms swaps only the text predicate.
    expect(/buildQuery\("effective_posted", false, undefined, \{ skipTerms: true \}\)/.test(FN)).toBe(true);
    expect(/if \(!opts\?\.skipTerms\) for \(const t of terms\)/.test(FN),
      "skipTerms must suppress ONLY the free-text predicate").toBe(true);
  });

  it("fires only on an already-empty page, so it cannot slow a working query", () => {
    const blk = /── THE SIMPLE-CONFIG TIER[\s\S]*?catch \{ \/\* the empty page the visitor already had \*\/ \}/.exec(FN)?.[0] ?? "";
    expect(blk, "the simple tier is missing").not.toBe("");
    expect(/if \(!filtersActive && qText\.length >= 2\) try \{/.test(blk)).toBe(true);
    // Bounded window: withDeadline is Promise.race and does NOT cancel the SQL,
    // so an abandoned query keeps costing the database.
    expect(/withDeadline\(/.test(blk), "must be deadline-bounded").toBe(true);
    expect(/\.range\(0, Math\.max\(limit \* 2 - 1, 0\)\)/.test(blk), "must read a bounded window").toBe(true);
    expect(/catch \{/.test(blk), "a failure must degrade to the empty page, never an error").toBe(true);
  });

  it("publishes no total it cannot stand behind, and discloses the tier", () => {
    const blk = /── THE SIMPLE-CONFIG TIER[\s\S]*?catch \{ \/\* the empty page the visitor already had \*\/ \}/.exec(FN)?.[0] ?? "";
    // It reads a bounded window, so any count would be the window size wearing
    // a total's clothing — the defect the fuzzy tier already carries.
    expect(/total: null,/.test(blk)).toBe(true);
    expect(/countUnavailable: true,/.test(blk)).toBe(true);
    expect(/exactWordMatch: qText,/.test(blk), "the tier must name itself in the payload").toBe(true);
    // Same disclosures as every other list exit — this is the fifth exit and
    // the four before it each shipped missing one.
    for (const d of ["searchDisclosures(body, applied)", "intentDisclosure(intentLift)", "coverageDisclosure(applied, meta)", "searchId"]) {
      expect(blk, `the new exit must carry ${d}`).toContain(d);
    }
    expect(/logSearch\("ranked", simpleGrouped\.jobs\.length, null, "fuzzy"\)/.test(blk),
      "the tier must appear in telemetry as a rescue, not as the ranked path").toBe(true);
  });
});
