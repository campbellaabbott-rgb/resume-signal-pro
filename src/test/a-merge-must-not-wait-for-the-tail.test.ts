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
  const at = BOARD.indexOf("else if (bs.version !== BUILD_VERSION)");
  const block = at >= 0 ? BOARD.slice(at, at + 900) : "";

  it("appends on version change, only when the queue is NON-empty", () => {
    // Empty queue takes the plain refill; this branch exists solely for the
    // mid-cycle merge case.
    expect(at, "the append branch is gone — a merge waits a full cycle again").toBeGreaterThan(-1);
    const seedAt = BOARD.indexOf("if (queue.length === 0) {");
    expect(seedAt).toBeGreaterThan(-1);
    expect(at, "must be the else-branch of the empty-refill").toBeGreaterThan(seedAt);
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

  it("fails open — an RPC error leaves the queue untouched", () => {
    expect(block).toMatch(/catch \{/);
  });
});
