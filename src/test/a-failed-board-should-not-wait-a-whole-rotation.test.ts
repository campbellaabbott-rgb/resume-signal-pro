import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { retryBackoffMs, selectRetries, updateBoardFailures } from "../../supabase/functions/job-board/dormancy.ts";

/**
 * THE FRESHNESS TAIL WAS NEVER A ROTATION-SPEED PROBLEM.
 *
 * Measured live 2026-08-26, after establishing that the chain is healthy
 * (8 slices in 10 minutes, ~64 boards/min, a full cold cycle of 8.2h):
 *
 *   within one rotation (8.2h)  25,825 boards   82.5%
 *   beyond 12h                   1,641           5.2%
 *   beyond 20h                   1,244           4.0%
 *   beyond 48h                      11           0.03%
 *
 * p50 was healthy at 4.9h while p95 sat at 20.7h. A board only gets a
 * verification stamp when its fetch SUCCEEDS, so a single failed fetch cost that
 * board a FULL ROTATION before anything tried again — two or three consecutive
 * failures put it exactly in that 12-25h band. The rotation was reaching every
 * board on time; the tail was boards waiting a whole lap for a second chance.
 *
 * These are behavioural tests over the pure module, not source greps: the whole
 * point of dormancy.ts is that this logic can be executed.
 */
const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const MIN = 60_000;

describe("a failed board should not wait a whole rotation", () => {
  it("backoff is exponential and recedes to dormancy rather than hammering", () => {
    // A retry is the MOST expensive fetch when it fails again — a dead feed
    // burns the full ~20s FETCH_TIMEOUT, the exact cost dormancy exists to stop
    // paying every rotation. A flat interval would hand that cost straight back.
    expect(retryBackoffMs(1)).toBe(15 * MIN);
    expect(retryBackoffMs(2)).toBe(30 * MIN);
    expect(retryBackoffMs(3)).toBe(60 * MIN);
    expect(retryBackoffMs(4)).toBe(120 * MIN);
    expect(retryBackoffMs(5)).toBe(240 * MIN);
    // Never longer than the dormancy probe it hands over to.
    expect(retryBackoffMs(9)).toBeLessThanOrEqual(12 * 60 * MIN);
    // Monotonic: a board failing MORE must never be retried sooner.
    for (let n = 1; n < 8; n++) expect(retryBackoffMs(n + 1)).toBeGreaterThanOrEqual(retryBackoffMs(n));
  });

  it("the first retry beats a full rotation by a wide margin", () => {
    // The whole point: 15 minutes instead of 8.2 hours.
    expect(retryBackoffMs(1)).toBeLessThan(8.2 * 60 * MIN);
    expect(retryBackoffMs(1) / (8.2 * 60 * MIN)).toBeLessThan(0.04);
  });

  it("selects only boards whose backoff has actually elapsed", () => {
    const now = 10_000_000;
    const due = selectRetries({
      streaks: { fresh: 1, ripe: 1 },
      failedAt: { fresh: now - 5 * MIN, ripe: now - 20 * MIN },
      dormant: {},
      exclude: new Set(),
      now,
      cap: 10,
    });
    expect(due).toEqual(["ripe"]);        // 20min > 15min backoff
    expect(due).not.toContain("fresh");   // 5min < 15min backoff
  });

  it("respects the streak when deciding what is due", () => {
    const now = 10_000_000;
    // Both failed 40 minutes ago, but the second has failed four times.
    const due = selectRetries({
      streaks: { once: 1, often: 4 },
      failedAt: { once: now - 40 * MIN, often: now - 40 * MIN },
      dormant: {},
      exclude: new Set(),
      now,
      cap: 10,
    });
    expect(due).toEqual(["once"]);        // 40min > 15min
    expect(due).not.toContain("often");   // 40min < 120min
  });

  it("never re-admits a dormant board — dormancy owns its own cadence", () => {
    const now = 10_000_000;
    const due = selectRetries({
      streaks: { dead: 3 },
      failedAt: { dead: now - 10 * 60 * MIN },
      dormant: { dead: now - 10 * 60 * MIN },
      exclude: new Set(),
      now,
      cap: 10,
    });
    expect(due, "a dormant board was pulled into the 15-minute lane").toEqual([]);
  });

  it("never spends a retry place on a board already in the slice", () => {
    const now = 10_000_000;
    const due = selectRetries({
      streaks: { already: 1, other: 1 },
      failedAt: { already: now - 60 * MIN, other: now - 60 * MIN },
      dormant: {},
      exclude: new Set(["already"]),
      now,
      cap: 10,
    });
    expect(due).toEqual(["other"]);
  });

  it("drains most-overdue first, so a backlog cannot starve its oldest", () => {
    const now = 10_000_000;
    const due = selectRetries({
      streaks: { a: 1, b: 1, c: 1 },
      failedAt: { a: now - 20 * MIN, b: now - 300 * MIN, c: now - 60 * MIN },
      dormant: {},
      exclude: new Set(),
      now,
      cap: 2,
    });
    expect(due).toEqual(["b", "c"]);
  });

  it("a board that answers stops being retried", () => {
    const now = 10_000_000;
    const out = updateBoardFailures({
      okTokens: ["recovered"],
      failedTokens: [],
      recheckTokens: new Set(),
      streaks: { recovered: 3 },
      dormant: {},
      failedAt: { recovered: now - 60 * MIN },
      deadThreshold: 6,
      minFailureAgeMs: 0,
      dormantCap: 500,
      now,
    });
    expect(out.failedAt.recovered, "a healthy board stayed in the retry lane").toBeUndefined();
    expect(out.streaks.recovered).toBeUndefined();
  });

  it("a failure stamps the board, and reaching dormancy hands it over", () => {
    const now = 10_000_000;
    const one = updateBoardFailures({
      okTokens: [], failedTokens: ["flaky"], recheckTokens: new Set(),
      streaks: {}, dormant: {}, failedAt: {}, deadThreshold: 6, minFailureAgeMs: 0, dormantCap: 500, now,
    });
    expect(one.failedAt.flaky).toBe(now);
    expect(one.streaks.flaky).toBe(1);

    // At the threshold the board goes dormant and LEAVES the retry lane, or it
    // would be probed on two cadences at once.
    const dead = updateBoardFailures({
      okTokens: [], failedTokens: ["gone"], recheckTokens: new Set(),
      streaks: { gone: 5 }, dormant: {}, failedAt: { gone: now - 5 * MIN },
      firstFailedAt: { gone: now - 50 * 60 * MIN },
      deadThreshold: 6, minFailureAgeMs: 40 * 60 * MIN, dormantCap: 500, now,
    });
    expect(dead.toPrune).toContain("gone");
    expect(dead.dormant.gone).toBe(now);
    expect(dead.failedAt.gone, "a dormant board is still in the retry lane").toBeUndefined();
  });

  it("the stamp map is bounded, so a mass vendor outage cannot bloat the meta row", () => {
    const now = 10_000_000;
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`b${i}`, now - i * MIN]));
    const out = updateBoardFailures({
      okTokens: [], failedTokens: [], recheckTokens: new Set(),
      streaks: {}, dormant: {}, failedAt: many, deadThreshold: 6, minFailureAgeMs: 0, dormantCap: 10, now,
    });
    expect(Object.keys(out.failedAt).length).toBeLessThanOrEqual(10);
    // Newest kept — an old stamp is the least useful.
    expect(out.failedAt.b0).toBeDefined();
  });

  it("the lane is capped, gated to cold slices, and cannot break the rotation", () => {
    expect(CODE).toMatch(/const RETRY_PER_SLICE = \d+;/);
    const cap = Number(/const RETRY_PER_SLICE = (\d+);/.exec(CODE)?.[1]);
    // A retry that fails again costs a full FETCH_TIMEOUT. This is the lesson
    // from DEEP_PER_SLICE, which cost the rotation 4x at 25.
    expect(cap).toBeGreaterThan(0);
    expect(cap, "a retry lane larger than the deep lane will cost rotation speed").toBeLessThanOrEqual(8);
    const lane = CODE.slice(CODE.indexOf("let retryBoards"), CODE.indexOf("const slice = [...demandBoards"));
    expect(lane).toMatch(/if \(!inHotPhase\)/);
    expect(lane).toMatch(/\} catch \{/);
    expect(CODE).toMatch(/const slice = \[\.\.\.demandBoards, \.\.\.bootstrapBoards, \.\.\.deepBoards, \.\.\.retryBoards, \.\.\.baseSlice\]/);
  });

  it("the failure state is read BEFORE the slice is sealed", () => {
    const read = CODE.indexOf('eq("k", "board_failures")');
    const sealed = CODE.indexOf("const slice = [...demandBoards");
    expect(read).toBeGreaterThan(-1);
    expect(read, "the retry lane has no work list because the state is read too late").toBeLessThan(sealed);
  });

  it("the lane reports whether it ran", () => {
    expect(CODE).toMatch(/retryLane = \{/);
    expect(CODE).toMatch(/candidates: Object\.keys\(boardFailures\.failedAt \?\? \{\}\)\.length/);
    expect(CODE).toMatch(/retryLane: \(\(\) => \{/);
  });

  it("SIX FAST FAILURES DO NOT PRUNE — the bar is a duration, not an attempt count", () => {
    // THE BUG AN ADVERSARIAL REVIEW CAUGHT BEFORE THIS SHIPPED.
    //
    // DEAD_BOARD_THRESHOLD (6) was calibrated when attempts arrived once per
    // rotation, so it MEANT "dead for ~41 hours". The retry lane fits six
    // attempts into 7h45m, which would have cut that guard to under eight hours
    // — and a Workday CDN throttle of the kind already recorded in this
    // codebase (boards fine from outside, blocked only for our egress IPs)
    // would have deleted boards that were never dead: an exit row per posting,
    // every row for the token gone, a 12h blackout, first_seen reset on
    // re-ingest.
    const now = 10_000_000_000;
    const FORTY_H = 40 * 60 * MIN;
    const out = updateBoardFailures({
      okTokens: [], failedTokens: ["throttled"], recheckTokens: new Set(),
      streaks: { throttled: 5 },                       // this failure makes six
      dormant: {},
      failedAt: { throttled: now - 15 * MIN },
      firstFailedAt: { throttled: now - 8 * 60 * MIN }, // failing for 8h, not 41
      deadThreshold: 6, minFailureAgeMs: FORTY_H, dormantCap: 500, now,
    });
    expect(out.toPrune, "an 8-hour vendor blip pruned a live board").toEqual([]);
    expect(out.dormant.throttled, "the board was put dormant on an 8-hour blip").toBeUndefined();
    // It keeps failing and stays eligible — nothing is lost, only the deletion
    // is withheld until the duration bar is actually met.
    expect(out.streaks.throttled).toBe(6);
    expect(out.firstFailedAt.throttled).toBe(now - 8 * 60 * MIN);
  });

  it("a genuinely dead board still prunes once BOTH bars are met", () => {
    const now = 10_000_000_000;
    const out = updateBoardFailures({
      okTokens: [], failedTokens: ["dead"], recheckTokens: new Set(),
      streaks: { dead: 5 },
      dormant: {},
      failedAt: { dead: now - 4 * 60 * MIN },
      firstFailedAt: { dead: now - 45 * 60 * MIN },   // failing 45h
      deadThreshold: 6, minFailureAgeMs: 40 * 60 * MIN, dormantCap: 500, now,
    });
    expect(out.toPrune, "a board dead for 45 hours was not pruned").toContain("dead");
    expect(out.dormant.dead).toBe(now);
    expect(out.firstFailedAt.dead, "a pruned board kept its streak clock").toBeUndefined();
  });

  it("time alone does not prune either — both conditions are required", () => {
    const now = 10_000_000_000;
    const out = updateBoardFailures({
      okTokens: [], failedTokens: ["flaky"], recheckTokens: new Set(),
      streaks: { flaky: 1 },                            // only its second failure
      dormant: {},
      failedAt: { flaky: now - 30 * 60 * MIN },
      firstFailedAt: { flaky: now - 60 * 60 * MIN },    // but failing 60h
      deadThreshold: 6, minFailureAgeMs: 40 * 60 * MIN, dormantCap: 500, now,
    });
    // A board that fails once every 30h is flaky, not dead. The streak bar is
    // what says "consecutively", and it still has to be cleared.
    expect(out.toPrune).toEqual([]);
  });

  it("recovery clears the streak clock, so an old blip cannot be counted twice", () => {
    const now = 10_000_000_000;
    const out = updateBoardFailures({
      okTokens: ["recovered"], failedTokens: [], recheckTokens: new Set(),
      streaks: { recovered: 4 },
      dormant: {},
      failedAt: { recovered: now - 60 * MIN },
      firstFailedAt: { recovered: now - 39 * 60 * MIN },
      deadThreshold: 6, minFailureAgeMs: 40 * 60 * MIN, dormantCap: 500, now,
    });
    // Without this, a board that failed 39h ago, recovered, and failed again
    // tomorrow would inherit yesterday's clock and prune on its first stumble.
    expect(out.firstFailedAt.recovered).toBeUndefined();
  });

  it("state written before the clock existed starts it NOW, never retroactively", () => {
    // Conservative direction on purpose: legacy rows delay a prune by up to the
    // floor and can never accelerate one.
    const now = 10_000_000_000;
    const out = updateBoardFailures({
      okTokens: [], failedTokens: ["legacy"], recheckTokens: new Set(),
      streaks: { legacy: 5 },                  // already at the old bar
      dormant: {},
      failedAt: { legacy: now - 60 * MIN },
      firstFailedAt: {},                        // no clock — pre-upgrade state
      deadThreshold: 6, minFailureAgeMs: 40 * 60 * MIN, dormantCap: 500, now,
    });
    expect(out.firstFailedAt.legacy).toBe(now);
    expect(out.toPrune, "a legacy board was pruned the moment the clock appeared").toEqual([]);
  });

  it("the wall-clock floor is wired through from index.ts, not just available", () => {
    expect(CODE).toMatch(/const DEAD_BOARD_MIN_FAILING_MS = \d+ \* 60 \* 60_000;/);
    expect(CODE).toMatch(/minFailureAgeMs: DEAD_BOARD_MIN_FAILING_MS/);
    const hours = Number(/const DEAD_BOARD_MIN_FAILING_MS = (\d+) \* 60 \* 60_000;/.exec(CODE)?.[1]);
    // The bar it replaces was ~41h (6 rotations x 8.2h). Anything materially
    // shorter re-creates the defect this exists to prevent.
    expect(hours).toBeGreaterThanOrEqual(24);
  });
});
