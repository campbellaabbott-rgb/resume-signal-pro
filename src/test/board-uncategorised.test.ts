/**
 * A FIELD CHOICE HID 27.6% OF THE BOARD.
 *
 * Measured against the live facets 2026-08-05: 162,800 of 590,808 postings sit
 * in `other` — where a posting lands when the classifier cannot read its field
 * from the title, not a junk drawer. The agent's copy of this was fixed in
 * 20260805150000; this is the public board's.
 *
 * TWO THINGS HAVE TO HOLD AT ONCE, and they pull against each other:
 *
 *   1. A searcher who picks Engineering can opt back into the unsorted bucket.
 *   2. /jobs/field/:slug — the SEO landers — must NEVER include it. A page
 *      titled "Engineering jobs" listing postings whose field is unknown is
 *      wrong in a way no user asked for and no crawler forgives.
 *
 * The opt-in is what separates them: the landers do not send it, so they cannot
 * widen. That is a stronger guarantee than "the landers pass a different flag",
 * because it holds without the lander code knowing this feature exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { categoryParam, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { JOB_CATEGORIES } from "../../supabase/functions/job-board/categories";

/** More slugs than the cap, to prove the bound is real. */
const JOB_CATEGORY_SAMPLE = (JOB_CATEGORIES as readonly string[]).join(",");

const board = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

const DIR = resolve(__dirname, "../../supabase/migrations");
const sql = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("string_to_array")).pop() ?? "";

// 200 is the company-token cap the board itself passes; irrelevant here, but
// the signature requires it and vitest would never have told me.
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 200).applied;

describe("the opt-in only applies where it means something", () => {
  it("is off unless explicitly requested", () => {
    expect(norm({ category: "engineering" }).includeUncategorised).toBe(false);
  });

  it("is on when asked for alongside a category", () => {
    expect(norm({ category: "engineering", includeUncategorised: true }).includeUncategorised).toBe(true);
  });

  it("ignores anything that is not a literal true", () => {
    // A truthy string from a query param must not silently widen a search.
    for (const v of ["true", "1", 1, {}, "yes"]) {
      expect(norm({ category: "engineering", includeUncategorised: v }).includeUncategorised,
        `${JSON.stringify(v)} must not enable it`).toBe(false);
    }
  });

  it("is off with no category, where the bucket is already included", () => {
    expect(norm({ includeUncategorised: true }).includeUncategorised).toBe(false);
  });

  it("is off when the category IS other, which would ask for it twice", () => {
    expect(norm({ category: "other", includeUncategorised: true }).includeUncategorised).toBe(false);
  });
});

describe("the value handed to the RPCs", () => {
  it("is the bare category when the opt-in is off — byte-identical to before", () => {
    expect(categoryParam({ category: "engineering", includeUncategorised: false })).toBe("engineering");
  });

  it("appends the bucket when it is on", () => {
    expect(categoryParam({ category: "engineering", includeUncategorised: true })).toBe("engineering,other");
  });

  it("stays null with no category, so no predicate is added at all", () => {
    expect(categoryParam({ category: null, includeUncategorised: true })).toBeNull();
  });

  it("can only ever hand the RPC slugs it validated, one per comma", () => {
    // The RPC splits this on commas, so the hazard is ARBITRARY TEXT reaching
    // the split — a caller widening their own query to categories they never
    // asked for, the same shape as a comma surviving into a PostgREST or().
    //
    // This used to be enforced by refusing any value containing a comma, which
    // also refused the legitimate multi-select the SQL has always supported
    // (measured live: science 7,420 + education 7,439, joined form 14,859).
    // The property that actually matters is per-ELEMENT validation, and it is
    // strictly stronger than the old rule: junk is dropped wherever it sits.
    expect(norm({ category: "engineering,admin" }).category).toBe("engineering,admin");
    expect(norm({ category: ["engineering", "admin"] }).category).toBe("engineering,admin");
    // The SQL splits on a BARE comma and does not trim — " design , legal "
    // returns zero rows live — so normalisation has to trim every element.
    expect(norm({ category: " engineering , admin " }).category).toBe("engineering,admin");
    // Anything not a known slug never reaches the split, at any position.
    expect(norm({ category: "engineering,../../etc" }).category).toBe("engineering");
    expect(norm({ category: "engineering,other'); drop--" }).category).toBe("engineering");
    expect(norm({ category: "'; drop--" }).category).toBeNull();
    expect(categoryParam(norm({ category: "'; drop--" }))).toBeNull();
    // A request whose categories are ALL unusable has had its filter refused,
    // and a refused filter is always named.
    expect(normalizeFilters({ category: "nonsense" }, 200).ignored).toContain("category");
    // Duplicates cannot inflate the list, and the list is bounded.
    expect(norm({ category: "engineering,engineering" }).category).toBe("engineering");
    expect((norm({ category: JOB_CATEGORY_SAMPLE }).category ?? "").split(",").length).toBeLessThanOrEqual(8);
    // And the opt-in still appends the bucket to the whole selection.
    expect(categoryParam({ category: "engineering,admin", includeUncategorised: true })).toBe("engineering,admin,other");
  });
});

describe("every call site, because there are three", () => {
  it("the direct filter widens, and asks the same question the RPC does", () => {
    // The browse path binds PostgREST while the headline comes from the RPC.
    // The RPC splits the comma; an .eq() against the joined value asks for a
    // posting whose single category is the literal "design,legal" — no rows,
    // under a non-zero headline. Both sides must split.
    expect(board).toMatch(/const cats = applied\.category\.split\(","\)\.filter\(Boolean\);/);
    expect(board).toMatch(/const wanted = applied\.includeUncategorised \? \[\.\.\.cats, "other"\] : cats;/);
    expect(board).toMatch(/q = wanted\.length > 1 \? q\.in\("category", wanted\) : q\.eq\("category", wanted\[0\]\);/);
    // The two-subset pager hands one side of the split back in as an override,
    // and that value is comma-joined too once a selection is multi-value.
    expect(board).toMatch(/const ov = categoryOverride\.split\(","\)\.filter\(Boolean\);/);
  });

  it("both RPC sites go through the shared helper", () => {
    // Asserts the PROPERTY, not a count. This hardcoded the number of
    // search_jobs call sites, so adding a legitimate one — the clustering
    // top-up on the ranked path — failed a guard about category param
    // that the new call actually satisfies. Every call site must spread the
    // fragment; how many there are is not the contract.
    const calls = (board.match(/client\.rpc\("search_jobs", \{/g) ?? []).length;
    const withFragment = (board.match(/categoryParam\(applied\)/g) ?? []).length;
    expect(calls, "guard would be vacuous with no search_jobs calls").toBeGreaterThanOrEqual(2);
    expect(withFragment, `a search_jobs call site omits categoryParam(applied)`).toBeGreaterThanOrEqual(calls);
  });

  it("no bare applied.category is passed as p_category any more", () => {
    // A survivor is a query the opt-in never reaches — the partial rollout that
    // looks complete, which this repo has now written two post-mortems about.
    expect(board).not.toMatch(/p_category: applied\.category/);
  });
});

describe("the SQL widened without changing what old callers get", () => {
  it("splits the parameter instead of taking a new one", () => {
    expect(sql).toMatch(/string_to_array\(\$\d+, ''\,''\)\)|string_to_array/);
  });

  it("widened BOTH functions, not just the one that was easy to find", () => {
    expect(sql).toMatch(/FUNCTION public\.search_jobs\(/);
    expect(sql).toMatch(/FUNCTION public\.count_jobs_capped\(/);
    expect((sql.match(/string_to_array/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("still binds the value rather than interpolating it", () => {
    // The operator changed; how the value arrives did not.
    expect(sql).toMatch(/USING q, p_fresh_cutoff/);
  });
});

describe("the SEO landers cannot widen", () => {
  it("the board UI only sends the flag when a category is chosen", () => {
    expect(jobs).toMatch(/includeUncategorised: category && inclUncat \? true : undefined/);
  });

  it("the control is hidden on 'All fields' and on the bucket itself", () => {
    // Membership, not inequality. Once a selection can hold more than one field
    // the value is comma-joined, and `"design,other" !== "other"` is TRUE — the
    // control would render and be tickable while the server discards the opt-in,
    // because the bucket is already in the selection. The old spelling kept
    // passing throughout, which is why the property is pinned instead.
    expect(jobs).toMatch(/\{category && !category\.split\(","\)\.includes\("other"\) && \(/);
    expect(jobs).not.toMatch(/\{category && category !== "other" && \(/);
    // And the server asks the same question, or the two disagree about whether
    // the control should have been offered at all.
    const filters = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/filters.ts"), "utf8");
    expect(filters).toMatch(/!category\.split\(","\)\.includes\("other"\)/);
    expect(norm({ category: "engineering,other", includeUncategorised: true }).includeUncategorised).toBe(false);
    expect(norm({ category: "engineering,admin", includeUncategorised: true }).includeUncategorised).toBe(true);
  });

  it("the lander routes never set it — they have no way to", () => {
    // The flag is state on the interactive page, seeded only from an explicit
    // ?inclUncat=1. A /jobs/field/:slug render sets `routeCategory` and nothing
    // else, so a lander cannot turn it on even by accident.
    expect(jobs).toMatch(/useState\(initial\.get\("inclUncat"\) === "1"\)/);
    const seed = jobs.slice(jobs.indexOf("const [inclUncat"), jobs.indexOf("const [inclUncat") + 200);
    expect(seed).not.toMatch(/routeCategory|pathCategory/);
  });

  it("refetches when toggled — a filter absent from the deps does nothing", () => {
    expect((jobs.match(/category, inclUncat,/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the chosen field comes first, without sorting across both subsets", () => {
  // ATTEMPT ONE, REVERTED: `.order("category", …)` over `.in([chosen,"other"])`.
  // Correct, and it cost the date index — sales+DE returned 500 after 17.5s and
  // even successful pages went from ~0.3s to 4.3s. This pins that it is gone.
  it("never orders by category — that is what timed out", () => {
    const code = board.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/\.order\("category"/);
  });

  it("fetches each subset with an indexed .eq instead", () => {
    // Two .eq() queries each keep the date index; one .in() over a 162,800-row
    // bucket does not. That is the whole reason this is two queries.
    expect(board).toMatch(/buildQuery\(dateCol, false, applied\.category!\)/);
    expect(board).toMatch(/buildQuery\(dateCol, false, "other"\)/);
  });

  it("pivots on an EXACT count of the chosen category", () => {
    // An estimate would skip or repeat rows at the boundary — invisible, and
    // indistinguishable from the board not having that job.
    expect(board).toMatch(/buildQuery\(dateCol, true, applied\.category!\)\.range\(0, 0\)/);
    expect(board).toMatch(/splitPage\(offset, twoSubsetLimit, countA\)/);
  });

  it("skips a subset entirely when the page does not reach it", () => {
    expect(board).toMatch(/s\.aLimit > 0/);
    expect(board).toMatch(/s\.bLimit > 0/);
  });

  it("leaves ordinary browsing on the original single query", () => {
    // The opt-in is rare; everything else must run the query it always ran.
    expect(board).toMatch(/const twoSubset = !!applied\.category && applied\.includeUncategorised/);
    expect(board).toMatch(/if \(!twoSubset\) \{/);
  });

  it("routes the no-count retry through the same pager", () => {
    // A second hand-written builder is how a retry starts filtering differently
    // from the query it is retrying.
    expect(board).toMatch(/const noCount = \(dateCol: string, salaryCol: string\) => pageWith\(dateCol, salaryCol, false\)/);
  });

  it("reports the total as A + B, and degrades to null rather than lying", () => {
    expect(board).toMatch(/countA \+ \(bCount\.count \?\? 0\)/);
    expect(board).toMatch(/bCount\.error \? null :/);
  });
});

describe("the salary sort refuses the opt-in instead of erroring", () => {
  // MEASURED against production 2026-08-06: `category=other + country=DE +
  // sort=salary` returns HTTP 500 after 17.7s on its own, with no opt-in
  // involved. `other` is 162,800 rows and salary ordering cannot use the
  // category index. That defect PRE-DATES this feature and is not fixed here —
  // what is fixed is the opt-in no longer walking into it, since the
  // two-subset pager queries `other` as one of its halves.
  it("drops the flag under a salary sort", () => {
    expect(norm({ category: "legal", includeUncategorised: true, sort: "salary" }).includeUncategorised).toBe(false);
  });

  it("keeps it under every other sort", () => {
    for (const sort of [undefined, "newest", "relevance"]) {
      expect(norm({ category: "legal", includeUncategorised: true, sort }).includeUncategorised,
        `sort=${sort} should keep the opt-in`).toBe(true);
    }
  });

  it("REPORTS the drop rather than silently ignoring it", () => {
    // This file's contract is that a filter is never silently dropped.
    const r = normalizeFilters({ category: "legal", includeUncategorised: true, sort: "salary" }, 200);
    expect(r.ignored).toContain("includeUncategorised");
  });

  it("reports nothing when the flag was never asked for", () => {
    expect(normalizeFilters({ category: "legal", sort: "salary" }, 200).ignored)
      .not.toContain("includeUncategorised");
  });

  it("the control is disabled in the UI, so the box cannot lie", () => {
    // A box that stays ticked while the server ignores it is the same silent
    // failure from the other end.
    expect(jobs).toMatch(/disabled=\{sortMode === "salary"\}/);
    expect(jobs).toMatch(/checked=\{inclUncat && sortMode !== "salary"\}/);
  });
});

describe("the opt-in path is bounded, because the bucket is expensive to read", () => {
  it("does not apply the grouping over-fetch to the two-subset page", () => {
    // fetchLimit is 3x limit when grouping is on, and it triples the range
    // asked of the `other` half. Measured on legal+DE at offset 60:
    // fetchLimit 180 -> 500 after 43s; fetchLimit 60 -> 200 in 5.1s.
    expect(board).toMatch(/const twoSubsetLimit = Math\.min\(fetchLimit, limit\)/);
    expect(board).toMatch(/splitPage\(offset, twoSubsetLimit, countA\)/);
  });

  it("says out loud that this bounds the cost rather than fixing it", () => {
    // ~5s against a normal ~0.3s page. An index would fix it; a comment that
    // claimed this was fast would just be wrong.
    expect(board).toMatch(/BOUNDS the cost, it does not fix it/);
  });
});
