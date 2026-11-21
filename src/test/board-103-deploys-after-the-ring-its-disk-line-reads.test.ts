// @vitest-environment node
/**
 * BOARD .103 REVIEW (ship lens): TWO RESERVATIONS SHARED DEPLOY ORDER 4.6.
 *
 * board-103 and cost2/db's cost-wave-2 both sat at deployOrder 4.6, and both
 * DEPLOY-LEDGER.md rows read "| 4.6 |", though .103's DS1 line reads the
 * nightly storage_size_ring cost-wave-2 starts. deploy-ledger.mjs --overlap
 * and --against do not compare deploy orders, so nothing said so. board-103
 * now sits at 4.7, after cost-wave-2, and says why.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Ledger = { reservations: Record<string, { deployOrder?: number; status?: string }> };
const ROOT = resolve(__dirname, "../..");
const LEDGER = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as Ledger;
/** cost-wave-2's order on cost2/db (docs/deploy-ledger.json there, 2026-11-17). */
const COST_WAVE_2_ORDER = 4.6;

describe("board-103's deploy order", () => {
  const b = LEDGER.reservations["board-103"];
  it("comes after the bug round and after cost-wave-2, whose ring DS1 reads", () => {
    expect(b.deployOrder).toBeGreaterThan(LEDGER.reservations["bug-round"].deployOrder!);
    expect(b.deployOrder).toBeGreaterThan(COST_WAVE_2_ORDER);
    expect(b.status).toContain("after cost-wave-2 (4.6 on cost2/db)");
    expect(readFileSync(resolve(ROOT, "docs/DEPLOY-LEDGER.md"), "utf8")).toMatch(new RegExp(`^\\| ${String(b.deployOrder).replace(".", "\\.")} \\| board-103 \\(`, "m"));
  });

  it("no other reservation in this ledger shares board-103's deploy order", () => {
    const same = Object.entries(LEDGER.reservations).filter(([k, r]) => k !== "board-103" && r.deployOrder === b.deployOrder).map(([k]) => k);
    expect(same).toEqual([]);
  });

  const other = (() => {
    try { return JSON.parse(execFileSync("git", ["show", "cost2/db:docs/deploy-ledger.json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Ledger; } catch { return null; }
  })();
  it.skipIf(other === null)("cost2/db's cost-wave-2 still sits where this ledger says, before board-103 (when this checkout has the branch)", () => {
    expect(other!.reservations["cost-wave-2"].deployOrder).toBe(COST_WAVE_2_ORDER);
  });
});
