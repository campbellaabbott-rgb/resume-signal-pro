import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The heartbeat could report healthy while going blind.
 *
 * Three shapes, one theme — a check that could not RUN was indistinguishable
 * from a check that PASSED:
 *
 * 1. job_board_freshness read the cold_rotation row and derived rotAgeMin from
 *    it. A missing row or a failed read left that null, so `rotStale` was false
 *    and the check reported passed — on exactly the two states it exists to
 *    catch.
 *
 * 2. rpcWithin resolves `{ data: null }` for a timeout, a rejection AND a
 *    genuinely empty result. Every consumer guarded with `if (row)`, so a
 *    deadline miss made the check VANISH from the payload — no entry in checks,
 *    no entry in skipped. The surrounding try/catch could not help: rpcWithin
 *    never throws, by construction.
 *
 * This is the same defect class as the alert thresholds reading a 0% success
 * rate as 100%, and as the search tier returning [] on a deadline. It matters
 * most here, because this endpoint IS the monitoring.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");

describe("a monitor that cannot fail is not a monitor", () => {
  it("reports an unreadable rotation as unknown, not as fresh", () => {
    expect(FN).toMatch(/const rotUnknown = !!rotErr \|\| rot === null;/);
    expect(FN).toMatch(/passed: !rotStale && !rotUnknown,/);
    expect(FN).toMatch(/freshness cannot be evaluated/);
    // The old form silently passed on a null read.
    expect(FN, "passing on an unknown state is the bug").not.toMatch(/passed: !rotStale,\s*\n/);
  });

  it("distinguishes a deadline miss from an empty answer", () => {
    expect(FN).toMatch(/timedOut\?: boolean; failed\?: boolean/);
    expect(FN).toMatch(/res\(\{ data: null, timedOut: true \}\)/);
    expect(FN).toMatch(/function unanswered\(/);
  });

  it("records a skip for every deadline-wrapped check instead of dropping it", () => {
    // One skip per rpcWithin consumer. An under-count is a check that can still
    // vanish; an over-count is a consumer nobody has looked at.
    const wrapped = (FN.match(/= rpcWithin\(/g) ?? []).length;
    const reported = (FN.match(/const \w+Why = unanswered\(/g) ?? []).length;
    expect(wrapped, "no rpcWithin consumers found").toBeGreaterThanOrEqual(4);
    // dbSizeP reads its own error directly and is handled separately.
    expect(reported, `${wrapped} deadline-wrapped checks but only ${reported} report why they were skipped`)
      .toBeGreaterThanOrEqual(wrapped - 1);
    for (const name of ["job_board_storage", "job_board_stale_boards", "job_board_date_coverage"]) {
      expect(FN, `${name} must record a skip when its RPC does not answer`)
        .toMatch(new RegExp(`skip\\('${name}', \\w+Why\\)`));
    }
  });
});
