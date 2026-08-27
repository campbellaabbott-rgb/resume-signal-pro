import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFilters } from "../../supabase/functions/job-board/filters";

/**
 * Two filter defects, both measured live on 2026-08-27.
 *
 * 1. "REMOTE OR HYBRID" WAS UNASKABLE. category, country, experience and vendor
 *    all take several values; work_mode alone took one, all the way down —
 *    a single string in filters.ts, .eq() in the query builder, and
 *    `p.work_mode = quote_literal(...)` in all three SQL functions. In GB that
 *    is 1,476 remote and 3,765 hybrid, so the either-question is 5,241 postings
 *    against the 1,476 a searcher could reach. work_mode is populated on 28.1%
 *    of servable rows — the board's second-most-populated discretionary column,
 *    and it could only be asked a third of a question.
 *
 * 2. A PAY CEILING SILENTLY CANCELLED includeUnstatedPay. The toggle widens an
 *    active floor by ORing `salary_rank_usd IS NULL` back in; the ceiling
 *    shipped later as a plain .lte(), which PostgREST ANDs — and NULL fails
 *    `<=`, so every unpriced row the toggle had just re-admitted was thrown
 *    straight back out. category=design at a $100k floor: 405 without the
 *    toggle, 3,375 with it, and 404 once a $300k ceiling is added. Three lit
 *    controls, and the toggle contributing nothing. This is the pay-floor NULL
 *    discard — the exact bug includeUnstatedPay exists to fix — re-armed by a
 *    second predicate.
 */
const applied = (body: Record<string, unknown>) => normalizeFilters(body, 64).applied;
const ignored = (body: Record<string, unknown>) => normalizeFilters(body, 64).ignored;

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const API = readFileSync(
  resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

describe("either mode, and a band that keeps its widening", () => {
  it("accepts several work modes", () => {
    expect(applied({ workMode: "remote,hybrid" }).workMode).toBe("remote,hybrid");
    expect(applied({ workMode: ["remote", "onsite"] }).workMode).toBe("remote,onsite");
  });

  it("leaves a single mode byte-identical — no existing caller changes meaning", () => {
    expect(applied({ workMode: "remote" }).workMode).toBe("remote");
    expect(applied({ workMode: "hybrid" }).workMode).toBe("hybrid");
    expect(applied({}).workMode).toBeNull();
  });

  it("keeps the good elements, drops the bad, and says it dropped them", () => {
    expect(applied({ workMode: "remote,bogus" }).workMode).toBe("remote");
    expect(ignored({ workMode: "remote,bogus" })).toContain("workMode");
    // Every element unusable is the same as asking for nothing — and is still
    // reported, exactly as before.
    expect(applied({ workMode: "bogus" }).workMode).toBeNull();
    expect(ignored({ workMode: "bogus" })).toContain("workMode");
    // A clean request must NOT be reported.
    expect(ignored({ workMode: "remote,hybrid" })).not.toContain("workMode");
  });

  it("dedupes and cannot exceed the closed domain", () => {
    expect(applied({ workMode: "remote,remote,hybrid" }).workMode).toBe("remote,hybrid");
    const all = applied({ workMode: "remote,hybrid,onsite" }).workMode!;
    expect(all.split(",")).toHaveLength(3);
  });

  it("stays a string, so no RPC signature moves", () => {
    // p_work_mode stays `text` and carries a comma-joined list precisely so no
    // overload can be created. A stray overload makes PostgREST answer PGRST203
    // to every call — the failure that killed affiliate conversion for eight
    // months and took ranked search down twice.
    expect(typeof applied({ workMode: "remote,hybrid" }).workMode).toBe("string");
    expect(BOARD).toMatch(/q\.in\("work_mode", applied\.workMode\.split\(","\)\)/);
  });

  it("the pay ceiling shares the toggle's widening on BOTH read paths", () => {
    // Without this the ceiling re-arms the NULL discard and the toggle
    // contributes zero on every banded search.
    expect(BOARD, "the board's query builder").toMatch(
      /salary_rank_usd\.lte\.\$\{applied\.salaryCeiling\},salary_rank_usd\.is\.null/);
    expect(API, "and the public API, or the two disagree about one band").toMatch(
      /salary_rank_usd\.lte\.\$\{salaryMax\},salary_rank_usd\.is\.null/);
    // Still a plain ceiling when the toggle is off — widening unasked-for would
    // be the opposite bug.
    expect(BOARD).toMatch(/: q\.lte\("salary_rank_usd", applied\.salaryCeiling\);/);
    expect(API).toMatch(/: q\.lte\("salary_rank_usd", salaryMax\);/);
  });
});
