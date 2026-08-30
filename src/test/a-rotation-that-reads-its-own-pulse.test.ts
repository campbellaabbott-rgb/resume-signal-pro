import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE INGEST AND THE READERS SHARE ONE DATABASE.
 *
 * MEASURED 2026-08-30: a bare {limit:1} browse — the cheapest query the board
 * has — took 30.2s (page_query 29,455ms) while sliceStats read lastMs 184,951
 * and hotEma 176,371 against a healthy ~20-25s. Both numbers are one event, and
 * the rotation kept demanding its full slice the whole way down.
 *
 * Two independent defences, because they fail differently: the rotation now
 * reads its own EMA and stands down (this file), and the table is no longer
 * left on default autovacuum while taking mass UPDATE waves (the migration).
 */
const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const ROTATION = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/rotation.ts"), "utf8");
const VAC = readFileSync(resolve(__dirname, "../../supabase/migrations/20260830200000_the_hot_table_was_left_on_default_autovacuum.sql"), "utf8");

describe("the rotation reads its own pulse and stands down", () => {
  it("derives the shed level from the EMA it already records", () => {
    expect(BOARD).toMatch(/const shedLevel = shedEma === 0 \? 0 : shedEma > 60_000 \? 2 : shedEma > 40_000 \? 1 : 0;/);
    expect(BOARD, "the phase-appropriate EMA, not a blend").toMatch(/inHotPhase \? v\.hotEmaMs : v\.coldEmaMs/);
  });

  it("no measurement is not evidence of distress — it runs at full size", () => {
    expect(BOARD).toMatch(/return 0; \/\/ no measurement is not evidence of distress/);
    expect(BOARD, "level 0 must resolve to the unshed constants")
      .toMatch(/const effColdSlice = shedLevel === 2 \? 24 : shedLevel === 1 \? 48 : COLD_SLICE;/);
  });

  it("sheds all three costs: slice size, workers, and the deep lane first", () => {
    expect(BOARD).toMatch(/COLD_LIST\.slice\(cold, cold \+ effColdSlice\)/);
    expect(BOARD).toMatch(/inHotPhase \? HOT_CONCURRENCY : effConcurrency/);
    expect(BOARD).toMatch(/\.slice\(0, effDeepPerSlice\)/);
    expect(BOARD, "the deep lane is the first thing to go at L2")
      .toMatch(/const effDeepPerSlice = shedLevel === 2 \? 0 :/);
  });

  it("is safe for the cursor BY THE ARITHMETIC'S OWN CONTRACT, not by assumption", () => {
    // rotation.ts advances by the boards actually consumed and its docs forbid
    // substituting the constant — a variable slice is the case it was written
    // for. If that ever changes, adaptive shedding must be re-examined.
    expect(ROTATION).toMatch(/baseSliceLen` MUST be the number of COLD_LIST boards this hop consumed/);
    expect(BOARD, "the hop must pass the REAL slice length, never the constant")
      .not.toMatch(/baseSliceLen: COLD_SLICE/);
  });

  it("says out loud when it is running small", () => {
    expect(BOARD).toMatch(/load shedding L\$\{shedLevel\}/);
    expect(BOARD, "a deliberately small rotation must not read as a mysteriously slow one")
      .toMatch(/\[shedding L\$\{shedLevel\}\]/);
  });
});

describe("the hot table is no longer on default autovacuum", () => {
  it("tunes the thresholds that left six figures of dead tuples between passes", () => {
    expect(VAC).toMatch(/autovacuum_vacuum_scale_factor = 0\.02/);
    expect(VAC).toMatch(/autovacuum_vacuum_cost_limit = 2000/);
    expect(VAC).toMatch(/autovacuum_analyze_scale_factor = 0\.01/);
  });

  it("schedules NOTHING — scheduled VACUUMs were the previous cure that became the disease", () => {
    expect(VAC, "20260827181000 removed two runaway vacuum crons; this must not add a third")
      .not.toMatch(/cron\.schedule/);
    expect(VAC).not.toMatch(/^\s*VACUUM/m);
  });

  it("verifies itself rather than silently no-opping", () => {
    expect(VAC).toMatch(/RAISE EXCEPTION 'autovacuum tuning did not apply/);
  });
});
