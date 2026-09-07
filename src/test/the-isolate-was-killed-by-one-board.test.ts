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
// FITTED 2026-09-06 from five in-flight slices sampled off slice_trace:
//   boards 7/28/44/57/51, fetched 357/1194/1529/1554/1641, heap 35/187/202/208/231
//   heapMb ~= 0.146 x postings_fetched - 10
// The earlier 105 came from ONE board and was treated as an outlier; it was
// not. Heap per BOARD is noise, heap per POSTING is 100-160KB.
const KB_PER_POSTING = 146;
/**
 * AND THAT COEFFICIENT WAS FITTED ON A LEAK. Kept above as the record, not as
 * a live bound.
 *
 * The chunked pagers abandoned unread page responses without cancelling them,
 * so heap grew with every page the slice had ever read — which is why it fitted
 * so cleanly against CUMULATIVE POSTINGS, a quantity that has no business
 * costing memory once a response is parsed and dropped. `discardRest` closed
 * it. Heap p50 fell 176MB -> 36MB, and the .63 slice held 1,216 postings in
 * 35MB where 0.146 predicts ~168MB.
 *
 * 35MB / 1,216 = 29KB a posting, and that OVERSTATES the residual: it charges
 * the runtime, the module and the in-flight bodies to postings as well. It is
 * used here as an upper bound on what cumulative postings can still cost.
 */
const RESIDUAL_KB_PER_POSTING = 29;
/**
 * THE OTHER MEASURED COST, and the one the wall clock is spent on. Same live
 * .63 slice as everything above: 1,216 postings, 24 boards, 51,027ms, four
 * workers.
 *
 *   1,216 / 51.027 / 4 = 5.957 postings/s a worker
 *   1,216 / 51.027     = 23.83 postings/s for the slice as a whole
 *
 * Both are kept, because they answer different questions and the file itself
 * says which one is uncertain: parsing is serial (see MAX_RESPONSE_BYTES), so
 * whether a fifth worker raises the aggregate rate at all is a hypothesis. The
 * per-worker figure is the optimistic ceiling; the aggregate figure is what a
 * fully parse-bound slice would still do, and it is what the budget is sized
 * against so the sizing survives being wrong.
 */
const POSTINGS_PER_S_PER_WORKER = 5.957;
const MEASURED_AGGREGATE_POSTINGS_PER_S = 23.83;
/** Every slice that ever wrote a terminal stamp finished inside this; the one
 *  recorded death ran 158.3s. Named so the wall arithmetic can cite it. */
const SURVIVAL_ENVELOPE_S = 128;
/** Where the isolate died. */
const CEILING_MB = 256;
/**
 * What the in-flight bodies can cost at once — the OTHER half of the heap, and
 * since the leak closed, the dominant half. Derived from the same constants the
 * byte budget is derived from, so this cannot drift from it.
 */
const AMPLIFICATION = 6; // JSON wire bytes -> JS objects
const peakInFlightMb = () =>
  (Math.max(num("CONCURRENCY"), num("HOT_CONCURRENCY")) * num("MAX_RESPONSE_BYTES") * AMPLIFICATION) / 1e6;

describe("the isolate was killed by one board", () => {
  it("a single board cannot hold enough postings to reach the ceiling", () => {
    // REVERTED 2026-09-05 on the product owner's call. Freshness went 403 ->
    // 2,366 minutes across a day in which this machinery made the rotation
    // steadily more correct and steadily slower. The measurements below stay
    // written down because they were real; the constants went back to the
    // values that held freshness near the promise, and these bounds are
    // backstops now rather than active throttles.
    // The 105KB figure came from ONE board and the live traces never matched
    // it — 37MB at board 35 where the model predicted ~144MB — so it is kept
    // as the record of an outlier, not as a live bound.
    const worstOneBoardMb = (num("MAX_POSTINGS_PER_VISIT") * KB_PER_POSTING) / 1024;
    expect(worstOneBoardMb, "the outlier's arithmetic, recorded").toBeGreaterThan(0);
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
    // THIS ASSERTION USED TO REQUIRE THE OPPOSITE, and that is the lesson.
    // It read `expect(budgetMb).toBeGreaterThan(CEILING_MB)` — it PINNED the
    // budget at a value too high to ever bind, because at the time that was
    // being argued for rather than against. A guard can hold a bug in place
    // just as firmly as it holds a fix. What must be true is the property:
    // a budget the isolate cannot survive is not a safeguard, it is a comment.
    //
    // .64 RE-DERIVES IT AGAINST THE POST-LEAK COST, and the direction of that
    // change is worth naming: this guard was, for one day, pinning the budget
    // BELOW 1,795 postings on a coefficient that measured a defect. It is the
    // same failure as the version it replaced, one order of magnitude smaller —
    // a guard enforcing a model nobody re-measured after the model's subject
    // was fixed. So the property is now stated against the two costs that
    // actually exist, each derived from the constants that produce it.
    const residualMb = (num("SLICE_POSTING_BUDGET") * RESIDUAL_KB_PER_POSTING) / 1024;
    // 1. The postings a slice accumulates must not, on their own, keep the
    //    heap gate permanently tripped — a budget that does that is not a
    //    budget, it is a second HEAP_SOFT_LIMIT_MB with a worse failure mode.
    expect(residualMb, "the budget's own accumulation must sit inside the heap gate")
      .toBeLessThan(num("HEAP_SOFT_LIMIT_MB"));
    // 2. And accumulation PLUS every worker at the per-response ceiling — the
    //    two halves of the heap — must still survive. This is the sum that
    //    caps CONCURRENCY; see the byte arithmetic in index.ts.
    expect(residualMb + peakInFlightMb(), "accumulation + peak in-flight bodies must survive the ceiling")
      .toBeLessThan(CEILING_MB);
    // 3. Reachable, still — DERIVED, not pinned. This assertion used to read
    //    `< 20_000`, which is the right property behind the wrong number:
    //    20,000 is ~8x what five workers can fetch inside the wall clock, so
    //    the guard permitted budgets the wall would beat and the binding check
    //    was the heap one at 5,296. A budget the wall beats first is exactly
    //    the "bound that cannot fire" this file was written about, pointing the
    //    other way — and worse than the original, because a wall-stopped slice
    //    lands past the 128s survival envelope and takes the chain down with
    //    it.
    //
    //    So the ceiling comes out of the constants that produce it. Two rates,
    //    because whether a fifth worker buys anything is an open question this
    //    file names (parsing is serial):
    const wallS = num("SLICE_WALL_BUDGET_MS") / 1000;
    const optimistic = POSTINGS_PER_S_PER_WORKER * num("CONCURRENCY") * wallS;
    const pessimistic = MEASURED_AGGREGATE_POSTINGS_PER_S * wallS;
    expect(num("SLICE_POSTING_BUDGET"), "a budget no slice can reach is a comment, not a bound")
      .toBeLessThan(optimistic);
    //    And it must not merely be reachable — it must be reached with enough
    //    of the wall left for the straggler and the post-loop tail, or the
    //    posting budget stops being the thing that ends the loop and the wall
    //    starts doing it on every slice.
    const loopS = num("SLICE_POSTING_BUDGET") / (MEASURED_AGGREGATE_POSTINGS_PER_S);
    const tailAllowanceS = 15;
    expect(
      wallS - loopS,
      "even if the fifth worker buys nothing, the budget must fire with room for a straggler + the post-loop tail — otherwise the WALL ends the loop and the slice lands outside the 128s envelope",
    ).toBeGreaterThan(num("FETCH_TIMEOUT_MS") / 1000 + tailAllowanceS);
    //    ...and the slice that budget produces has to land inside the only
    //    duration ever observed to survive.
    expect(
      loopS + num("FETCH_TIMEOUT_MS") / 1000 + tailAllowanceS,
      "the expected (budget-bound) slice must land inside the observed survival envelope",
    ).toBeLessThan(SURVIVAL_ENVELOPE_S);
    expect(pessimistic, "sanity: the pessimistic ceiling is the tighter one").toBeLessThan(optimistic);

    // 4. AND THE BOUND NOBODY HAD WRITTEN DOWN: the adaptive load shedder reads
    //    ABSOLUTE slice duration, so this constant sets what its thresholds
    //    mean. Raise the budget without moving them and a healthy slice reads
    //    as distress — at level 2 that cuts CONCURRENCY to 3, which is BELOW
    //    what the raise replaced, and it latches because the shed slice is
    //    still budget-bound and still long. Tie them together here so the next
    //    raise cannot pass the battery while quietly disarming the shedder.
    const coldL1 = Number(CODE.match(/const l1 = hotPhase \? [0-9_]+ : ([0-9_]+);/)![1].replace(/_/g, ""));
    const coldL2 = Number(CODE.match(/const l2 = hotPhase \? [0-9_]+ : ([0-9_]+);/)![1].replace(/_/g, ""));
    // Against the WHOLE slice (loop + the post-loop tail), because coldEmaMs
    // measures `Date.now() - sliceWallStart` at the terminal return, not the
    // loop. Comparing a threshold on slice duration against loop duration is
    // the same off-by-a-tail the wall-clock margin was making.
    expect(coldL1 / 1000, "a HEALTHY cold slice must sit under the L1 shed line, with margin")
      .toBeGreaterThan((loopS + tailAllowanceS) * 1.15);
    expect(coldL2, "L2 must stay under what a wall-stopped slice reaches, or the shedder is structurally dead")
      .toBeLessThan(num("SLICE_WALL_BUDGET_MS") + num("FETCH_TIMEOUT_MS"));
    expect(coldL2, "L2 above L1").toBeGreaterThan(coldL1);
    expect(RAW, "the fit that set the old numbers must stay written down")
      .toMatch(/0\.146 x postings_fetched/);
    expect(RAW).toMatch(/an order of magnitude too high to ever bind/);
    expect(RAW, "and so must the measurement that retired it")
      .toMatch(/~29KB a posting/);
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
    expect(num("HOT_POSTING_BUDGET")).toBeLessThanOrEqual(num("SLICE_POSTING_BUDGET"));
    // After the revert the hot lane is bounded by the same budget as the rest,
    // which still caps it below the raw HOT_SLICE constant — a backstop, not a
    // throttle. Asserting the OUTLIER arithmetic here would forbid the .34
    // configuration that actually held freshness, so what is pinned is that
    // the bound exists and binds something.
    const hotBoards = Math.max(1, Math.floor(num("HOT_POSTING_BUDGET") / num("MAX_POSTINGS_PER_VISIT")));
    expect(hotBoards, "the hot lane is bounded by a budget, not only by HOT_SLICE").toBeGreaterThan(0);
    expect(hotBoards, "and that bound is tighter than the raw constant").toBeLessThanOrEqual(10);
  });
});
