/**
 * REFILL-ON-EMPTY FIXED ONE INCIDENT AND CREATED THE NEXT.
 *
 * 2026-08-01: every deploy restarted the bootstrap queue, so its tail was
 * never reached. Fix: refill only when empty. 2026-08-28: that same rule made
 * a fresh MERGE wait for the whole cycle — the Oracle tranche sat at zero for
 * 2+ hours while eight boards were probed live and verified fetchable; the
 * queue's ~7.5k mostly-empty backlog stood between them and their first fetch.
 *
 * The append-on-version-change branch is the reconciliation: drain position
 * preserved (no restart), nothing re-ordered, and a merge's boards enter at
 * the back of the CURRENT cycle. Its properties, pinned:
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a merge must not wait for the tail", () => {
  const at = BOARD.indexOf("if (queue.length > 0 && bs.version !== BUILD_VERSION)");
  const block = at >= 0 ? BOARD.slice(at, at + 1600) : "";

  it("appends on version change, only when the queue is NON-empty", () => {
    // Empty queue takes the plain refill; this branch exists solely for the
    // mid-cycle merge case.
    expect(at, "the append branch is gone — a merge waits a full cycle again").toBeGreaterThan(-1);
    const seedAt = BOARD.indexOf("if (queue.length === 0) {");
    expect(seedAt).toBeGreaterThan(-1);
    // No longer an else-branch (the retry restructure hoisted it), but the
    // queue.length > 0 conjunct in the anchor above keeps the same property:
    // an empty queue takes the plain refill, never this branch.
    expect(at).toBeGreaterThan(seedAt);
  });

  it("appends at the BACK and never re-orders", () => {
    // Front placement is the restart pathology wearing a new hat: the drain
    // would re-verify fresh appends ahead of the tail it has been working
    // toward all cycle.
    expect(block).toMatch(/queue = \[\.\.\.queue, \.\.\.fresh\]/);
    expect(block).not.toMatch(/\[\.\.\.fresh, \.\.\.queue\]/);
  });

  it("dedupes against what is already queued", () => {
    expect(block).toMatch(/filter\(\(t\) => !have\.has\(t\)\)/);
  });

  it("a failed append RETRIES — the version is stamped only when it lands", () => {
    // The first version swallowed the RPC error while the drain write stamped
    // BUILD_VERSION anyway: one failed call and the merge's boards silently
    // never entered the lane. Verified against a live symptom — the Oracle
    // tranche still at zero with the append branch already deployed.
    expect(block).toMatch(/bootstrapAppendDone = false/);
    expect(block).toMatch(/will retry next slice/);
    expect(BOARD, "the drain write must hold the old version until an append lands")
      .toMatch(/version: bootstrapAppendDone \? BUILD_VERSION : \(bs\.version \?\? ""\)/);
  });
});
