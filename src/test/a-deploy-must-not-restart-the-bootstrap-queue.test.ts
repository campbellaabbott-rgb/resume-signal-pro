import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE LANE THAT INGESTS NEW BOARDS NEVER FINISHED, BECAUSE EVERY DEPLOY SENT
 * IT BACK TO THE START.
 *
 * The bootstrap queue re-seeded whenever BUILD_VERSION changed, and
 * get_empty_boards returns a stable order — so each deploy restarted the
 * drain at the front of the same list, 25 boards per cold slice, and the tail
 * was never reached. A comment elsewhere in the function already warned that
 * "every deploy resets the bootstrap lane"; what it did not say is that the
 * lane therefore never completes.
 *
 * Measured 2026-08-24 after twelve deploys in a single day:
 *   - bootstrapQueue.pending 7,564 and rising (3,120 -> 6,898 -> 7,564).
 *   - 32 of 150 stratified registry entries (21%) serve ZERO postings,
 *     implying ~6,764 across the 31,708-entry catalog.
 *   - Of seven such zero-row boards probed against their OWN vendor APIs,
 *     SEVEN returned live jobs — zencoder 5, cluely 4, helm-ai 9,
 *     ITTrailBlazers1 65, LevelOneRobotics 14, Etech7 4, integrate 9. None
 *     was genuinely empty.
 *
 * So these are not dead boards. They are jobs the board has the right to
 * serve and has never fetched. The queue now refills only when it is EMPTY,
 * so progress survives a deploy; boards filled meanwhile drop out naturally
 * because the refill asks which boards are still empty.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("a deploy must not restart the bootstrap queue", () => {
  it("the queue refills on exhaustion, not on a version change", () => {
    expect(CODE).toMatch(/if \(queue\.length === 0\) \{[\s\S]{0,240}get_empty_boards/);
  });

  it("a version change may APPEND, never REBUILD", () => {
    // The 2026-08-01 defect was not the version COMPARISON — it was rebuilding
    // the queue when versions differed, which restarted the drain and kept the
    // tail forever out of reach. The comparison returned on 2026-08-28 for the
    // opposite reason: refill-on-empty made a fresh MERGE wait a whole cycle
    // (the Oracle tranche sat at zero for 2+ hours behind a 7.5k backlog), and
    // the reconciliation appends the merge's boards at the BACK with the drain
    // position untouched. So the property this pins is: inside the
    // version-change branch, the existing queue must always be the PREFIX of
    // the new one.
    const lane = CODE.slice(CODE.indexOf("let bootstrapBoards"), CODE.indexOf("const slice = ["));
    const vb = lane.indexOf("bs.version !== BUILD_VERSION");
    expect(vb, "the merge-append branch is gone").toBeGreaterThan(-1);
    const branch = lane.slice(vb, vb + 900);
    expect(branch, "the version branch REBUILDS the queue — the restart defect returns")
      .not.toMatch(/queue = Array\.isArray/);
    expect(branch).toMatch(/queue = \[\.\.\.queue, \.\.\.fresh\]/);
  });

  it("the drain is still optimistic, so a died slice cannot wedge the lane", () => {
    // Still unconditional — what changed is the AMOUNT. Under load shedding the
    // lane selects effBootstrapPerSlice boards, and the drain must move by the
    // same number or it discards boards it never fetched. The optimism this
    // test guards (drain regardless of slice outcome) is unchanged.
    expect(CODE).toMatch(/queue: queue\.slice\(effBootstrapPerSlice\)/);
    expect(CODE, "the drain must equal the selection, shed or not")
      .toMatch(/\.slice\(0, effBootstrapPerSlice\)/);
  });

  it("the lane stays an accelerator — a failure never breaks the rotation", () => {
    const lane = CODE.slice(CODE.indexOf("let bootstrapBoards"), CODE.indexOf("const slice = ["));
    expect(lane).toMatch(/catch \{/);
  });
});
