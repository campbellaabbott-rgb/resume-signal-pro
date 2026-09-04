import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY LEVER BOUNDED A PART. NOTHING BOUNDED THE SUM, AND THE SUM IS WHAT DIED.
 *
 * The shed levers cut how MANY boards a slice takes. .27 cut how big one VISIT
 * can be. Neither bounds what one invocation holds in total. Measured
 * 2026-09-03 at L0 post-cap: ~5 capped giants among the 80 base boards
 * (~10,300 postings) plus a deep lane of 8 x 2,000 (16,000) — and the
 * invocation died on WORKER_RESOURCE_LIMIT inside its fetch loop, exactly as it
 * had on one 20,800-posting board before the cap. Two fixes in two days each
 * removed a real cause and each was followed by the same signature, because
 * the per-board cap had redistributed the volume rather than bounded it.
 *
 * A death is the worst possible outcome of an over-full slice: the cursor has
 * already advanced, so EVERY remaining board is skipped, nothing is recorded,
 * and the stale-row rule floors the fleet at L1 where it cannot recover. The
 * budget turns that into the mildest: the slice stops STARTING fetches, the
 * tail skips this pass (the same one-rotation staleness a death already cost
 * them), and the slice completes — stats record, L0 holds, and budgetHit is
 * the first signal that measures the thing actually killing slices.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("nothing bounded the sum", () => {
  it("has a per-slice budget in POSTINGS", () => {
    expect(CODE).toMatch(/const SLICE_POSTING_BUDGET = 12_000;/);
  });

  it("stops STARTING fetches at the budget, after the dormancy skip and before the fetch", () => {
    const skip = CODE.indexOf("if (skipTokens.has(s.token)) continue;");
    const budget = CODE.indexOf("if (fetchedInSlice >= SLICE_POSTING_BUDGET) { budgetSkipped.push(s.token); continue; }");
    // .32 wrapped the fetch in try/finally to release the in-flight reservation.
    const fetch = CODE.indexOf("r = await fetchBoard(s, (m) => { failReason = m; }, deepCursors[s.token] ?? 0);");
    expect(budget, "budget check missing").toBeGreaterThan(0);
    expect(budget, "budget check must follow the dormancy skip").toBeGreaterThan(skip);
    expect(fetch, "budget check must precede the fetch it prevents").toBeGreaterThan(budget);
  });

  it("reserves in-flight worst case, so the check sees what is HELD, not what has landed", () => {
    // Concurrency 8 x a 2,000 cap = up to 16,000 postings past a check that
    // only looked at landed volume. Three chain deaths in an hour with
    // budgetHit=false, the last completed slice at 10,402, said so.
    // .34: the reservation is per board (what THAT board can still add), and
    // it retires a worker rather than deferring a board — see
    // a-reservation-that-emptied-the-queue.test.ts for why.
    expect(CODE).toMatch(/let inFlightReserve = 0;/);
    expect(CODE).toMatch(/inFlightReserve \+= reserve;/);
    expect(CODE, "the reservation must be released in a finally, or a throwing fetch leaks it").toMatch(/finally \{ inFlightReserve -= reserve; \}/);
    // .39: yields instead of exiting — see four-ways-to-lose-a-board.test.ts.
    expect(CODE).toMatch(/if \(fetchedInSlice \+ inFlightReserve >= SLICE_POSTING_BUDGET\) \{\s*queue\.unshift\(s\);/);
  });

  it("counts what was HELD, not what was stored", () => {
    // r.jobs is normalised postings before the freshness filter — the memory
    // cost. rows.length (sliceTotal) is what survived the 30-day cap, which
    // can be a fraction of it.
    expect(CODE).toMatch(/if \(r\) fetchedInSlice \+= r\.jobs\.length;/);
  });

  it("puts the deep lane LAST, so the budget protects the rotation first", () => {
    // Under the budget the tail of this list is what gets deferred. The
    // cursor-bearing base carries the freshness claim; the lane's fill rate
    // does not. This is the .21 trade made on purpose.
    expect(CODE).toMatch(/const slice = \[\.\.\.demandBoards, \.\.\.bootstrapBoards, \.\.\.retryBoards, \.\.\.baseSlice, \.\.\.deepBoards\];/);
  });

  it("records the outcome where status already looks", () => {
    const note = CODE.indexOf("sliceBudgetNote = { fetched: fetchedInSlice, skipped: budgetSkipped.length, hit: budgetSkipped.length > 0, lastUpsertError, heapStopped, wallStopped, sizeStopped };");
    const pulse = CODE.indexOf("await stampSliceWork(client, inHotPhase, sliceWallStart);");
    expect(note, "budget note missing").toBeGreaterThan(0);
    expect(pulse, "the note must be set before the pulse that follows the loop").toBeGreaterThan(note);
    expect(CODE).toMatch(/budgetFetched: sliceBudgetNote\.fetched, budgetSkipped: sliceBudgetNote\.skipped, budgetHit: sliceBudgetNote\.hit, heapStopped: sliceBudgetNote\.heapStopped/);
  });

  it("does not gate deep-lane ENTRY — that would turn the cap into a truncation", () => {
    // The lane is the only thing that resumes a capped board. Entry must stay
    // "any board that reports nextOffset > 0", vendor-agnostic.
    expect(CODE).toMatch(/if \(r\.nextOffset > 0\) \{ if \(prev !== r\.nextOffset\) \{ deepCursors\[s\.token\] = r\.nextOffset; deepCursorsDirty = true; \} \}/);
  });
});
