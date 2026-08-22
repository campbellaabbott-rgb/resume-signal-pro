import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD HAD TWO TIME FILTERS ANSWERING THE SAME QUESTION ON OPPOSITE AXES.
 *
 * effective_posted is coalesce(posted_at, first_seen) — the company's date when
 * there is one, OUR CRAWL TIME when there is not. maxAgeDays has always bound to
 * posted_at; postedAfter bound to effective_posted; and sort=newest ordered by
 * effective_posted.
 *
 * MEASURED live, same instant, same 24-hour question, category=design:
 *     postedAfter -> 467 rows        maxAgeDays:1 -> 90 rows
 * and 60 of the 60 rows postedAfter returned had NO company-stated date at all.
 * postedAfter is the filter behind the saved-search "new since you last looked"
 * badge, so that badge was inflated roughly fivefold by postings whose age
 * nobody knows.
 *
 * sort=newest was worse: 57 of 60 rows on page one had postedAt=null. An undated
 * posting inherits first_seen — effectively now — and sorts above everything,
 * so the 10% of the corpus with no date was burying the 540,437 postings that
 * carry one.
 *
 * THE REPO ALREADY KNEW THIS. A previous incident is recorded as "first_seen is
 * never a posting age", and it was reintroduced on two different surfaces.
 *
 * Ordering on posted_at is also FIVE TIMES CHEAPER — measured at concurrency 4,
 * 0.20-0.37s against 1.03-1.23s, because it reads a plain column instead of a
 * coalesce. The honest fix was the fast one.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const FILTERS = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/filters.ts"), "utf8");

describe("a date filter must mean the employer's date", () => {
  it("binds postedAfter to the company-stated date, not our crawl time", () => {
    expect(
      /if \(applied\.postedAfter\) q = q\.gt\("posted_at", applied\.postedAfter\);/.test(FN),
      "postedAfter on effective_posted answers 'we found this recently', not 'they posted this recently'",
    ).toBe(true);
    expect(/q\.gt\(dateCol, applied\.postedAfter\)/.test(FN), "the crawl-time binding must be gone").toBe(false);
  });

  it("orders 'newest' by the company date, with undated last", () => {
    expect(/newestFirst\s*\n\s*\? q\.order\("posted_at", \{ ascending: false, nullsFirst: false \}\)/.test(FN)).toBe(true);
  });

  it("does not page a posted_at ordering with a dateCol cursor", () => {
    // The keyset cursor is written in terms of dateCol. Pairing it with a
    // posted_at order pages through one ordering using another's coordinates —
    // the exact defect that made sorted page two repeat page one.
    expect(/if \(cursor && !sortSalary && !newestFirst\) \{/.test(FN)).toBe(true);
  });

  it("keeps the serving WINDOW on effective_posted", () => {
    // An undated posting should still be served — it just should not claim to
    // be the newest thing on the board.
    expect(/\.gte\(dateCol, freshCutoffIso\)/.test(FN)).toBe(true);
  });

  it("admits when it narrowed the window it was asked for", () => {
    // maxAgeDays 30, 90 and 365 all returned identical results with nothing in
    // the body saying the window had been cut. ignoredFilters cannot fire,
    // because a clamped value is non-null and therefore counts as honoured.
    expect(/const maxAgeClamped = Number\.isFinite\(ageN\) && ageN > 30;/.test(FILTERS)).toBe(true);
    // Carried BESIDE applied, not inside it. board-filter-contract counts every
    // field of AppliedFilters as a filter and isUnfiltered() treats any truthy
    // value as one — so putting a notice in there would make a clamped request
    // look filtered and re-route it. That test caught exactly this.
    expect(/maxAgeClamped: boolean;/.test(FILTERS), "the notice belongs on NormalizedFilters").toBe(true);
    expect(/ignored,\n    maxAgeClamped,/.test(FILTERS), "returned beside ignored, not inside applied").toBe(true);
    expect(/if \(maxAgeClamped\) out\.maxAgeClampedTo = 30;/.test(FN)).toBe(true);
  });

  it("says that postedAfter now excludes undated postings", () => {
    // It changes what the filter returns — 467 rows became 90 on the same
    // question — so it cannot change silently.
    expect(/out\.postedAfterUsesStatedDate = true;/.test(FN)).toBe(true);
  });

  it("binds postedAfter to the employer's date on EVERY path, not just browse", () => {
    // THE FIX LANDED ON ONE OF THE PATHS AND THE DISCLOSURE LANDED ON ALL OF THEM.
    //
    // e16fcdc3 corrected the browse path to posted_at. The RANKED path is served
    // by the search_jobs / count_jobs_capped RPCs, and those kept binding
    // effective_posted = coalesce(posted_at, first_seen) — so any request
    // carrying `q` still answered "we first SAW it after X". Measured live
    // 2026-08-22: q=manager postedAfter=2026-08-20 returned total 10,000 with 14
    // of 60 rows carrying no employer date, against 7,274 and 0 of 60 for the
    // honest maxAgeDays comparator.
    //
    // That mismatch was about to become a LIE rather than a silence.
    // postedAfterUsesStatedDate is set in searchDisclosures, which is spread at
    // all eight list exits including the ranked ones, and the page now renders
    // it. Shipping the disclosure without this bind would have printed "counted
    // from the date each employer stated" on a path that did no such thing.
    //
    // So: the two paths must name the SAME column, and this checks the newest
    // migration that defines the functions rather than any particular file.
    const dir = resolve(__dirname, "../../supabase/migrations");
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.search_jobs\(/.test(readFileSync(resolve(dir, f), "utf8")))
      .sort();
    expect(defining.length, "no migration defines the search RPC").toBeGreaterThan(0);
    const sql = readFileSync(resolve(dir, defining[defining.length - 1]), "utf8");
    const binds = [...sql.matchAll(/p_posted_after IS NOT NULL THEN filters := filters \|\| ' AND p\.(\w+) >/g)].map((m) => m[1]);
    expect(binds.length, `expected both functions to bind p_posted_after in ${defining[defining.length - 1]}`).toBe(2);
    for (const col of binds) {
      expect(
        col,
        "the RPC must filter the EMPLOYER's posted_at. effective_posted coalesces " +
          "first_seen, which is our crawl time, so an undated posting passes on the " +
          "strength of when we happened to find it.",
      ).toBe("posted_at");
    }
    // And the browse path must still agree with them.
    expect(FN).toMatch(/applied\.postedAfter\) q = q\.gt\("posted_at", applied\.postedAfter\)/);
  });
});
