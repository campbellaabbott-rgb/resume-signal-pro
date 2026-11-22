/**
 * REFILL-ON-EMPTY FIXED ONE INCIDENT AND CREATED THE NEXT.
 *
 * 2026-08-01: every deploy restarted the bootstrap queue, so its tail was
 * never reached. Fix: refill only when empty. 2026-08-28: that same rule made
 * a fresh MERGE wait for the whole cycle — the Oracle tranche sat at zero for
 * 2+ hours while eight boards were probed live and verified fetchable; the
 * queue's ~7.5k mostly-empty backlog stood between them and their first fetch.
 *
 * The append-on-version-change branch was the reconciliation: drain
 * position preserved, and a merge's boards entered at the back of the CURRENT
 * cycle. Board .103 (W4-1) goes further: a version change REPLACES the queue
 * with what is new, so a merge's boards (no read has stamped them) sit right
 * behind the repointed tokens and ahead of nothing else, and the old backlog
 * of read-and-empty boards is gone. Its properties, pinned:
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("a merge must not wait for the tail", () => {
  it("a version change seeds the merge's never-read boards right after the repointed, and keeps no old backlog", async () => {
    const { bootstrapSeed } = await import("../../supabase/functions/job-board/bootstrap-seed");
    const seed = bootstrapSeed({ repointed: ["moved"], empty: ["merged-1", "old-empty", "merged-2"], verified: new Set(["old-empty"]), vendorsOf: () => ["oracle"], changedReaders: new Set() });
    expect(seed.queue).toEqual(["moved", "merged-1", "merged-2"]);
    // Both paths take the seed as the whole queue: the RPC path empties the row and appends; the legacy path assigns.
    expect(BOARD).toMatch(/v: \{ queue: \[\], version: storedVersion \}[\s\S]{0,240}bootstrap_queue_append", \{ p_tokens: seed\.queue \}/);
    expect(BOARD).toMatch(/queue = seed\.queue;/);
  });

  it("a failed seed RETRIES — the version is stamped only when it lands", () => {
    // The first version swallowed the RPC error while the drain write stamped
    // BUILD_VERSION anyway: one failed call and the merge's boards silently
    // never entered the lane. Verified against a live symptom — the Oracle
    // tranche still at zero with the append branch already deployed.
    const at = BOARD.indexOf("if (bs.version !== BUILD_VERSION) {");
    expect(at, "the legacy seed branch is gone").toBeGreaterThan(-1);
    const block = BOARD.slice(at, at + 900);
    expect(block).toMatch(/bootstrapAppendDone = false/);
    expect(block).toMatch(/will retry next slice/);
    expect(BOARD, "the drain write must hold the old version until a seed lands")
      .toMatch(/version: bootstrapAppendDone \? BUILD_VERSION : \(bs\.version \?\? ""\)/);
    expect(BOARD, "the RPC path's take stamps the version only when its seed landed").toMatch(/p_stamp_version: appendDone/);
  });
});
