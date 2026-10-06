// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { constOf, runGate } from "./helpers/slice-worker";

/**
 * FOUR WAYS TO LOSE A BOARD, ALL FOUND IN ONE SWEEP.
 *
 * 2026-09-04, a 47-agent read-only sweep with three refuters per finding.
 * Each of these was live, and two of them were shipped by me the same day.
 *
 *  1. The free-text or() interpolated its terms unquoted. A PostgREST or() is
 *     a comma-separated list inside parentheses, so an ordinary job title —
 *     "Manager, Operations", "Teacher, K-8", "Engineer (Remote)" — was parsed
 *     as structure and returned HTTP 500.
 *  2. A budget-retired fetch worker `return`ed, ending it for the rest of the
 *     slice. Every reservation trip permanently removed one of the eight, so
 *     concurrency ratcheted down to 1 in the tail of every cold slice — and
 *     cold rotation speed is what buys the published freshness promise.
 *  3. Oracle and iCIMS reported windowed:false on the deep cursor's WRAP
 *     visit, so one partial read absence-pruned an entire giant employer:
 *     Kroger's 12,350 postings, Costco, AutoZone, PetSmart, Ulta, JCPenney.
 *  4. The exact-word rescue tier claimed `ranked: true`, so the page said
 *     "Sorted by relevance" over rows with no relevance scoring, and the only
 *     detector for a ranked-path outage could never fire.
 */
const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SHARED = readFileSync(resolve(ROOT, "supabase/functions/_shared/location-terms.ts"), "utf8");

describe("four ways to lose a board", () => {
  it("every or() value is quoted, and the sanitiser strips the character that could escape it", () => {
    expect(CODE).toMatch(/q = q\.or\(`title\.ilike\."%\$\{t\}%",company\.ilike\."%\$\{t\}%",department\.ilike\."%\$\{t\}%"`\)/);
    // The quoting is only safe while sanitizeTerm removes the double quote.
    expect(SHARED).toMatch(/sanitizeTerm = \(t: string\) => t\.replace\(\/\[%_\\\\\|"\]\/g, ""\)/);
    // No unquoted ilike survives inside an or() list anywhere in the file.
    expect(CODE.match(/\.or\(`[^`]*ilike\.%/g) ?? [], "an unquoted ilike inside an or()").toEqual([]);
  });

  it("a budget-retired worker yields and comes back — it never exits the slice", async () => {
    // .53: the yield now escapes when nothing is in flight, because waiting
    // for a reservation that is already zero is waiting forever — the defect
    // that kept the loop from ever exiting
    // (a-wait-for-something-that-cannot-happen.test.ts). The property this
    // guard is about — the worker comes BACK rather than retiring — is intact.
    // .90 (n423): the start checks are one gate (start-gate.ts), so the worker's turn is RUN, not spelled.
    const budget = constOf("SLICE_POSTING_BUDGET");
    const held = await runGate({ queue: [{ source: "lever", token: "a" }, { source: "lever", token: "b" }], fetchedInSlice: budget - 10, inFlightReserve: 40 });
    expect(held.started, "a full reservation starts nothing").toBeNull();
    expect(held.deferred, "and defers nothing while a board is in flight").toEqual([]);
    expect(held.queue, "the board goes back to the head").toEqual(["a", "b"]);
    expect(held.waitedMs).toEqual([250]);
    expect(held.exited, "the worker stays in the slice").toBe(false);
    expect(CODE).toMatch(/queue\.unshift\(s\);\s*await new Promise\(\(r\) => setTimeout\(r, 250\)\);\s*continue;/);
    expect(CODE, "and it must escape rather than wait when nothing can end the wait")
      .toMatch(/if \(inFlightReserve === 0 \|\| spins > YIELD_SPIN_LIMIT\)/);
    expect(CODE, "the reservation branch must not return").not.toMatch(/queue\.unshift\(s\); return;/);
    // The landed check still exits the BOARD (not the worker) when the budget
    // is genuinely spent — that is what makes the yield above terminate.
    const spent = await runGate({ queue: [{ source: "lever", token: "a" }, { source: "lever", token: "b" }], fetchedInSlice: budget, inFlightReserve: 40, turns: 2 });
    expect(spent.deferred, "each board is deferred and the worker takes the next").toEqual(["a", "b"]);
    expect(spent.waitedMs, "a spent budget is not waited on").toEqual([]);
    expect(spent.exited).toBe(false);
  });

  it("a resumed read reports windowed, so a wrap visit cannot absence-prune a giant board", () => {
    // Only a RESUMABLE fetcher can be mid-read: those are exactly the ones
    // that return a nextOffset. UKG, ADP and USAJOBS read from the top every
    // visit, so `!exhausted` alone is correct for them and adding the clause
    // would pin a variable they do not have.
    const returns: string[] = CODE.match(/return \{[^;]*windowed: !exhausted[^;]*\};/g) ?? [];
    const resumable = returns.filter((r) => r.includes("nextOffset"));
    expect(resumable.length, "Oracle and iCIMS").toBeGreaterThanOrEqual(2);
    for (const r of resumable) expect(r, `a resumed read must count as windowed: ${r.slice(0, 90)}`).toContain("|| startOffset > 0");
  });

  it("only a genuinely reranked exit claims ranked: true", () => {
    expect(CODE, "the exact-word rescue tier applies no relevance scoring").not.toMatch(/exactWordMatch: qText,\s*ranked: true/);
    expect(CODE, "the location split IS reranked, and keeps its claim").toMatch(/locationSplit: \{ q: won\.head, location: won\.place \},\s*ranked: true,/);
  });
});
