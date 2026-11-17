// @vitest-environment node
/**
 * EVERY BOARD-103 MIGRATION IS ORDERED IN THE LEDGER (job-board 2026-09-09.103).
 *
 * The generated message puts a migration with no migrationOrder entry before
 * every function. For .103's high-water clamp that is the one wrong place:
 * applied while .102 still slices, .102's next pass end raises the mark
 * straight back and .103 starts with the orphan prune blocked. .102's clamp
 * needed a slice: rule for the same reason (20261111120000).
 *
 * So every 20261117* stamp on disk has a migrationOrder entry, and the clamp's
 * is "after a slice of job-board .103", with a note that tells Lovable to
 * apply the same file again, unedited, when it refuses. The message is read
 * the way scripts/deploy-ledger.mjs builds it (migrationPhases), with job-board
 * deploying .103 over a live .102.
 *
 * THIS FAILS ON THE DB LANE BY DESIGN: the lane writes the file and the
 * integrator writes docs/deploy-ledger.json (spec section 3.8). It passes once
 * migrationOrder["20261117110000"] is in the ledger.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const BOARD_103 = MIGRATIONS.filter((f) => f.startsWith("20261117"));
const ledger = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const order = (ledger.migrationOrder ?? {}) as Record<string, { after?: string; before?: string[]; note?: string }>;
const CLAMP = MIGRATIONS.find((f) => f.startsWith("20261117110000_")) ?? null;

describe("every board-103 migration is ordered in the ledger", () => {
  it("finds the board-103 migrations at all", () => {
    expect(CLAMP, "the stamp matcher has rotted, or the clamp is gone").not.toBeNull();
    expect(BOARD_103).toContain(CLAMP);
  });

  it("each 20261117 stamp has a migrationOrder entry", () => {
    const missing = BOARD_103.map((f) => f.slice(0, 14)).filter((s) => !order[s] || (!order[s].after && !(order[s].before ?? []).length));
    expect(missing, "a board-103 migration with no after/before rule goes before every function in the message").toEqual([]);
  });

  it("the clamp waits for a slice of .103, and its line says to apply it again unedited", () => {
    const e = order["20261117110000"];
    expect(e?.after).toBe("slice:job-board@2026-09-09.103");
    expect(e?.note ?? "", "a refusal's remedy is the same file again; Lovable edits a failing migration otherwise").toMatch(/unedited/);
    const rows = [{ fn: "job-board", want: "job-board.2026-09-09.103", have: "job-board.2026-09-09.102", state: "deploy" }];
    const phases = L.migrationPhases([CLAMP as string], ledger, rows, MIGRATIONS);
    expect(phases.errors).toEqual([]);
    expect(phases.pre.map((m: { file: string }) => m.file), "the clamp must not go before job-board").toEqual([]);
    const line = (phases.afterFunctions as Array<{ file: string; note: string }>).find((m) => m.file === CLAMP);
    expect(line?.note ?? "").toMatch(/once the job-board status action's sliceStats\.build reads 2026-09-09\.103 or later/);
  });
});
