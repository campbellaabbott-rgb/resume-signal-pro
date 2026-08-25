import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE 30-DAY CAP WAS A PROPERTY OF THE LIST PATH ONLY.
 *
 * Every serving route binds `.gte("effective_posted", freshCutoffIso)` through
 * buildQuery — every route except `detail`. Measured 2026-08-25 on the source:
 * the detail action's 78 lines contained `effective_posted` ZERO times and
 * `freshCutoff` ZERO times; its whole predicate was
 * `.eq("id", id).is("missing_since", null)`.
 *
 * So anyone holding an id got a past-cap posting rendered in full with a
 * working apply button, under a board that advertises a 30-day cap — and ids
 * are not obscure: they are in the sitemap, in bookmarks, in shared links, and
 * in Google's index. The apply button is the harm. The point of the cap is not
 * to send someone at a role that is gone.
 *
 * A previous fix (20260728120000) added `missing_since IS NULL` here after the
 * same reasoning, and its header claimed it "covers every query shape". It did
 * not cover the freshness half of the rule. That is why this test asserts the
 * predicate's PRESENCE rather than trusting a header.
 *
 * ── the category rail ────────────────────────────────────────────────────
 * Second defect, same shape — a count that does not match what is served.
 * Inside ONE list response the categories facet summed to 564,179 while
 * `total` in the same payload was 556,076: the rail offered 8,103 openings the
 * board will not serve. `sourcesFacet` and `openTotal` were given the serving
 * rule when they were added; `categoriesFacet` was left on the raw table.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
// Comments stripped before every assertion: writing a guard's own literal into
// a nearby comment has silently passed a dead check in this repo nine times,
// and this file's fix ADDS a comment containing the very identifiers below.
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const MIG = readFileSync(
  resolve(ROOT, "supabase/migrations/20260825190000_the_category_rail_counted_jobs_the_board_will_not_serve.sql"),
  "utf8",
);

describe("a bookmarked job must obey the cap too", () => {
  // `exists` is defined BEFORE `detail` in this file, so slicing between the
  // two names in source order yields an empty string and every assertion below
  // passes vacuously. Bound the block by the NEXT action after detail instead.
  const detailStart = CODE.indexOf('if (action === "detail")');
  const detailEnd = CODE.indexOf('if (action === "', detailStart + 10);
  const detail = CODE.slice(detailStart, detailEnd > detailStart ? detailEnd : undefined);

  it("the block under test is actually found", () => {
    // An empty slice makes every toMatch below pass for the wrong reason.
    expect(detailStart).toBeGreaterThan(-1);
    expect(detail.length).toBeGreaterThan(500);
  });

  it("the detail action computes the same cutoff the list uses", () => {
    expect(detail).toMatch(/const detailCutoffMs = Date\.now\(\) - FRESH_WINDOW_DAYS \* 86_400_000;/);
  });

  it("it reads effective_posted, falling back exactly as the column does", () => {
    // effective_posted is coalesce(posted_at, first_seen). Using a different
    // definition here would relocate the inconsistency rather than fix it.
    expect(detail).toMatch(/\.effective_posted/);
    expect(detail).toMatch(/\.posted_at/);
    expect(detail).toMatch(/\.first_seen/);
  });

  it("a past-cap posting is refused, not rendered", () => {
    expect(detail).toMatch(/if \(Number\.isFinite\(effMs\) && effMs < detailCutoffMs\)/);
    expect(detail).toMatch(/agedOut: \{/);
  });

  it("an undated row is not refused for being undated", () => {
    // Number.isFinite guards an unparseable date. Undated rows still age out,
    // but via first_seen through effective_posted — never for lacking a date.
    expect(detail).toMatch(/Number\.isFinite\(effMs\)/);
  });

  it("the refusal says what happened instead of 404ing", () => {
    // There is already a `closed` response for a watched closure; an aged-out
    // row gets the same treatment so the client can offer live alternatives.
    expect(detail).toMatch(/title:/);
    expect(detail).toMatch(/capDays: FRESH_WINDOW_DAYS/);
  });

  it("the check runs before the description fetch", () => {
    // Otherwise an aged-out row still costs a vendor round trip.
    expect(detail.indexOf("detailCutoffMs")).toBeLessThan(detail.indexOf("await getDescription("));
  });
});

describe("the category rail counts what the board serves", () => {
  it("categoriesFacet carries both serving predicates", () => {
    const block = MIG.slice(MIG.indexOf("'categoriesFacet'"), MIG.indexOf("'sourcesFacet'"));
    expect(block).toMatch(/WHERE missing_since IS NULL/);
    expect(block).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("companiesFacet stays UNFILTERED, because it drives a delete", () => {
    // The orphan prune reads companiesFacet and DELETES postings. A board whose
    // rows have all aged past the cap would vanish from a filtered facet, read
    // as an orphan, and take live rows with it. Data loss, not a display bug —
    // pinned as an absence so a future tidy-up cannot "make it consistent".
    const block = MIG.slice(MIG.indexOf("'companiesFacet'"), MIG.indexOf("'categoriesFacet'"));
    const sql = block.replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/missing_since/);
    expect(sql).not.toMatch(/effective_posted/);
  });

  it("the rail and its denominator use one definition", () => {
    // categoriesFacet, sourcesFacet and openTotal must all agree, or the parts
    // stop summing to the whole again.
    for (const key of ["'categoriesFacet'", "'sourcesFacet'", "'openTotal'"]) {
      const i = MIG.indexOf(key);
      expect(i, `${key} missing`).toBeGreaterThan(-1);
      expect(MIG.slice(i, i + 500)).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
    }
  });

  it("the migration replaces the function rather than altering the table", () => {
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.refresh_job_board_facets\(\)/);
    expect(/ALTER TABLE|DROP TABLE|DELETE FROM/i.test(MIG)).toBe(false);
  });

  it("the definer function stays off the anon surface", () => {
    // A GRANT does not restrict: 107 of 121 definer functions were once
    // anon-callable in this project.
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_job_board_facets\(\) FROM PUBLIC, anon, authenticated;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_job_board_facets\(\) TO service_role;/);
  });
});
