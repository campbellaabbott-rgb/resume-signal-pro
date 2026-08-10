/**
 * ONE LINE, DRAWN ONCE: SERVING COUNTS INCLUDE EVERYTHING, EDITORIAL CLAIMS DO NOT.
 *
 * Domino's joined the board on 2026-08-10: 24,566 postings, ~4% of the corpus
 * from one franchise brand, ~97% of them the same four store roles (measured,
 * 400 sampled across four offsets). Real vacancies at real stores — it passes
 * every merge rule — and completely unlike the rest of the corpus.
 *
 * That forces a distinction this codebase had never had to state:
 *
 *   SERVING surfaces answer "what is on the board" — search, filters, the
 *   category and company facets, total_open, the Ghost Job Index counts. These
 *   INCLUDE everything the board serves. A count that excludes rows the board
 *   shows is the two-numbers-for-one-quantity bug removed from the homepage
 *   one day earlier; it must not be reintroduced from the other direction.
 *
 *   EDITORIAL surfaces answer "what is happening in hiring" — trends,
 *   rankings, segments, who-is-hiring. These EXCLUDE, because one brand
 *   listing its stores is not a market trend, and a true row can still make a
 *   false claim once it is aggregated into a statement about the world.
 *
 * The mechanism is showcase_excluded, which already existed for staffing
 * agencies and spam boards. Domino's is neither, and its stored reason says so
 * in words — a future reader must not conclude a real employer was judged a
 * mill.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => readFileSync(resolve(DIR, f), "utf8"));

/** Latest migration whose text contains this DDL fragment. Matching on DDL,
 *  never on a bare identifier — "latest file mentioning X" repeatedly picked up
 *  a follow-up migration and asserted against the wrong body. */
const latestWith = (fragment: string) => {
  const hit = all.filter((t) => t.includes(fragment)).pop();
  if (!hit) throw new Error(`no migration contains: ${fragment}`);
  return hit;
};

/** A function body, bounded by its own terminator — not a fixed char window,
 *  which a growing function silently outgrows. */
const bodyOf = (sql: string, fn: string) => {
  const i = sql.indexOf(`FUNCTION public.${fn}`);
  expect(i, `${fn} not found`).toBeGreaterThan(-1);
  const j = sql.indexOf("$$;", i);
  return sql.slice(i, j === -1 ? undefined : j);
};

const EXCLUSION = /company_token NOT IN \(SELECT company_token FROM (public\.)?showcase_excluded\)|company_token NOT IN \(SELECT company_token FROM excluded\)/;

describe("editorial surfaces exclude", () => {
  const CASES: Array<[string, string]> = [
    ["get_trending_categories", "a category cannot trend because one brand listed its stores"],
    ["get_hiring_trends", "the weekly hiring line describes the market, not one employer"],
    ["get_size_segments", "company-size segments rank employers against each other"],
    ["get_entry_level_companies", "a who-is-hiring ranking is the definition of editorial"],
    ["get_board_velocity", "hot-tier selection is a cost decision, not a serving one"],
  ];

  for (const [fn, why] of CASES) {
    it(`${fn} — ${why}`, () => {
      expect(bodyOf(latestWith(`FUNCTION public.${fn}`), fn)).toMatch(EXCLUSION);
    });
  }

  it("hiring trends filters ALL THREE legs, not just the live one", () => {
    // Filtering only live postings while counting an excluded board's closures
    // would show closes with no posts behind them — a hiring collapse that
    // never happened. Survivorship correction has to be symmetric.
    const body = bodyOf(latestWith("FUNCTION public.get_hiring_trends"), "get_hiring_trends");
    const legs = ["posted_live AS", "posted_closed AS", "closes AS"];
    for (const leg of legs) {
      const i = body.indexOf(leg);
      expect(i, `${leg} missing`).toBeGreaterThan(-1);
      const chunk = body.slice(i, body.indexOf("GROUP BY", i));
      expect(chunk, `${leg} does not exclude`).toMatch(EXCLUSION);
    }
  });
});

describe("serving surfaces stay inclusive", () => {
  // If any of these ever starts excluding, a published number stops agreeing
  // with what a visitor can see on the board — which is exactly the bug class
  // this project keeps paying for.
  const CASES: Array<[string, string]> = [
    ["get_ghost_job_index_stats", "corpus counts must equal the corpus"],
    ["get_job_board_facets", "the company/category facets drive the board's own filters"],
    ["get_board_vendor_counts", "the vendor wall counts what /jobs will serve"],
    ["get_date_coverage", "per-vendor coverage describes the whole corpus"],
  ];

  for (const [fn, why] of CASES) {
    it(`${fn} — ${why}`, () => {
      expect(bodyOf(latestWith(`FUNCTION public.${fn}`), fn)).not.toMatch(EXCLUSION);
    });
  }
});

describe("the hot tier is capped through BOTH doors", () => {
  const idx = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

  it("size ranking filters the exclusion set too, not just velocity", () => {
    // Velocity and size are independent routes into the hot tier. Domino's
    // would top BOTH; filtering one is a half-fix that reads as done.
    expect(idx).toMatch(/\.filter\(\(c\) => !hotExcluded\.has\(c\.token\)\)/);
    expect(idx).toMatch(/from\("showcase_excluded"\)\.select\("company_token"\)/);
  });

  it("a failed read degrades to the OLD behaviour, not to an empty hot tier", () => {
    const i = idx.indexOf("const hotExcluded = new Set<string>()");
    expect(i).toBeGreaterThan(-1);
    const block = idx.slice(i, idx.indexOf("const sizeRanked", i));
    expect(block).toMatch(/catch \{[^}]*\}/);
    // The set starts empty and is only ever added to — so an error leaves it
    // empty, which excludes nothing.
    expect(block).not.toMatch(/hotExcluded\.clear\(\)|return;/);
  });
});

describe("the exclusion row does not read as an accusation", () => {
  const mig = latestWith("'dominos',");

  it("says explicitly that this is not a mill", () => {
    // Every other row in this table is a staffing agency or a spam board. A
    // reader who finds a real employer here and assumes the same thing would
    // be defaming it — and would set a false precedent for the next call.
    expect(mig).toMatch(/NOT a mill/);
    expect(mig).toMatch(/CONCENTRATION alone/);
  });

  it("records that it is still fully served", () => {
    // Matched within ONE SQL string literal: the reason is concatenated across
    // lines, so a phrase spanning the join exists in the rendered value but
    // never in the file. The first version of this assertion spanned it and
    // failed against copy that was actually correct.
    expect(mig).toMatch(/Fully served in search/);
  });
});
