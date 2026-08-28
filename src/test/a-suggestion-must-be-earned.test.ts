/**
 * TWO CURATED PAIRS ARE NOT A SPELLING CORRECTOR.
 *
 * DID_YOU_MEAN held exactly two measured entries. Every other typo whose exact
 * pool was THIN — 1-4 junk title matches, which the zero-result fuzzy rescue
 * never touches because zero is its gate — rendered a page of noise with no
 * exit. The board already had the instrument (the trigram RPC the fuzzy tier
 * runs); the generalization asks it what similar titles actually say and
 * surfaces a query token within two edits of a word that appears in three or
 * more of them.
 *
 * The properties that keep it honest, each pinned below:
 *  - THIN-ONLY: total 1-4. Zero keeps the full fuzzy rescue; a healthy pool
 *    must never pay the extra RPC (the routed-path budget rule).
 *  - DISCLOSURE-ONLY: the rows on the page are untouched — no re-ranking, no
 *    widening, none of the tier-escalation traps.
 *  - EARNED: the correction needs support in >= 3 of the sampled titles and a
 *    trigram pool of >= 10 — one lucky title is not a measurement.
 *  - The curated map keeps precedence: its pairs are semantic
 *    (krankenschwester -> pflegefachkraft), not edit-distance reachable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a suggestion must be earned", () => {
  const at = BOARD.indexOf("let earnedDym");
  const block = BOARD.slice(at, BOARD.indexOf("catch {", at) + 60);

  it("exists, and only on the thin band", () => {
    expect(at, "the earned did-you-mean is gone").toBeGreaterThan(-1);
    // FUZZY_AUGMENT_BELOW, not a literal: the "< 5" boundary once left the
    // 5-result typo page with nothing (board-filter-contract pins that the
    // literal never returns), and the two thin-page features share one band.
    expect(block).toMatch(/total !== null && total > 0 && total < FUZZY_AUGMENT_BELOW/);
    expect(block, "must stand down for pagination/count probes").toMatch(/offset === 0 && !countOnly/);
    expect(block, "must respect the request budget").toMatch(/budgetLeft\(\) > 2_500/);
  });

  it("defers to the curated map", () => {
    expect(block).toMatch(/!DID_YOU_MEAN\[qText\.trim\(\)\.toLowerCase\(\)\]/);
  });

  it("requires cross-title support and a real pool", () => {
    expect(block).toMatch(/support >= 3/);
    expect(block).toMatch(/fzTotal >= 10/);
    expect(block, "a token already spelled right must never be corrected")
      .toMatch(/if \(allWords\.has\(tok\)\) continue/);
  });

  it("is a disclosure, never a rewrite of the served rows", () => {
    // The only consumer of earnedDym is the response spread.
    const uses = BOARD.match(/earnedDym/g) ?? [];
    expect(BOARD).toMatch(/\.\.\.\(earnedDym \? \{ didYouMean: earnedDym \} : \{\}\)/);
    expect(uses.length, "earnedDym leaked into result assembly").toBeLessThanOrEqual(8);
  });

  it("the distance bound is 2 and the helper early-exits", () => {
    expect(BOARD).toMatch(/function within2Edits/);
    expect(BOARD).toMatch(/if \(rowMin > 2\) return false/);
  });
});

describe("slice timing is a status field, not a hand ritual", () => {
  it("every slice records its wall time with a per-phase EMA", () => {
    expect(BOARD).toMatch(/const sliceWallStart = Date\.now\(\)/);
    expect(BOARD).toMatch(/k: "slice_stats"/);
    expect(BOARD, "EMA alpha drifted").toMatch(/prevEma \* 0\.8 \+ sliceMs \* 0\.2/);
    expect(BOARD, "instrumentation must never slow the chain").toMatch(/waitUntil\(\(async \(\) => \{\s*try \{\s*const sliceMs/);
  });

  it("status exposes it", () => {
    expect(BOARD).toMatch(/sliceStats: \(sliceStatsRow\?\.data\?\.v \?\? null\)/);
  });
});
