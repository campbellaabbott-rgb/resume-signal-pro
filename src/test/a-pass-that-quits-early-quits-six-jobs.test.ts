import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ONE FAILING AGGREGATE SWITCHED OFF SIX UNRELATED DUTIES, WITH ok:true.
 *
 * The pass-end block called refresh_job_board_facets() first and RETURNED on
 * its failure — so the freshness sweep, date hygiene, the capacity governor,
 * filter coverage and the refresh stamps all silently stopped whenever that
 * one RPC struggled. Live 2026-08-29: facets began timing out at ~09:52Z
 * under write pressure; the sweep stopped trimming the aged tail; the table
 * grew; the aggregate got heavier — a feedback loop that froze refreshedAt at
 * 09:05Z for 4+ hours and tripped {facets_cache, freshness_cap} together on
 * the heartbeat. That alert pairing IS the early return's signature: the
 * heartbeat's freshness_cap counts the tail the skipped sweep would have
 * trimmed.
 *
 * The fix: carry the previous facet fields forward (the contract coverage
 * already uses for a failed count) and let maintenance run. Only the orphan
 * prune stays gated on FRESH facets — it deletes rows by the company list,
 * and a destructive path must compute its own input.
 */
const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("a facets failure no longer aborts the pass-end", () => {
  it("computes facetsOk and carries the previous row instead of returning", () => {
    expect(BOARD).toMatch(/const facetsOk = !facetsErr && !!f\.total;/);
    expect(BOARD, "the carried row must be readable back out of the refresh meta")
      .toMatch(/facetsCarried = true;/);
    expect(BOARD, "a carried total must be distinguishable from a fresh one")
      .toMatch(/\.\.\.\(facetsCarried \? \{ facetsCarried: true \} : \{\}\),/);
  });

  it("keeps exactly one early return: the cold-database corner with nothing to carry", () => {
    const block = BOARD.slice(BOARD.indexOf("refresh_job_board_facets"), BOARD.indexOf("const validTokens"));
    const returns = block.match(/return \{ ok: true/g) ?? [];
    expect(returns.length, "the general facets-failure path must fall through to the sweep").toBe(1);
    expect(block).toMatch(/no previous facets to carry/);
  });

  it("gates the orphan prune — the one destructive consumer — on FRESH facets", () => {
    expect(BOARD).toMatch(/if \(!facetsOk\) \{/);
    expect(BOARD).toMatch(/orphan prune SKIPPED: facets carried, not computed/);
  });

  it("stamps an attempt receipt so a failed run is distinguishable from no run", () => {
    expect(BOARD).toMatch(/k: "facets_attempt"/);
  });
});
