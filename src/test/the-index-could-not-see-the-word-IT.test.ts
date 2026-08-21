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
    expect(/textSearch\("title", ftsQuery\(qText\), \{ type: "websearch", config: "simple" \}\)/.test(FN),
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
    // The BUDGET is pinned, not just its presence. At 4s, eight identical calls
    // to q="IT" split 2 / 6 between the fuzzy tier (19 rows) and this one (60):
    // two cold-start spikes at 7.9s and 6.5s blew the deadline and the SAME
    // QUERY returned two different answers. Non-determinism is worse than
    // either answer — it makes the telemetry unreadable and turns every
    // relevance check into a coin toss.
    expect(/\n\s*7_000,/.test(blk), "the deadline must cover the measured cold-start spike").toBe(true);
    // And a miss must leave a trace: withDeadline resolves { data: null }, which
    // is indistinguishable from "no matches".
    expect(/exceeded its deadline/.test(blk), "a silent degradation is the bug this repo keeps rediscovering").toBe(true);
    expect(/\.range\(0, Math\.max\(limit \* 2 - 1, 0\)\)/.test(blk), "must read a bounded window").toBe(true);
    expect(/catch \{/.test(blk), "a failure must degrade to the empty page, never an error").toBe(true);
  });

  it("searches COMPANY as well as title, as two indexed queries not one or()", () => {
    const blk = /── THE SIMPLE-CONFIG TIER[\s\S]*?catch \{ \/\* the empty page the visitor already had \*\/ \}/.exec(FN)?.[0] ?? "";
    expect(blk, "the simple tier is missing").not.toBe("");
    // An employer name lives in company. Title-only is why q="AT&T" reached the
    // 23 postings with AT&T in their TITLE and none of the 493 whose EMPLOYER
    // is AT&T.
    expect(/\.textSearch\("title", ftsQuery\(qText\)/.test(blk)).toBe(true);
    expect(/\.textSearch\("company", ftsQuery\(qText\)/.test(blk)).toBe(true);
    // NOT an or(). MEASURED: or=(title.wfts,company.wfts) with the tier's real
    // ordering took 2.23s on AT&T and returned HTTP 500 at 3.24s on "dominos",
    // because an OR across two columns plus ORDER BY effective_posted cannot be
    // served by one index — the same shape as this board's 17s outage. Split,
    // each side hits its own gin index at about a quarter of a second.
    expect(/\.or\(\s*`title\.wfts/.test(blk), "the or() form times out — keep the queries split").toBe(false);
  });

  it("reaches possessive employers, which one apostrophe was hiding", () => {
    const fn = /function ftsQuery\(raw: string\): string \{[\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(fn, "ftsQuery is missing").not.toBe("");

    // SOURCE ASSERTIONS FIRST, and they are not optional. Mutation-testing
    // caught this file passing while the shipped rewrite was DELETED: the
    // reimplementation below exercises the RULE and never touches the wiring,
    // so it goes on passing no matter what happens to the real function. That
    // is the exact defect a review found in the employer-routing tests this
    // morning, repeated here within hours. A behavioural reimplementation
    // proves a rule is right; only a source assertion proves it is connected.
    expect(
      /return `\$\{safe\} or \$\{safe\.slice\(0, -1\)\} s`;/.test(fn),
      "the shipped ftsQuery must emit the possessive variant",
    ).toBe(true);
    expect(
      /safe\.length >= 5/.test(fn),
      "the length floor keeps the variant off short plurals where the split half is noise",
    ).toBe(true);
    expect(/\.textSearch\("title", ftsQuery\(qText\)/.test(FN)).toBe(true);
    expect(/\.textSearch\("company", ftsQuery\(qText\)/.test(FN)).toBe(true);

    // Then the behaviour, reconstructed from the same rule.
    const ftsSafeLocal = (t: string) => t.replace(/[(),."'\\:]/g, " ").replace(/\s+/g, " ").trim();
    const ftsQueryLocal = (raw: string) => {
      const safe = ftsSafeLocal(raw);
      if (/^[a-z0-9]+s$/i.test(safe) && safe.length >= 5) return `${safe} or ${safe.slice(0, -1)} s`;
      return safe;
    };
    // MEASURED: "dominos" matched 0 rows, "dominos or domino s" matched 2,002.
    expect(ftsQueryLocal("dominos")).toBe("dominos or domino s");
    expect(ftsQueryLocal("mcdonalds")).toBe("mcdonalds or mcdonald s");
    // An apostrophe typed by the user already splits correctly via ftsSafe.
    expect(ftsQueryLocal("Domino's")).toBe("Domino s");
    // Ordinary words are untouched in effect — "engineers or engineer s"
    // measured the same 622 rows as "engineers" — and short plurals are left
    // alone entirely so the split half cannot become noise.
    expect(ftsQueryLocal("its")).toBe("its");
    expect(ftsQueryLocal("nurse")).toBe("nurse");
    expect(ftsQueryLocal("registered nurse")).toBe("registered nurse");
  });

  it("survives one half of the pair failing", () => {
    const blk = /── THE SIMPLE-CONFIG TIER[\s\S]*?catch \{ \/\* the empty page the visitor already had \*\/ \}/.exec(FN)?.[0] ?? "";
    // The company index may not exist yet: measured today, title answers in
    // 0.21-0.27s while company 500s at 3.31s on "dominos". Promise.all would
    // let that discard the working title results.
    expect(/Promise\.allSettled\(\[/.test(blk), "one failing side must not discard the other").toBe(true);
    expect(/Promise\.all\(\[/.test(blk.replace(/Promise\.allSettled\(\[/g, "")), "no bare Promise.all").toBe(false);
    expect(/r\.status === "fulfilled"/.test(blk)).toBe(true);
  });

  it("dedupes the merged pair, title first", () => {
    const blk = /── THE SIMPLE-CONFIG TIER[\s\S]*?catch \{ \/\* the empty page the visitor already had \*\/ \}/.exec(FN)?.[0] ?? "";
    // Concatenating two result sets means a posting matching BOTH appears
    // twice, and each query is ordered only within itself.
    expect(/const seenSimple = new Set<string>\(\)/.test(blk)).toBe(true);
    expect(/if \(!id \|\| seenSimple\.has\(id\)\) return false;/.test(blk)).toBe(true);
  });

  it("strips the characters that would truncate a PostgREST filter", () => {
    const fn = /function ftsSafe\(t: string\): string \{[\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(fn, "ftsSafe is missing").not.toBe("");
    // A comma ends an or() branch and a parenthesis closes the filter — this
    // board already shipped that bug on a location or() splitting at ", TX".
    // Quotes are stripped rather than escaped: websearch_to_tsquery reads them
    // as phrase syntax, and a half-open phrase is a parse error, not a search.
    // Asserted behaviourally: a character class is easy to get subtly wrong
    // and easy to assert vacuously. Reconstruct the shipped regex and run it.
    const m = /return t\.replace\((\/\[[^/]*\]\/g)/.exec(fn);
    expect(m, "could not read ftsSafe's character class").not.toBeNull();
    // eslint-disable-next-line no-eval
    const cls: RegExp = eval(m![1]);
    for (const ch of [",", "(", ")", '"', "'", ":"]) {
      expect(cls.test(ch), `ftsSafe must strip ${ch} — it would truncate the filter`).toBe(true);
      cls.lastIndex = 0;
    }
    // and must NOT strip ordinary word characters
    for (const ch of ["a", "1", "&", "+", "#", "-"]) {
      expect(cls.test(ch), `ftsSafe must keep ${ch}`).toBe(false);
      cls.lastIndex = 0;
    }
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
