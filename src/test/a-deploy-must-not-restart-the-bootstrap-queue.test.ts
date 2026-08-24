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

  it("BUILD_VERSION no longer triggers a re-seed", () => {
    // The exact shape of the defect: comparing the stored version to the
    // deployed one and rebuilding the queue when they differ.
    const lane = CODE.slice(CODE.indexOf("let bootstrapBoards"), CODE.indexOf("const slice = ["));
    expect(lane).not.toMatch(/bs\.version !== BUILD_VERSION/);
    expect(lane).not.toMatch(/bs\.version !== \(bsMeta/);
  });

  it("the drain is still optimistic, so a died slice cannot wedge the lane", () => {
    expect(CODE).toMatch(/queue: queue\.slice\(BOOTSTRAP_PER_SLICE\)/);
  });

  it("the lane stays an accelerator — a failure never breaks the rotation", () => {
    const lane = CODE.slice(CODE.indexOf("let bootstrapBoards"), CODE.indexOf("const slice = ["));
    expect(lane).toMatch(/catch \{/);
  });
});
