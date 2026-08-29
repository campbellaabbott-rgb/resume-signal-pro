import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE FILTER COUNTS CONTRADICTED THE RESULTS ON THE SAME SCREEN.
 *
 * Measured live, identical request bodies:
 *   country=US    list total 10,000   facet sum 264,893
 *   q="IT"        list total (none)   facet sum 128,186
 *   q="welder"    list total 417      facet sum 465
 *
 * Two independent defects produced that, and both had to go:
 *
 * SCALE — the list caps at COUNT_CAP and says so, while the facets counted
 * exactly and without any cap. A sidebar promising 264,893 beside a header
 * reading 10,000 is not a rounding difference; the visitor cannot tell which
 * number is the lie.
 *
 * ENGINE — with a text query the list is served by the tsquery RPC while the
 * facets used buildQuery's substring ILIKE. Different matchers, measured 7,343x
 * apart on q="IT". The sidebar was answering a question the page never asked.
 *
 * SEPARATELY, `includeUncategorised` killed Load More on page one: the
 * two-subset pager caps its own fetch at `limit` while hasMore compared against
 * fetchLimit (3x limit when grouping), so the comparison could never be true.
 *   category=engineering                        50 rows, hasMore TRUE
 *   category=engineering + includeUncategorised 48 rows, hasMore FALSE
 * both under a total of 10,000.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const FACET = /if \(body\.facetCounts === true\) \{[\s\S]*?\n  \}\n/.exec(FN)?.[0] ?? "";

describe("the sidebar must not contradict the page", () => {
  it("counts facets with the SAME engine the list uses when there is a query", () => {
    expect(FACET, "the facetCounts block is missing").not.toBe("");
    // A SINGLE-TERM text query is counted by count_jobs_capped — the same RPC
    // the list total uses. A MULTI-WORD query is NOT: count_jobs_capped treats
    // p_q as one contiguous ILIKE while the list ANDs each term (title OR
    // company OR department, per term), so "senior nurse" would undercount and
    // the chip would promise fewer than clicking delivers (2026-08-29 sweep #2).
    // Multi-term falls through to buildQuery, the list's own matcher — the same
    // stand-down cappedCount already does.
    expect(/facetUseRpc = qText && facetQ\.length <= 1/.test(FACET),
      "multi-word queries must not use count_jobs_capped's contiguous ILIKE").toBe(true);
    expect(/if \(facetUseRpc\) \{[\s\S]*?count_jobs_capped/.test(FACET),
      "a single-term text query must be counted by the same RPC that serves the rows").toBe(true);
    // The filter-only AND multi-word cases use buildQuery — the list's matcher.
    expect(/buildQuery\("effective_posted", true, c\)/.test(FACET)).toBe(true);
  });

  it("caps facet counts to the same ceiling as the list", () => {
    expect(/Math\.min\(n, COUNT_CAP\)/.test(FACET), "an uncapped facet beside a capped list is the contradiction").toBe(true);
    expect(/p_cap: COUNT_CAP,/.test(FACET), "the RPC path must use the same cap").toBe(true);
    expect(/countCapped: true/.test(FACET), "a capped figure presented as exact cannot be checked").toBe(true);
  });

  it("names which matcher produced the counts", () => {
    expect(/facetSource: qText \? "ranked" : "filters",/.test(FACET)).toBe(true);
  });

  it("binds the SAME filters into the facet count as the list", () => {
    // A facet counted without the active filters answers for the whole board.
    for (const f of ["p_country", "p_experience", "p_salary_floor", "p_companies", "p_work_mode", "p_remote"]) {
      expect(FACET, `the facet count must bind ${f}`).toContain(f);
    }
  });

  it("derives qText ONCE, above the facet block", () => {
    // Two derivations drift until the sidebar and the page disagree — which is
    // the defect this whole file is about.
    // Counted on the DECLARATION, not on one spelling of its right-hand side —
    // mutation-testing slipped a second `const qText = qt2.terms.join(...)`
    // past the narrower version of this check.
    expect((FN.match(/const qText\s*=/g) ?? []).length, "exactly one qText declaration").toBe(1);
    const qAt = FN.indexOf("const qText = qt.terms.join");
    const facetAt = FN.indexOf("if (body.facetCounts === true)");
    expect(qAt).toBeGreaterThan(-1);
    expect(qAt < facetAt, "qText must be derived before the facet block that reads it").toBe(true);
  });

  it("measures Load More against what the request actually fetched", () => {
    // The two-subset pager fetches fewer rows by design; comparing against a
    // size it never requests answers "no more" every time.
    expect(/const fetchUsed = twoSubset \? twoSubsetLimit : fetchLimit;/.test(FN)).toBe(true);
    expect(/\(data \?\? \[\]\)\.length === fetchUsed,/.test(FN)).toBe(true);
    expect(/\(data \?\? \[\]\)\.length === fetchLimit,/.test(FN),
      "the old comparison must be gone, or opting in to uncategorised jobs still costs every page after the first").toBe(false);
  });
});

describe("a salary-sorted search is ordered by the database, not by a window", () => {
  const FN2 = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
  const BLK = /const salaryTextSort[\s\S]*?catch \{ \/\* fall through to the substring path this query used before \*\/ \}/.exec(FN2)?.[0] ?? "";

  it("matches with word boundaries instead of substrings", () => {
    // q="nurse" sorted by salary returned "Unqualified Nursery Practitioner"
    // at #1, matched on "Nurser" by the substring path.
    expect(BLK, "the salary-sorted branch is missing").not.toBe("");
    expect(/\.textSearch\("title", ftsQuery\(qText\), \{ type: "websearch", config: "simple" \}\)/.test(BLK)).toBe(true);
  });

  it("orders in SQL on the indexed column, over the WHOLE match set", () => {
    // The previous attempt sorted a 180-row relevance window in memory: only 16
    // of those rows carried a stated salary, so 44 of 60 cards had no pay and
    // page 2 led higher than page 1.
    expect(/\.order\("salary_rank_usd", \{ ascending: false \}\)/.test(BLK)).toBe(true);
    // Paging is a plain offset into one stable ordering — no window to fall off.
    expect(/\.range\(offset, offset \+ limit - 1\)/.test(BLK)).toBe(true);
  });

  it("excludes unpriced rows rather than sorting them last", () => {
    // On a highest-paid-first page they are not a weak answer, they are 87% of
    // the board. The browse path's partial index takes the same view.
    expect(/\.not\("salary_rank_usd", "is", null\)/.test(BLK)).toBe(true);
    expect(/salaryStatedOnly: true,/.test(BLK), "and the page must say so").toBe(true);
  });

  it("degrades to the path this query used before", () => {
    expect(/withDeadline\(/.test(BLK)).toBe(true);
    expect(/hit its deadline/.test(BLK)).toBe(true);
    expect(/catch \{ \/\* fall through/.test(BLK)).toBe(true);
  });
});
