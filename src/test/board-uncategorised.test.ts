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

  it("can only ever join a validated slug to the literal other", () => {
    // The RPC now splits this on commas. If arbitrary text could reach it, a
    // caller could widen their own query to categories they never asked for —
    // the same hazard as a comma surviving into the mandate's PostgREST or().
    const injected = norm({ category: "engineering,admin", includeUncategorised: true });
    expect(injected.category, "an unknown slug must be rejected outright").toBeNull();
    expect(categoryParam(injected)).toBeNull();
  });
});

describe("every call site, because there are three", () => {
  it("the direct filter widens", () => {
    expect(board).toMatch(/q\.in\("category", \[applied\.category, "other"\]\)/);
  });

  it("both RPC sites go through the shared helper", () => {
    // Three occurrences: count_jobs_capped, and search_jobs on two paths.
    expect((board.match(/p_category: categoryParam\(applied\)/g) ?? []).length).toBe(3);
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
    expect(jobs).toMatch(/\{category && category !== "other" && \(/);
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

describe("the chosen field IS still buried, and that is a known open problem", () => {
  // Ordering the chosen category ahead of `other` was implemented, deployed,
  // and reverted the same day: `.order("category", …)` stops Postgres using the
  // date index, so the widened set sorts in full — sales+DE returned 500 after
  // 17.5s, engineering took 4.3s against a normal ~0.3s page.
  //
  // This test exists so the one-liner is not re-attempted from scratch. It
  // pins the ABSENCE, with the reason attached.
  it("does not order by category — it times out on large widened sets", () => {
    // COMMENTS STRIPPED: the note above the revert quotes `.order("category")`
    // in order to explain why it is gone, and a check that cannot tell a
    // prohibition from a violation would force the reasoning out of the file.
    const code = board.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/\.order\("category"/);
  });

  it("records why, so the next person starts from the measurement", () => {
    expect(board).toMatch(/statement timeout/);
    expect(board).toMatch(/pages the two subsets SEPARATELY|two subsets/i);
  });
});
