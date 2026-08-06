/**
 * The freshness instrument was timing out, and reporting that as absence.
 *
 * MEASURED 2026-08-03. `get_date_coverage()` takes ~3.5s over 562k rows. The
 * status endpoint called it with a 2_500ms deadline, and withDeadline returns
 * `{ data: null }` for a timeout, for a rejection, and there is no separate
 * signal for an empty result. So `dateCoverage` was null on every single call —
 * one value standing for three states, and the state that was actually
 * happening was the one nobody could see.
 *
 * That field is the measured basis behind every posting-age claim on the
 * platform. It was silently unavailable, and the only reason it surfaced at all
 * was calling the RPC directly and timing it.
 *
 * WHY THIS MATTERED MORE THAN THE TIMEOUT. The numbers it was hiding contradict
 * the freshness backlog. Undated rows, ranked:
 *
 *     workday    52,891  (18% of its rows)   <- backlog item
 *     bamboohr   33,340  (77% of its rows)   <- NOT in the backlog
 *     rippling    6,708  (76% of its rows)   <- NOT in the backlog
 *     pinpoint    4,900  (100%)              <- backlog item, listed as 3,996
 *
 * BambooHR is 6.8x Pinpoint and was not on the list. The backlog was written
 * against numbers nobody could refresh, because refreshing them is exactly what
 * this instrument stopped doing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const board = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/**
 * UPDATE 2026-08-06. The 8s deadline this guard used to require was the right
 * answer to the wrong problem, and it expired.
 *
 * Raising the deadline to clear a 3.5s aggregate bought a working stat and an
 * 8-SECOND FLOOR on every status request. By 2026-08-06 the same aggregate had
 * outgrown its own 20s STATEMENT timeout — measured, 500 "57014 canceling
 * statement due to statement timeout" — so the deadline bought nothing at all
 * while still costing the floor. Status ran 8.5-26s, which put it astride the
 * heartbeat's 15s deploy abort and made job_board_deploy flap "board
 * unreachable" at a board that was serving audits the same minute.
 *
 * The fix is not a bigger deadline. Both stats are precomputed into
 * job_board_stats_rollup every 15 minutes, so the RPC is now a single-row read
 * and the deadline goes back to being a guard rather than a budget.
 *
 * The rule this file exists to enforce is unchanged — A DEADLINE MUST EXCEED
 * WHAT THE QUERY COSTS — so the two are now checked TOGETHER. A short deadline
 * is legitimate only while the query is cheap, and reverting the rollup without
 * restoring the deadline fails here rather than in production.
 */
describe("the date-coverage deadline exceeds the query's measured cost", () => {
  it("a sub-3.5s deadline is allowed only because the RPC is a rollup read", () => {
    const m = board.match(/withDeadline\(client\.rpc\("get_date_coverage"\), ([0-9_]+)\)/);
    expect(m, "the get_date_coverage call is gone or reshaped").not.toBeNull();
    const ms = Number(m![1].replace(/_/g, ""));
    if (ms > 3500) return; // the old regime: deadline clears the live aggregate

    const mig = readFileSync(
      resolve(__dirname, "../../supabase/migrations/20260806120000_precompute_the_stats_that_outgrew_their_timeouts.sql"),
      "utf8",
    );
    expect(mig, `deadline is ${ms}ms, which only clears a precomputed read — but get_date_coverage no longer reads the rollup`)
      .toMatch(/WHERE r\.k = 'date_coverage'/);
    expect(mig, "nothing refreshes the rollup, so a short deadline would serve a frozen stat")
      .toMatch(/cron\.schedule\(\s*'job-board-stats-rollup'/);
  });
});

describe("an unavailable measurement says so", () => {
  it("reports whether the numbers are from the rollup, cached, or missing", () => {
    // Three states that used to share one value. The first was called "live"
    // while the RPC computed on demand; it now reads a 15-minute rollup, and
    // calling that "live" would be the same false-freshness move this block was
    // written to stop.
    expect(board).toMatch(/dateCoverageSource:/);
    expect(board).toMatch(/"rollup"/);
    expect(board).toMatch(/"cache"/);
    expect(board).toMatch(/"unavailable"/);
  });

  it("puts an age on the numbers, including the non-cached path", () => {
    // A number with no age beside it cannot be told from a fresh one — and a
    // hardcoded 0 is worse than no age, because it asserts freshness that the
    // 15-minute refresh cannot deliver.
    expect(board).toMatch(/dateCoverageAgeMin:/);
    expect(board).toMatch(/ageMin\(\(\(\(dateCov as \{ data: Array<\{ computed_at\?: string \}> \}\)\.data\)\[0\]\?\.computed_at\) \?\? null\)/);
  });

  it("serves the last good copy instead of nothing", () => {
    expect(board).toMatch(/dcCache\.data\?\.v as unknown\[\]/);
  });

  it("fills its own cache from reads that already succeed", () => {
    // No cron to schedule and nothing extra to keep alive: the first live read
    // after a deploy populates it.
    expect(board).toMatch(/k: "date_coverage_cache"/);
  });

  it("never fails the status page over its own cache write", () => {
    expect(board).toMatch(/\.then\(\(\) => \{\}, \(\) => \{\}\)/);
  });
});

/**
 * A HARDCODED MEASUREMENT IS A MEASUREMENT THAT CANNOT MOVE.
 *
 * Three code comments asserted the auto-submittable share of the board: "about
 * 2%" twice and "~3.4%" once. All were written when three adapters existed.
 * There are four, and the live figure on 2026-08-03 is 5.3% — 30,090 of
 * 564,153 postings. Nobody lied; the number simply had no way to update.
 *
 * It is a decision input, not decoration: those comments are what an engineer
 * reads when judging whether the sendable-candidates query earns its cost, and
 * a 2.6x understatement argues for deleting something that is pulling its
 * weight. So the share is computed from the same live per-vendor totals the
 * status endpoint already has.
 *
 * THE CEILING ITSELF IS NOT AN ADAPTER GAP. worker/RECON.md carries a measured
 * refusal for every other major vendor — BambooHR reCAPTCHA v2 visible on 24/24
 * pages, Ashby v3, Lever/Rippling/Workable bot detection, SmartRecruiters 403
 * headless AND headed, Oracle re-checked. Raising 5.3% means defeating bot
 * protection. That is a line, not a backlog item.
 */
describe("the auto-submittable share is computed, not asserted", () => {
  it("status derives it from live per-vendor totals", () => {
    expect(board).toMatch(/sendable: \(\(\) => \{/);
    expect(board).toMatch(/SENDABLE_VENDORS/);
    // Falls back to the cache, so it does not vanish when the query is slow —
    // the same failure the deadline fix above was written for.
    expect(board).toMatch(/dcCache\.data\?\.v as Array/);
  });

  it("no source file still asserts a hardcoded board share", () => {
    const FILES = [
      "supabase/functions/agent-runner/index.ts",
      "src/components/account/MorningQueuePanel.tsx",
    ];
    for (const rel of FILES) {
      const src = readFileSync(resolve(__dirname, "../..", rel), "utf8");
      // The stale forms, specifically. A comment may cite the measured 5.3%
      // with its date; what it may not do is restate the old numbers.
      expect(src, `${rel} still claims "about 2% of the board"`).not.toMatch(/about 2% of the board/);
      expect(src, `${rel} still claims "~3.4% of the board"`).not.toMatch(/~3\.4% of the board/);
    }
  });
});
