// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";

/**
 * A DEPLOY-WINDOW GUARD OUTLIVED ITS WINDOW.
 *
 * Sweep S8-089 (2026-10-08). .77 made cappedCount stand down from
 * count_jobs_capped for every stated-pay count under the cap, because the
 * bundle and migration 20260927034117 moved the stated-pay predicate down two
 * pipes and could disagree for one release (n310). Its own note says to
 * delete it once the migration is live. It is: probed 2026-10-08 on .90,
 * `{q:"assistant", country:"IE", hasStatedPay:true}` answered ranked with 7
 * of 50 rows printing a rate with no annual figure, which only the migrated
 * search_jobs serves (verify 5y(b)); wave 2's 20261008100200 carries the same
 * predicate. Every stated-pay count still went to the uncapped exact path
 * (3-9 s on broad filters, past the statement timeout near 150k matches).
 * The category-rail half of the register item was already gone: .91 withholds
 * a text query's chips (3827e271, n433).
 *
 * This runs the SHIPPED cappedCount closure (lifted from index.ts) against a
 * stub count_jobs_capped answering 1,234 uncapped.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const span = (() => {
  const a = FN.indexOf("  const cappedCount = async (): Promise<{ n: number; capped: boolean } | null> => {");
  const b = FN.indexOf("  // Rationale: docs/job-board-index-notes.md#n311-qt", a);
  expect(a, "cappedCount moved; re-point this test").toBeGreaterThan(-1);
  return FN.slice(a, b);
})();
const run = (applied: Record<string, unknown>, rpc: { n: number; capped: boolean }) => {
  const calls: string[] = [];
  const scope: Record<string, unknown> = {
    applied: { country: null, location: null, remote: false, experience: [], salaryFloor: null, companies: [], postedAfter: null, maxAgeDays: null, workMode: null, employmentType: null, excludeAgencies: false, ...applied },
    rpcBlindFilters: () => [],
    queryTerms: () => ({ terms: [], dropped: [], liftedSalary: false }),
    body: {},
    client: { rpc: async (name: string) => { calls.push(name); return { data: [rpc], error: null }; } },
    freshCutoffIso: "2026-09-08T00:00:00Z",
    rankedLocationParam: () => null,
    categoryParam: () => null,
    sendableSourcesParam: () => ({}),
    payParams: () => ({}),
    extraFilterParams: () => ({}),
    COUNT_CAP: 10_000,
    markFrom: () => {},
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, `${transformSync(span, { loader: "ts" }).code}\nreturn cappedCount;`)(...names.map((n) => scope[n]));
  return fn().then((r: unknown) => ({ r, calls }));
};

describe("a stated-pay count is the capped count, like every other count", () => {
  it("an uncapped stated-pay count comes from count_jobs_capped, not the exact fallback", async () => {
    const { r, calls } = await run({ hasStatedPay: true }, { n: 1234, capped: false });
    expect(calls).toEqual(["count_jobs_capped"]);
    expect(r, "the stand-down sent this count to the uncapped exact path").toEqual({ n: 1234, capped: false });
  });

  it("a count with no pay control is unchanged", async () => {
    expect((await run({}, { n: 77, capped: false })).r).toEqual({ n: 77, capped: false });
  });
});
