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

describe("the date-coverage deadline exceeds the query's measured cost", () => {
  it("is not back below the measured 3.5s", () => {
    const m = board.match(/withDeadline\(client\.rpc\("get_date_coverage"\), ([0-9_]+)\)/);
    expect(m, "the get_date_coverage call is gone or reshaped").not.toBeNull();
    const ms = Number(m![1].replace(/_/g, ""));
    expect(ms, `deadline ${ms}ms is below the measured ~3500ms cost — it will time out on every call`)
      .toBeGreaterThan(3500);
  });
});

describe("an unavailable measurement says so", () => {
  it("reports whether the numbers are live, cached, or missing", () => {
    // Three states that used to share one value.
    expect(board).toMatch(/dateCoverageSource:/);
    expect(board).toMatch(/"live"/);
    expect(board).toMatch(/"cache"/);
    expect(board).toMatch(/"unavailable"/);
  });

  it("puts an age on cached numbers", () => {
    // A number with no age beside it cannot be told from a fresh one.
    expect(board).toMatch(/dateCoverageAgeMin:/);
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
