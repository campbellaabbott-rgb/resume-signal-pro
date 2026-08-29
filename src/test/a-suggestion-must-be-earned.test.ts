/**
 * THE FIRST VERSION OF THIS FEATURE SHIPPED DEAD, AND A REVIEW PROVED IT.
 *
 * The earned did-you-mean paid its own fuzzy_title_search call and gated on
 * the RPC's total_rows >= 10 — but total_rows is capped by the call's own
 * LIMIT of 8, so the gate was unsatisfiable on every input. Verified live on
 * .45: three misspelled queries, zero suggestions, the RPC paid each time.
 * The same review confirmed the duplicate RPC (the augmentation had just
 * fetched identical rows), the class mismatch (gating on the exact segment
 * fired the RPC on healthy 15-exact/300-related pages), a tokenizer that
 * shattered "büroassistent" into a garbage correction, and a precedence gate
 * keyed differently from the emitter it defers to.
 *
 * The corrected design derives, never fetches: pure CPU over the rows the
 * augmentation already fetched, so the cost is zero and the class is exactly
 * the augmentation's own thin-PAGE gate. Everything below pins that shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RAW = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const BOARD = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a suggestion is derived, never fetched", () => {
  const at = BOARD.indexOf("let earnedDym");
  const block = BOARD.slice(at, BOARD.indexOf("catch { ", at) + 80);

  it("exists and reads the augmentation's captured rows", () => {
    expect(at, "the earned did-you-mean is gone").toBeGreaterThan(-1);
    expect(block, "it must derive from fuzzyTitlesForDym").toContain("fuzzyTitlesForDym");
    expect(block, "a second RPC is the reviewed defect returning")
      .not.toContain("client.rpc");
  });

  it("the capture happens inside the augmentation, so the class is the thin-page gate", () => {
    const cap = BOARD.indexOf("fuzzyTitlesForDym = (fz as");
    const aug = BOARD.indexOf("pageTotal !== null && pageTotal > 0 && pageTotal < FUZZY_AUGMENT_BELOW");
    expect(cap, "the capture is gone").toBeGreaterThan(-1);
    expect(aug, "the augmentation gate moved").toBeGreaterThan(-1);
    expect(cap, "the capture must live inside the augmentation's gated block").toBeGreaterThan(aug);
  });

  it("never gates on the RPC's own capped count", () => {
    // total_rows tracks p_limit; >= any-number-above-the-limit is dead code.
    expect(block).not.toMatch(/fzTotal/);
    expect(block, "a dense sample is required instead").toMatch(/fuzzyTitlesForDym\.length >= 5/);
  });

  it("requires cross-title support that OUTWEIGHS the typo's own", () => {
    // The presence veto trusted three employers' identical misspelling
    // ("recepcionist" got no suggestion over a 30-title correct pool,
    // measured live). Corroboration is a ratio now: the correction must beat
    // the typo three-to-one — which also generalises the curated "manger"
    // entry, where 101 employer-typo rows lose to an overwhelming pool.
    expect(block).toMatch(/support >= 3 && support >= tokSupport \* 3/);
    expect(block).toMatch(/const tokSupport = titleWords\.filter/);
    expect(block, "the absolute presence veto is the measured defect returning")
      .not.toMatch(/allWords\.has\(tok\)\) continue/);
  });

  it("tokenizes Unicode letters, both sides", () => {
    // [^a-z]+ splits on ä/é and then "corrects" the fragment inside the word:
    // "büroassistent" -> "büassistent" was the reviewed scenario.
    const uni = block.match(/\[\^\\p\{L\}\]\+/gu) ?? [];
    expect(uni.length, "both the title and query tokenizers must split on Unicode non-letters")
      .toBeGreaterThanOrEqual(2);
    expect(block).not.toMatch(/\[\^a-z\]/);
  });

  it("replaces at a word boundary, not a substring", () => {
    expect(block).toMatch(/\(\?<=\^\|\[\^/);
  });

  it("defers to the curated map, keyed EXACTLY as the emitter keys it", () => {
    // searchDisclosures reads body.q; qText has been through sanitization and
    // the exclusion split. A different key double-emits.
    expect(block).toMatch(/!DID_YOU_MEAN\[String\(body\.q \?\? ""\)\.trim\(\)\.toLowerCase\(\)\]/);
  });

  it("is a disclosure, never a rewrite of the served rows", () => {
    expect(BOARD).toMatch(/\.\.\.\(earnedDym \? \{ didYouMean: earnedDym \} : \{\}\)/);
  });

  it("the distance bound is 2 and the helper early-exits", () => {
    expect(BOARD).toMatch(/function within2Edits/);
    expect(BOARD).toMatch(/if \(rowMin > 2\) return false/);
  });
});

describe("slice timing measures the whole slice", () => {
  it("records at the TERMINAL returns, covering the tail work", () => {
    // The first version stamped before dormancy pruning and the pass-end
    // facets recompute — undercounting ~27% on pass-end slices (review
    // finding). One recorder, called at every completed-slice return.
    expect(BOARD).toMatch(/function recordSliceStats/);
    const calls = BOARD.match(/recordSliceStats\(client, sliceWallStart, inHotPhase\);/g) ?? [];
    expect(calls.length, "every terminal slice return must record — a missing one biases the EMA").toBe(3);
  });

  it("documents the accepted force-race rather than pretending it away", () => {
    expect(RAW).toMatch(/KNOWN, ACCEPTED RACE/);
  });

  it("status exposes it", () => {
    expect(BOARD).toMatch(/sliceStats: \(sliceStatsRow\?\.data\?\.v \?\? null\)/);
  });
});
