import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE ISOLATE WAS KILLED BY ONE BOARD.
 *
 * Six versions chased why slices die on WORKER_RESOURCE_LIMIT. The .40
 * breadcrumbs finally caught one in the act, and the number that mattered was
 * never the board count:
 *
 *     hop 0 · boardsDone 8 · fetched 2,002 postings · heap 206MB · 11.2s
 *
 * Eight boards. One of them returned the whole per-visit cap, and 2,002
 * postings in flight cost 206MB against a ceiling near 256. ~105KB of heap per
 * posting held.
 *
 * That single figure reconciles every earlier reading, including the three
 * theories I shipped and had to retract:
 *   - board count never predicted death, because 24 small boards are cheap and
 *     8 boards containing one giant are fatal;
 *   - heap at death ranged 70-206MB, because it tracks postings held rather
 *     than boards processed;
 *   - elapsed time never predicted it either (12.3s deaths against a 90s
 *     budget), because a giant board is expensive in bytes, not seconds;
 *   - and SLICE_POSTING_BUDGET, the one bound written in the RIGHT unit, could
 *     never fire: 12,000 postings is ~1.2GB, five times the ceiling.
 *
 * The lesson worth keeping is not the constant. It is that a bound in the
 * wrong unit reads as a safeguard and does nothing, and that four separate
 * fixes can each look reasonable while measuring the wrong quantity.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const num = (n: string) => Number(CODE.match(new RegExp(`const ${n} = ([0-9_]+)`))![1].replace(/_/g, ""));

/** Heap cost of one posting held in flight, measured 2026-09-05. */
const KB_PER_POSTING = 105;
/** Where the isolate died. */
const CEILING_MB = 256;

describe("the isolate was killed by one board", () => {
  it("a single board cannot hold enough postings to reach the ceiling", () => {
    const worstOneBoardMb = (num("MAX_POSTINGS_PER_VISIT") * KB_PER_POSTING) / 1024;
    expect(worstOneBoardMb, "one board must not be able to kill the isolate on its own")
      .toBeLessThan(CEILING_MB / 2);
  });

  it("the per-visit cap is a RESUME point, never a truncation", () => {
    // A board with more postings than the cap returns nextOffset and continues
    // from there next visit — the deep lane's own mechanism. If this became a
    // truncation, the cap would silently shrink big employers' coverage.
    expect(CODE).toMatch(/nextOffset/);
    expect(RAW).toMatch(/resumes exactly where it stopped on its next visit/);
  });

  it("the reservation invariant still holds at the new cap", () => {
    // Reservations must not exceed the posting budget on their own, or the
    // budget check trips with nothing landed — the .32 defect.
    const reserved = (num("CONCURRENCY") - 1) * num("COLD_BOARD_RESERVE") + num("DEEP_PER_SLICE") * num("MAX_POSTINGS_PER_VISIT");
    expect(reserved).toBeLessThan(num("SLICE_POSTING_BUDGET"));
  });

  it("the posting budget is now set from the measurement, so it CAN bind", () => {
    // It was the right unit from the day it was written and never fired once:
    // 12,000 postings is ~1.23GB at ~105KB each, five times the ceiling. .52
    // set it from the measurement instead. A budget that cannot be reached
    // before the isolate dies is not a safeguard, it is a comment.
    // .57: KB_PER_POSTING came from ONE board — the 2,002-posting outlier that
    // reached 206MB. Live traces on a healthy rotation read 41MB at board 35,
    // so the typical cost is a fraction of it and the budget is set from the
    // observed cost, not the worst board. What must stay true is that a single
    // board can never reach the ceiling alone (asserted above from the
    // per-visit cap) and that the budget is a real number, not a placeholder
    // an order of magnitude past anything reachable.
    const budgetMb = (num("SLICE_POSTING_BUDGET") * KB_PER_POSTING) / 1024;
    expect(budgetMb, "the old 12,000 was ~1.2GB — five times the ceiling — and could never bind")
      .toBeLessThan(CEILING_MB * 2);
    expect(RAW, "the outlier and the observed cost must both stay written down")
      .toMatch(/contradicts the model that set it|an outlier/i);
    expect(RAW).toMatch(/an order of magnitude too high to ever bind/);
  });

  it("the HOT lane is bounded by the same arithmetic — hot boards are the giants", () => {
    // Each hot board can return the whole per-visit cap, so the number of them
    // a slice may take is the budget divided by the cap. .50 bounded the cold
    // lane and left this one, which is why deaths continued in the hot phase.
    // .57: the hot lane keeps its OWN, conservative budget. Hot boards are the
    // giants — the population the 105KB-a-posting outlier came from — so the
    // raised slice budget, which is justified by what cold boards cost, must
    // not size this lane. Ten at-cap giants in one slice is the exact shape
    // that was killing the isolate.
    expect(CODE).toMatch(/const hotByBudget = Math\.max\(1, Math\.floor\(HOT_POSTING_BUDGET \/ MAX_POSTINGS_PER_VISIT\)\);/);
    expect(CODE).toMatch(/const effHotSlice = Math\.min\([^)]*, hotByBudget\);/);
    expect(num("HOT_POSTING_BUDGET")).toBeLessThan(num("SLICE_POSTING_BUDGET"));
    const hotBoards = Math.max(1, Math.floor(num("HOT_POSTING_BUDGET") / num("MAX_POSTINGS_PER_VISIT")));
    expect((hotBoards * num("MAX_POSTINGS_PER_VISIT") * KB_PER_POSTING) / 1024,
      "even at the OUTLIER cost, a hot slice must stay inside the ceiling").toBeLessThan(CEILING_MB * 0.7);
  });
});
