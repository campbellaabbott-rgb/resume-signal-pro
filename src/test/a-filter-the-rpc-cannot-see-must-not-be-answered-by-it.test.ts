import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFilters, rpcBlindFilters } from "../../supabase/functions/job-board/filters";

/**
 * SIX NEW FILTERS BOUND IN buildQuery, AND THE DEFAULT SEARCH PATH IS NOT
 * buildQuery.
 *
 * payBasis, hasStatedPay, salaryCeiling, maxYears, department and vendors were
 * added 2026-08-25 and bound in buildQuery — the one filter binder. But a text
 * query with sort != salary is served by the search_jobs RPC, and the count by
 * count_jobs_capped, and NEITHER has a parameter for any of the six. So the
 * page would have served unfiltered rows under six lit-up chips, and headlined
 * a total counted over the unfiltered population.
 *
 * This is not a new failure mode. It is the 2026-07-25 p_work_mode defect
 * exactly: a filter added to the binder and not to the RPC that bypasses it.
 * The repo already carries the remedy in the same function — cappedCount
 * refuses a multi-country request for the same reason and falls through to an
 * exact count through buildQuery, calling it "a deploy guard" rather than a
 * degradation.
 *
 * rpcBlindFilters() names any active filter the RPCs cannot bind. It shipped
 * with the six but had ZERO production callers, which is one step from the
 * dead-code-passing-a-guard pattern this repo has been caught by nine times.
 * These tests assert the FUNCTION's behaviour by calling it, and separately
 * that it is actually wired in at all three blind sites.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

// 64 = the companyTokenLimit index.ts passes (JOB_SOURCES.length); irrelevant to
// these cases, which set no company, but the parameter is required.
const applied = (body: Record<string, unknown>) => normalizeFilters(body, 64).applied;

describe("a filter the RPC cannot see must not be answered by it", () => {
  // THE FIVE MOVED OUT OF THE BLIND SET ON 2026-08-27. While blind they were
  // correctly diverted — and the diversion was the quality cliff this file's
  // header describes: any one of them cost the search ranking, the trigram
  // tier, the exact-word tier and semantic, all at once, with nothing on
  // screen to say so. 20260827210000 teaches all three RPCs the four
  // parameters (p_salary_ceiling, p_pay_basis, p_max_years, p_department) and
  // vendors rides the existing p_sources. Executed against real Postgres:
  // nine filter combinations return the correct rows, the injection probe
  // returns zero, and the ceiling honours the include-unstated widening the
  // same way the floor does. So the assertion FLIPS: reporting one of these
  // blind would push its searches back off the ranked path.
  it.each([
    ["payBasis", { payBasis: "hourly" }],
    ["salaryCeiling", { salaryCeiling: 120000 }],
    ["maxYears", { maxYears: 3 }],
    ["department", { department: "nursing" }],
    ["vendors", { vendor: "workday" }],
  ] as const)("%s is RPC-bound now — never diverted off the ranked path", (name, body) => {
    const blind = rpcBlindFilters(applied({ ...body }));
    expect(blind, `${name} is reported blind — its searches lose ranking and every rescue tier`).toEqual([]);
  });

  it("the four new parameters are actually sent when their filters are on", () => {
    // Bound in the SET and omitted from the CALL is the guard-literals trap:
    // the router stops diverting while the RPC never hears the filter, and the
    // page serves unfiltered rows under lit-up chips — the exact defect this
    // file was written about, reintroduced by its own fix.
    expect(CODE).toMatch(/\.\.\.extraFilterParams\(applied\),/);
    const spreads = (CODE.match(/\.\.\.extraFilterParams\(applied\),/g) ?? []).length;
    expect(spreads, "every payParams spread site must carry extraFilterParams beside it")
      .toBe((CODE.match(/\.\.\.payParams\(applied\),/g) ?? []).length);
  });

  it("a request the RPC CAN answer is not diverted", () => {
    // The gate must not push ordinary searches off the fast path — search_jobs
    // measured 130-330ms against a buildQuery page that runs to seconds on a
    // rare word. Diverting every query would be a large latency regression.
    expect(rpcBlindFilters(applied({ q: "nurse" }))).toEqual([]);
    expect(rpcBlindFilters(applied({ q: "nurse", country: "US", workMode: "remote", category: "engineering" }))).toEqual([]);
    expect(rpcBlindFilters(applied({ q: "nurse", experience: "senior", salaryFloor: 100000 }))).toEqual([]);
    // hasStatedPay MOVED OUT of the blind set on 2026-08-26. 20260826041500
    // gives all three RPCs `p_pay_stated`, binding the identical predicate
    // buildQuery uses (salary_min_annual IS NOT NULL). While it was blind, a
    // stated-pay search was diverted off the ranked path entirely and lost
    // ranking, the trigram tier and the semantic tier with it — the diversion
    // was correct given the SQL, and the SQL is what changed.
    expect(rpcBlindFilters(applied({ hasStatedPay: true }))).toEqual([]);
    expect(rpcBlindFilters(applied({ q: "nurse", hasStatedPay: true, salaryFloor: 100000 }))).toEqual([]);
    // The widening twin is bound by the same migration.
    expect(rpcBlindFilters(applied({ salaryFloor: 100000, includeUnstatedPay: true }))).toEqual([]);
  });

  it("an unset filter is never reported blind", () => {
    // A false positive here costs every search the fast path.
    expect(rpcBlindFilters(applied({}))).toEqual([]);
    expect(rpcBlindFilters(applied({ department: "   ", maxYears: 0, salaryCeiling: 0 }))).toEqual([]);
  });

  it("the count refuses rather than counting the wrong population", () => {
    // Mirrors the multi-country guard immediately above it, which the file
    // itself documents as a deploy guard rather than a degradation: the caller
    // falls through to an exact count through buildQuery.
    expect(CODE).toMatch(/if \(rpcBlindFilters\(applied\)\.length\) return null;/);
  });

  it("both row-serving search_jobs paths are gated too", () => {
    // Refusing only the count would be worse than not gating at all: the page
    // would serve unfiltered rows under an accurate-looking total.
    const gated = (CODE.match(/!rpcBlindFilters\(applied\)\.length/g) ?? []).length;
    expect(gated, "expected both search_jobs serving sites to carry the gate").toBeGreaterThanOrEqual(2);
  });

  it("the gate has real production callers, not just this test", () => {
    // rpcBlindFilters shipped exported, tested, and called by nothing.
    expect((CODE.match(/rpcBlindFilters\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(CODE).toMatch(/import \{[^}]*rpcBlindFilters[^}]*\} from "\.\/filters\.ts";/);
  });
});
