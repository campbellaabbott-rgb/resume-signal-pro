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
  it.each([
    ["payBasis", { payBasis: "hourly" }],
    ["hasStatedPay", { hasStatedPay: true }],
    ["salaryCeiling", { salaryCeiling: 120000 }],
    ["maxYears", { maxYears: 3 }],
    ["department", { department: "nursing" }],
    ["vendors", { vendor: "workday" }],
  ] as const)("%s is reported blind when set", (name, body) => {
    const blind = rpcBlindFilters(applied({ ...body }));
    expect(blind.length, `${name} set but rpcBlindFilters returned ${JSON.stringify(blind)}`).toBeGreaterThan(0);
  });

  it("a request the RPC CAN answer is not diverted", () => {
    // The gate must not push ordinary searches off the fast path — search_jobs
    // measured 130-330ms against a buildQuery page that runs to seconds on a
    // rare word. Diverting every query would be a large latency regression.
    expect(rpcBlindFilters(applied({ q: "nurse" }))).toEqual([]);
    expect(rpcBlindFilters(applied({ q: "nurse", country: "US", workMode: "remote", category: "engineering" }))).toEqual([]);
    expect(rpcBlindFilters(applied({ q: "nurse", experience: "senior", salaryFloor: 100000 }))).toEqual([]);
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
