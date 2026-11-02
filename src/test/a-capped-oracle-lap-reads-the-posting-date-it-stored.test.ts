// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import * as readWindow from "../../supabase/functions/job-board/read-window";

/**
 * A CAPPED ORACLE LAP READS THE POSTING DATE IT STORED (S10-003, n1430).
 *
 * The 10,000-cap rule keeps a stored row out of the absence list when the
 * capped read could not have reached it: undated, or posted on or before the
 * floor's day. It reads that date from existingById, which index.ts builds
 * from the rows of the existing-rows select. The select asked for posted_at
 * but the row mapping did not copy it, so every stored row looked undated and
 * no capped lap could stamp, close or log anything while its lap still
 * proved.
 *
 * The select string, the row mapping and the absence line here are the
 * SHIPPED ones, lifted from index.ts and run in order on rows shaped as the
 * database returns them.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

function lifted() {
  const sel = /\.select\("(id,lap_epoch,missing_since,[a-z_,]+)"\)/.exec(FN);
  expect(sel, "the existing-rows select moved").not.toBeNull();
  const at = FN.indexOf("existingRows.push(...((page ?? []) as Array<ExistingRow>).map(");
  expect(at, "the existing-rows mapping moved").toBeGreaterThan(-1);
  const from = FN.indexOf("(r) => ({", at);
  const to = FN.indexOf("})));", from);
  const mapper = new Function(`return ${transformSync(`(${FN.slice(from, to + 2)})`, { loader: "ts" }).code.replace(/;\s*$/, "")};`)() as (r: Record<string, unknown>) => Record<string, unknown>;
  const line = /\n( +const vanishedAll = [^\n]+;)\n/.exec(FN);
  expect(line, "the absence list moved").not.toBeNull();
  const absent = (r: Record<string, unknown>, existingRows: Array<Record<string, unknown>>, live: string[]) => {
    const existingById = new Map(existingRows.map((x) => [String(x.id), x]));
    const scope: Record<string, unknown> = { ...readWindow, r, existing: new Set(existingById.keys()), liveIds: new Set(live), agedOutIds: new Set(), existingById };
    const names = Object.keys(scope);
    return new Function(...names, `${transformSync(line![1], { loader: "ts" }).code}\nreturn vanishedAll;`)(...names.map((n) => scope[n])) as string[];
  };
  return { columns: sel![1].split(","), mapper, absent };
}

describe("the existing-rows mapping carries what the cap rule reads", () => {
  it("every column the existing-rows select asks for is a key of the mapped row", () => {
    const { columns, mapper } = lifted();
    const row = Object.fromEntries(columns.map((c) => [c, c === "lap_epoch" ? 7 : `${c}-value`]));
    const mapped = mapper(row);
    expect(columns.filter((c) => !(c in mapped))).toEqual([]);
    expect(mapped.posted_at).toBe("posted_at-value");
  });

  it("on a capped lap, a stored row posted after the floor and absent from the lap becomes an absence candidate", () => {
    const { mapper, absent } = lifted();
    const db = [
      { id: "oracle:eluq~us2~CX_1:fresh", lap_epoch: 3, missing_since: null, title: "Clerk", posted_at: "2026-10-20T00:00:00.000Z", first_seen: "2026-10-20T01:00:00.000Z" },
      { id: "oracle:eluq~us2~CX_1:old", lap_epoch: 3, missing_since: null, title: "Clerk", posted_at: "2026-08-01T00:00:00.000Z", first_seen: "2026-08-01T01:00:00.000Z" },
      { id: "oracle:eluq~us2~CX_1:undated", lap_epoch: 3, missing_since: null, title: "Clerk", posted_at: null, first_seen: "2026-10-01T00:00:00.000Z" },
      { id: "oracle:eluq~us2~CX_1:seen", lap_epoch: 4, missing_since: null, title: "Clerk", posted_at: "2026-10-31T00:00:00.000Z", first_seen: "2026-10-31T01:00:00.000Z" },
    ];
    expect(absent({ capFloor: "2026-08-13" }, db.map(mapper), ["oracle:eluq~us2~CX_1:seen"])).toEqual(["oracle:eluq~us2~CX_1:fresh"]);
    expect(absent({}, db.map(mapper), ["oracle:eluq~us2~CX_1:seen"])).toEqual(["oracle:eluq~us2~CX_1:fresh", "oracle:eluq~us2~CX_1:old", "oracle:eluq~us2~CX_1:undated"]);
  });
});
