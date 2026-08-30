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
    expect(BOARD).toMatch(/: shedSignal\.ms > 60_000 \? 2/);
    expect(BOARD).toMatch(/: shedSignal\.ms > 40_000 \? 1/);
    expect(BOARD, "the phase-appropriate EMA, not a blend").toMatch(/inHotPhase \? v\.hotEmaMs : v\.coldEmaMs/);
  });

  it("an unreadable pulse FAILS CLOSED — the exact opposite of the first version", () => {
    // The original rule here was "no measurement is not evidence of distress —
    // run at full size". Production falsified it within hours: on the most
    // distressed database the slice-stats read itself fails, so shedding
    // switched OFF at peak load and browse latency ROSE 27s->42s->66s with the
    // shedder nominally deployed. An unreadable signal now sheds to L2, a
    // genuinely absent row (fresh deploy) to L1, and only a real healthy EMA
    // runs full size.
    expect(BOARD).toMatch(/shedSignal\.kind === "unreadable" \? 2/);
    expect(BOARD).toMatch(/: shedSignal\.kind === "absent" \? 1/);
    expect(BOARD, "the shed read itself must be bounded — waiting on it is the distress it detects")
      .toMatch(/setTimeout\(\(\) => res\(SHED_READ_TIMEOUT\), 500\)/);
    expect(BOARD, "level 0 must resolve to the unshed constants")
      .toMatch(/const effColdSlice = shedLevel === 2 \? 24 : shedLevel === 1 \? 48 : COLD_SLICE;/);
    const stripped = BOARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "the fail-open form must not return").not.toMatch(/return 0; \/\/ no measurement/);
  });

  it("the emergency pause exists, is honoured by force, and its resume is HELD", () => {
    const PAUSE = readFileSync(resolve(__dirname, "../../supabase/migrations/20260830230000_stop_the_ingest_until_the_database_can_breathe.sql"), "utf8");
    expect(PAUSE).toMatch(/'paused', true/);
    expect(PAUSE).toMatch(/RAISE EXCEPTION 'ingest_paused flag did not persist'/);
    // force must NOT override the pause — the code's own words.
    expect(BOARD).toMatch(/`force` does NOT override this/);
    // ARMED 2026-08-30 after six stability ticks (browse 0.4-1.1s, search
    // trending 8.7s -> 0.7s) — the held form served its purpose and the resume
    // is now an ordinary migration. The restart is guarded by the fail-closed
    // shedder above.
    const { existsSync } = require("node:fs");
    expect(existsSync(resolve(__dirname, "../../supabase/migrations/20260830240000_resume_ingest_when_healthy.sql")),
      "the armed resume migration must exist").toBe(true);
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

  it("sheds the ACCELERATOR lanes too, or shedding inverts the slice", () => {
    // Cutting only baseSlice left 24 rotation boards beside a 25-board
    // bootstrap and a 5-board retry lane — the lanes consuming no cursor became
    // the majority of the hop while the freshness-bearing part took the cut.
    expect(BOARD).toMatch(/const effBootstrapPerSlice = shedLevel === 2 \? 0 : shedLevel === 1 \? 10 : BOOTSTRAP_PER_SLICE;/);
    expect(BOARD).toMatch(/const effRetryPerSlice = shedLevel === 2 \? 0 : shedLevel === 1 \? 2 : RETRY_PER_SLICE;/);
  });

  it("the bootstrap DRAIN moves with the SELECT, or boards are discarded unfetched", () => {
    // The queue drain and the fetch selection must use the same number. If the
    // drain kept the constant while the selection shed, every shed hop would
    // discard boards from the queue that were never fetched — the "drained
    // without being filled" failure that block already documents.
    expect(BOARD).toMatch(/\.slice\(0, effBootstrapPerSlice\)/);
    expect(BOARD).toMatch(/queue: queue\.slice\(effBootstrapPerSlice\),/);
    expect(BOARD).toMatch(/drained: Math\.min\(effBootstrapPerSlice, queue\.length\),/);
    const stripped = BOARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped, "no drain site may still use the raw constant")
      .not.toMatch(/queue\.slice\(BOOTSTRAP_PER_SLICE\)/);
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

describe("a decoration must never hold the page", () => {
  it("the recheckedAt stamp is bounded by a deadline", () => {
    // MEASURED 2026-08-30: phaseMs.attachRecheckedAt = 15,104ms of a 30,728ms
    // response — a PK probe for ONE token, while the rows took 2s. The rows are
    // the product; a late caption is simply an absent caption.
    expect(BOARD).toMatch(/await withDeadline\(\s*\n\s*client\.from\("job_board_verifications"\)/);
    expect(BOARD).toMatch(/1_500,\s*\n\s*\) as \{ data: unknown\[\] \| null; error\?: unknown \}/);
  });

  it("the churn tables the first migration missed are tuned", () => {
    const VAC2 = readFileSync(resolve(__dirname, "../../supabase/migrations/20260830210000_the_small_hot_tables_were_missed.sql"), "utf8");
    expect(VAC2).toMatch(/'job_board_verifications'/);
    expect(VAC2, "a small table needs a small THRESHOLD, not a 20% scale factor")
      .toMatch(/autovacuum_vacuum_threshold = 200/);
    expect(VAC2, "verified_at is unindexed, so HOT updates are available with page room")
      .toMatch(/fillfactor = 70/);
    expect(VAC2, "must skip tables that do not exist rather than aborting the migration")
      .toMatch(/IF EXISTS \(SELECT 1 FROM pg_class/);
    expect(VAC2).not.toMatch(/cron\.schedule/);
  });
});
